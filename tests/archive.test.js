// 보관함: 별표를 꺼도 자료와 기록이 남고, 되돌릴 수 있는지
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://x.com/a/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom, doc = window.document;

window.fetch = () => Promise.reject(new Error('no network'));   // 네트워크 없이 검증
window.AbortController = AbortController;
window.confirm = () => true;
window.speechSynthesis = { cancel() {}, speak() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

// 실제와 같게: 추가한 순서대로 addedAt 이 커진다
const T0 = Date.now() - 100000;
const mk = (id, word, ko, idx) => ({
  id, word, addedAt: T0 + idx * 1000, myMeaning: ko, note: '', folder: '기본',
  stats: { fastStreak: 2, seen: 7, correct: 5, fast: 4, lastSeen: Date.now(), lastMs: 1200, mastered: false },
  meanings: [{ pos: 'noun', posKo: '명사', defs: [{ def: 'a test definition for ' + word, example: word + ' in a sentence.', synonyms: [] }] }],
  defKo: { ['a test definition for ' + word]: word + '의 뜻풀이' },
  exKo: { [word + ' in a sentence.']: word + ' 예문 한글' },
  examples: []
});
window.localStorage.setItem('engvoc.v1', JSON.stringify({
  version: 1,
  words: { alpha: mk('alpha', 'alpha', '알파', 0), bravo: mk('bravo', 'bravo', '브라보', 1), charlie: mk('charlie', 'charlie', '찰리', 2) },
  order: ['alpha', 'bravo', 'charlie'], archive: [], queue: ['alpha', 'bravo', 'charlie'],
  folders: ['기본'], recent: [], cache: {}, cacheOrder: [], trans: {}, transOrder: [],
  settings: { autoFill: false }, stats: { totalAnswers: 0, fastAnswers: 0 }
}));

const errors = [];
window.addEventListener('error', e => errors.push(e.message));
for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/app.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s), $$ = s => [...doc.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const renderList = () => window.App.refresh();

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 220) : '')); }
};

async function main() {
  await new Promise(r => (doc.readyState === 'complete' ? r() : window.addEventListener('load', r)));
  await sleep(50);
  const Store = window.Store, Review = window.Review;

  console.log('\n[1] 별표 끄기 = 보관함으로 이동');
  click($$('.tab').find(t => t.dataset.view === 'list'));
  click($$('#favList .word-item').find(r => r.dataset.word === 'bravo'));
  await sleep(100);
  ok('상세 열림', !$('#sheet').hidden);
  click($('#sheetBody .star-btn'));
  await sleep(100);

  ok('단어장에서 빠짐', !Store.isFav('bravo'));
  ok('보관함에 들어감', Store.isArchived('bravo'));
  ok('데이터는 그대로 남음', !!Store.get('bravo'), Store.get('bravo'));
  ok('받아 둔 한글 뜻풀이 유지', !!(Store.get('bravo').defKo && Object.keys(Store.get('bravo').defKo).length));
  ok('예문 한글도 유지', !!(Store.get('bravo').exKo && Object.keys(Store.get('bravo').exKo).length));
  ok('암기 기록 유지', Store.get('bravo').stats.seen === 7, Store.get('bravo').stats);
  ok('단어장 수 2개', Store.favorites().length === 2, Store.favorites().map(w => w.word));

  console.log('\n[2] 암기 출제에서 제외');
  ok('대기열에서 빠짐', Store.raw().queue.indexOf('bravo') === -1, Store.raw().queue);
  ok('암기 통계에 미포함', Review.stats().total === 2, Review.stats());

  console.log('\n[3] 보관함 화면');
  click($('#sheet .sheet-head .icon-btn'));
  click($('#btnArchive'));
  await sleep(80);
  ok('보관함 전환', $('#btnArchive').textContent === '단어장');
  ok('보관 단어 1개 표시', $$('#favList .word-item').length === 1, $$('#favList .word-item').length);
  ok('보관 날짜 표시', /오늘|일 전/.test($('#favList .wi-badge').textContent), $('#favList .wi-badge').textContent);
  ok('학습 횟수 표시', /7회/.test($('#favList .wi-sub').textContent), $('#favList .wi-sub').textContent);
  ok('폴더 칩 숨김', $('#listFolders').hidden === true);

  console.log('\n[3-b] 보관 순서와 행 별표');
  // alpha 도 보관해서 2개로 만든 뒤 순서를 확인한다
  Store.archiveFav('alpha');
  Store.get('alpha').archivedAt = Date.now() + 5000;   // alpha 를 더 나중에 보관한 것으로
  renderList();
  await sleep(80);
  const rows = $$('#favList .word-item').map(r => r.dataset.word);
  ok('오래 보관한 것이 위', rows[0] === 'bravo' && rows[1] === 'alpha', rows);
  ok('순번 표시', $('#favList .wi-index').textContent === '1', $('#favList .wi-index').textContent);
  ok('행마다 별 버튼', $$('#favList .row-star').length === 2, $$('#favList .row-star').length);
  ok('별은 행 맨 오른쪽', (() => {
    const kids = [...$('#favList .word-item').children];
    return kids[kids.length - 1].classList.contains('row-star');
  })());

  console.log('\n[3-c] 목록에서 바로 별표 → 단어장 복귀');
  const alphaStar = $$('#favList .row-star').find(b => b.dataset.word === 'alpha');
  click(alphaStar);
  await sleep(120);
  ok('단어장으로 복귀', Store.isFav('alpha'));
  ok('보관함 목록에서 사라짐', $$('#favList .word-item').length === 1,
     $$('#favList .word-item').map(r => r.dataset.word));
  ok('상세를 열지 않고 처리', $('#sheet').hidden === true);
  ok('받아 둔 자료 그대로', !!(Store.get('alpha').defKo && Object.keys(Store.get('alpha').defKo).length));

  console.log('\n[4] 되돌리기');
  click($('#favList .word-item'));
  await sleep(100);
  ok('보관함 안내 표시', !!$('#sheetBody .archived-note'));
  ok('별표 꺼진 상태', $('#sheetBody .star-btn').textContent === '☆');
  click($('#sheetBody .star-btn'));
  await sleep(100);
  ok('단어장으로 복귀', Store.isFav('bravo'));
  ok('보관함에서 빠짐', !Store.isArchived('bravo'));
  ok('원래 순서 자리로 복원', Store.favorites().map(w => w.word).join(',') === 'alpha,bravo,charlie',
     Store.favorites().map(w => w.word));
  ok('기록 그대로', Store.get('bravo').stats.seen === 7);
  ok('대기열 복귀', Store.raw().queue.indexOf('bravo') !== -1);

  console.log('\n[5] 완전 삭제는 따로');
  click($('#sheet .sheet-head .icon-btn'));
  click($('#btnArchive'));          // 단어장으로 복귀
  await sleep(50);
  click($$('#favList .word-item').find(r => r.dataset.word === 'charlie'));
  await sleep(80);
  const delBtn = $('#sheetBody [data-act="remove"]');
  ok('삭제 버튼 문구 명확', /완전히 삭제/.test(delBtn.textContent), delBtn.textContent);
  click(delBtn);
  await sleep(80);
  ok('완전히 사라짐', !Store.get('charlie'));
  ok('보관함에도 없음', !Store.isArchived('charlie'));

  console.log('\n[6] 저장·복원');
  Store.saveNow();
  Store.load();
  ok('재시작 후 보관함 유지', Store.favorites().length === 2 && !Store.get('charlie'));
  const dump = Store.exportData();
  ok('내보내기에 보관함 포함', JSON.parse(dump).archive !== undefined);
  Store.archiveFav('alpha');
  Store.saveNow();
  Store.load();
  ok('보관 상태 유지', Store.isArchived('alpha') && !Store.isFav('alpha'));
  ok('보관 단어도 자료 유지', !!Store.get('alpha').defKo);

  console.log('\n[7] 오류 점검');
  ok('런타임 오류 없음', errors.length === 0, errors);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('테스트 중단:', e); process.exit(1); });
