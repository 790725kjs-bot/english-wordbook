// jsdom 으로 실제 화면 동작(렌더링·클릭)까지 확인
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

const dom = new JSDOM(html, { url: 'https://example.com/app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;

// 실제 CSS 를 주입해야 display 관련 회귀(hidden 무력화)를 잡을 수 있다
const styleEl = doc.createElement('style');
styleEl.textContent = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
doc.head.appendChild(styleEl);

// 브라우저 기능 보완
window.fetch = () => Promise.reject(new Error('no network'));
window.confirm = () => true;
window.prompt = () => '새폴더';
window.alert = () => {};
window.speechSynthesis = { cancel() {}, speak() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

const errors = [];
window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));

for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/app.js']) {
  try {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  } catch (e) {
    errors.push(f + ' 로드 실패: ' + e.message);
  }
}
// 단어팩은 동적 script 주입이라 테스트에서는 직접 넣는다
window.eval(fs.readFileSync(path.join(ROOT, 'js/pack.js'), 'utf8'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

async function main() {
  await new Promise(r => {
    if (doc.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  await sleep(30);

  console.log('\n[1] 초기 렌더링');
  ok('스크립트 오류 없음', errors.length === 0, errors);
  ok('Store/Api/Review/App 노출', !!(window.Store && window.Api && window.Review && window.App));
  ok('찾기 화면이 기본', $('#view-search').classList.contains('active'));
  ok('빈 단어장 안내 표시', !$('#favEmpty').hidden);

  // [회귀 방지] 작성자 스타일시트의 display 선언은 브라우저 기본 [hidden] 규칙을 이긴다.
  // 그래서 .sheet{display:flex} 같은 규칙이 hidden 상태의 전체화면 오버레이를 남겨
  // 모든 클릭을 가로챈 적이 있다. jsdom 은 이 cascade 를 재현하지 못하므로 CSS 를 직접 검사한다.
  const cssText = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  ok('[hidden] 전역 override 존재', /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(cssText));

  const hidable = new Set([
    ...[...html.matchAll(/class="([^"]*)"[^>]*\shidden/g)].flatMap(m => m[1].split(/\s+/)),
    ...[...html.matchAll(/\shidden[^>]*class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)),
    ...[...appSrc.matchAll(/\$\('#([A-Za-z]+)'\)\.hidden/g)].map(m => m[1])
  ].filter(Boolean));
  const risky = [...hidable].filter(c => {
    const rule = cssText.match(new RegExp('^\\.' + c + '\\s*\\{([^}]*)\\}', 'm'));
    return rule && /display:/.test(rule[1]);
  });
  ok('hidden 대상 클래스의 display 선언 파악됨', true, risky.length ? 'override 로 보호 중: ' + risky.join(', ') : '해당 없음');

  console.log('\n[2] 기본 단어팩 불러오기');
  click($('#btnLoadPackEmpty'));
  const favs = window.Store.favorites();
  ok('단어팩 전체 로드', favs.length === window.STARTER_PACK.words.length, favs.length);
  ok('예문까지 저장됨', !!(window.Store.get('resilient').meanings[0].defs[0].example));
  ok('폴더 지정됨', window.Store.get('resilient').folder === '팟캐스트 빈출');

  console.log('\n[3] 단어장 화면');
  click($$('.tab').find(t => t.dataset.view === 'list'));
  ok('단어장 탭 활성', $('#view-list').classList.contains('active'));
  ok('목록 렌더링', $$('#favList .word-item').length === favs.length, $$('#favList .word-item').length);
  ok('추가 순서 1번이 figure out', $('#favList .word-item .wi-word').textContent === 'figure out',
     $('#favList .word-item .wi-word').textContent);
  ok('폴더 칩 표시', $$('#listFolders .chip').length >= 2);

  click($('#btnMask'));
  ok('뜻 가리기 적용', $$('#favList .wi-mean.masked').length > 0 && $('#btnMask').textContent === '뜻 보이기');
  click($('#btnMask'));

  $('#filterInput').value = 'resil';
  fire($('#filterInput'), 'input');
  ok('검색 필터', $$('#favList .word-item').length === 1, $$('#favList .word-item').length);
  $('#filterInput').value = '';
  fire($('#filterInput'), 'input');

  $('#sortSelect').value = 'alpha';
  fire($('#sortSelect'), 'change');
  ok('알파벳 정렬', $('#favList .word-item .wi-word').textContent === 'accordingly',
     $('#favList .word-item .wi-word').textContent);
  $('#sortSelect').value = 'added';
  fire($('#sortSelect'), 'change');

  console.log('\n[4] 단어 상세 시트');
  click($('#favList .word-item'));
  ok('시트 열림', !$('#sheet').hidden);
  ok('단어 표시', $('#sheetBody .entry-word').textContent === 'figure out');
  ok('즐겨찾기 별 켜짐', $('#sheetBody .star-btn').classList.contains('on'));
  ok('예문 표시', !!$('#sheetBody .example-en'));
  ok('폴더 선택기', !!$('#sheetBody select[data-act="folder"]'));
  click($('#sheet .sheet-head .icon-btn'));
  ok('시트 닫힘', $('#sheet').hidden);

  console.log('\n[5] 암기 - 플래시카드');
  click($$('.tab').find(t => t.dataset.view === 'review'));
  ok('통계 표시', $('#rvTotal').textContent === String(favs.length), $('#rvTotal').textContent);
  click($$('.mode-btn').find(b => b.dataset.mode === 'flash'));
  ok('세션 시작', !$('#reviewSession').hidden && $('#sessMode').textContent === '플래시카드');
  const shownWord = $('#rvStage .card-word').textContent;
  ok('카드 단어 표시', !!shownWord);
  ok('뜻 보기 버튼', !!$('[data-act="reveal"]'));
  click($('[data-act="reveal"]'));
  ok('정답 공개', !$('#flashAnswer').hidden && $('#flashAnswer').innerHTML.length > 10);
  ok('채점 버튼 3개', $$('[data-act="grade"]').length === 3);
  click($$('[data-act="grade"]').find(b => b.dataset.g === 'good'));
  ok('통계 반영', window.Store.get(shownWord.toLowerCase()).stats.seen === 1,
     window.Store.get(shownWord.toLowerCase()).stats);
  await sleep(450);
  ok('다음 카드 자동 진행', !!$('#rvStage .card-word'));

  console.log('\n[6] 암기 - 객관식');
  click($('#btnEndReview'));
  ok('종료 후 인트로 복귀', $('#reviewSession').hidden && !$('#reviewIntro').hidden);
  click($$('.mode-btn').find(b => b.dataset.mode === 'mcq'));
  ok('보기 4개 생성', $$('#rvStage .mcq-option').length === 4, $$('#rvStage .mcq-option').length);
  const optTexts = $$('#rvStage .mcq-option').map(b => b.dataset.val);
  ok('보기 중복 없음', new Set(optTexts).size === 4, optTexts);
  const mcqWord = $('#rvStage .card-word').textContent;
  const correctVal = window.Review.meaningLabel(window.Store.get(mcqWord.toLowerCase()));
  ok('정답이 보기에 포함', optTexts.includes(correctVal), { correctVal, optTexts });
  click($$('#rvStage .mcq-option').find(b => b.dataset.val === correctVal));
  ok('정답 강조 표시', $$('#rvStage .mcq-option.correct').length === 1);
  ok('모든 보기 비활성화', $$('#rvStage .mcq-option').every(b => b.disabled));
  ok('정답 처리됨', window.Store.get(mcqWord.toLowerCase()).stats.correct >= 1);
  await sleep(700);

  console.log('\n[7] 암기 - 스펠링');
  click($('#btnEndReview'));
  click($$('.mode-btn').find(b => b.dataset.mode === 'spell'));
  ok('입력창 표시', !!$('#spellInput'));
  const hint = $('#rvStage .spell-hint').textContent;
  ok('힌트가 첫 글자만 공개', /^[A-Za-z][_ ]*$/.test(hint), hint);
  const spellWord = window.Review.current().lastId;
  $('#spellInput').value = spellWord;
  click($('[data-act="spell-submit"]'));
  ok('정답 판정', $('#spellAnswer').textContent.startsWith('정답!'), $('#spellAnswer').textContent);
  await sleep(800);

  console.log('\n[8] 암기 - 스펠링 오답');
  const wrongWord = window.Review.current().lastId;
  $('#spellInput').value = 'zzzz';
  click($('[data-act="spell-submit"]'));
  ok('오답 시 정답 공개', $('#spellAnswer').textContent.indexOf(window.Store.get(wrongWord).word) !== -1,
     $('#spellAnswer').textContent);
  ok('오답은 연속 기록 0', window.Store.get(wrongWord).stats.fastStreak === 0);
  await sleep(1800);

  console.log('\n[9] 암기 - 연속 듣기');
  click($('#btnEndReview'));
  click($$('.mode-btn').find(b => b.dataset.mode === 'listen'));
  ok('듣기 카드 표시', !!$('#rvStage .listen-word'));
  ok('타이머 숨김', $('.timer-wrap').hidden === true);
  ok('재생 컨트롤 3개', $$('[data-act="listen-toggle"],[data-act="listen-next"],[data-act="listen-prev"]').length === 3);
  click($('[data-act="listen-next"]'));
  ok('다음 카드 이동', $('#rvStage .listen-progress').textContent.trim().indexOf('2 /') === 0,
     $('#rvStage .listen-progress').textContent);
  click($('[data-act="listen-toggle"]'));
  ok('일시정지 표시', $('[data-act="listen-toggle"]').textContent.indexOf('재생') !== -1,
     $('[data-act="listen-toggle"]').textContent);
  click($('#btnEndReview'));
  ok('세션 종료', $('#reviewSession').hidden);
  ok('타이머 다시 표시', $('.timer-wrap').hidden === false);

  console.log('\n[10] 폴더 범위 선택');
  click($$('#reviewFolders .chip').find(c => c.dataset.folder === '팟캐스트 빈출'));
  ok('폴더 칩 활성', $$('#reviewFolders .chip.active')[0].dataset.folder === '팟캐스트 빈출');
  ok('범위 통계 반영', $('#rvTotal').textContent === String(favs.length));

  console.log('\n[11] 일괄 추가');
  click($$('.tab').find(t => t.dataset.view === 'search'));
  click($('#btnBulk'));
  ok('일괄 추가 시트', !$('#sheet').hidden && !!$('#bulkText'));
  $('#bulkText').value = 'serendipity - 뜻밖의 행운\nmeticulous : 꼼꼼한\nresilient 회복력\n\nquirk 별난 점';
  click($('#bulkCheck'));
  ok('미리보기 4줄', $$('#bulkPreview .bulk-row').length === 4, $$('#bulkPreview .bulk-row').length);
  ok('중복 표시(resilient)', $$('#bulkPreview .bulk-row.dup').length === 1);
  click($('#bulkAdd'));
  ok('3개만 추가됨', window.Store.favorites().length === favs.length + 3, window.Store.favorites().length);
  ok('뜻 함께 저장', window.Store.get('serendipity').myMeaning === '뜻밖의 행운',
     window.Store.get('serendipity').myMeaning);

  console.log('\n[12] 검색창 파싱');
  $('#searchInput').value = 'meticulous 꼼꼼한';
  fire($('#searchInput'), 'input');
  ok('지우기 버튼 노출', $('#btnClear').hidden === false);
  click($('#btnLookup'));
  await sleep(50);
  ok('오프라인/실패 시에도 카드 표시', !!$('#searchResult .entry-word'),
     $('#searchResult').innerHTML.slice(0, 120));
  ok('붙여넣은 뜻 유지', $('#searchResult .mymean-text').textContent === '꼼꼼한',
     $('#searchResult .mymean-text').textContent);

  console.log('\n[13] 설정');
  click($$('.tab').find(t => t.dataset.view === 'settings'));
  $('#setFastMs').value = '3000';
  fire($('#setFastMs'), 'input');
  ok('즉답 기준 변경', window.Store.settings().fastMs === 3000 && $('#setFastMsVal').textContent === '3.0초');
  $('#setStreak').value = '6';
  fire($('#setStreak'), 'input');
  ok('연속 횟수 변경', window.Store.settings().targetStreak === 6);
  $('#setListenGap').value = '2500';
  fire($('#setListenGap'), 'input');
  ok('듣기 간격 변경', window.Store.settings().listenGap === 2500);
  click($('#btnResetStats'));
  ok('기록 초기화', window.Store.get('resilient').stats.seen === 0);
  const before = window.Store.favorites().length;
  click($('#btnWipe'));
  ok('전체 삭제', window.Store.favorites().length === 0 && before > 0);

  console.log('\n[14] 최종 오류 점검');
  ok('런타임 오류 없음', errors.length === 0, errors);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('테스트 중단:', e); process.exit(1); });
