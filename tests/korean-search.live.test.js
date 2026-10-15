// 한글로 검색하면 영어 단어를 찾아 주는지 (실제 네트워크)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://x.github.io/app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom, doc = window.document;

window.fetch = (...a) => fetch(...a);
window.AbortController = AbortController;
window.confirm = () => true;
window.speechSynthesis = { cancel() {}, speak() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

const errors = [];
window.addEventListener('error', e => errors.push(e.message));
for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/sync.js', 'js/app.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s), $$ = s => [...doc.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true }));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 200) : '')); }
};
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 25000);
  while (Date.now() < end) { if (fn()) return true; await sleep(300); }
  return false;
}
async function search(text) {
  $('#searchResult').innerHTML = '';
  $('#searchInput').value = text;
  fire($('#searchInput'), 'input');
  click($('#btnLookup'));
  await waitFor(() => !!$('#searchResult .entry-word'), 25000);
}

async function main() {
  await new Promise(r => (doc.readyState === 'complete' ? r() : window.addEventListener('load', r)));
  await sleep(50);
  const Store = window.Store, Api = window.Api;

  console.log('\n[1] 한글 → 영어 후보 찾기');
  const cases = [['회복력', 'resilience'], ['꼼꼼한', 'meticulous'], ['극저온', 'cryogenic']];
  for (const [ko, expect] of cases) {
    const cands = await Api.translateToEnglish(ko, 4);
    ok('"' + ko + '" → ' + expect, cands.indexOf(expect) !== -1, cands);
  }
  const noisy = await Api.translateToEnglish('회복력', 4);
  ok('후보가 모두 영어', noisy.every(c => /^[a-z][a-z' -]*$/.test(c)), noisy);
  ok('한 단어짜리가 먼저', noisy[0].split(' ').length === 1, noisy);

  console.log('\n[2] 화면에서 한글로 검색');
  await search('꼼꼼한');
  const word = $('#searchResult .entry-word');
  ok('영어 단어 카드 표시', !!word, $('#searchResult').innerHTML.slice(0, 140));
  ok('찾은 단어가 meticulous', word && word.textContent === 'meticulous', word && word.textContent);
  console.log('      검색 "꼼꼼한" → ' + (word ? word.textContent : '(없음)'));

  const st = ($('#searchStatus').textContent || '');
  ok('무엇으로 바꿔 찾았는지 안내', st.indexOf('꼼꼼한') !== -1 && st.indexOf('meticulous') !== -1, st);
  console.log('      안내: ' + st.slice(0, 60));

  console.log('\n[3] 입력한 한글이 내 뜻으로 들어가는가');
  const mine = $('#searchResult .mymean-text');
  ok('내 뜻 = 입력한 한글', mine && mine.textContent.trim() === '꼼꼼한', mine && mine.textContent);

  console.log('\n[4] 다른 후보로 바꿔 볼 수 있는가');
  const chips = $$('#searchStatus .sug');
  ok('다른 후보 제시', chips.length >= 1, chips.map(c => c.textContent));
  if (chips.length) {
    console.log('      후보: ' + chips.map(c => c.dataset.word).join(', '));
    click(chips[0]);
    await waitFor(() => $('#searchResult .entry-word') &&
                        $('#searchResult .entry-word').textContent !== 'meticulous', 20000);
    ok('눌러서 전환됨', $('#searchResult .entry-word').textContent !== 'meticulous',
       $('#searchResult .entry-word').textContent);
  }

  console.log('\n[5] 저장까지 되는가');
  await search('극저온');
  ok('cryogenic 조회', $('#searchResult .entry-word').textContent === 'cryogenic',
     $('#searchResult .entry-word').textContent);
  click($('#searchResult .star-btn'));
  await sleep(200);
  ok('단어장에 저장', Store.isFav('cryogenic'));
  ok('내 뜻 유지', Store.get('cryogenic').myMeaning === '극저온', Store.get('cryogenic').myMeaning);

  console.log('\n[6] 영어 검색은 그대로 동작하는가');
  await search('resilient');
  ok('영어 입력 정상', $('#searchResult .entry-word').textContent === 'resilient',
     $('#searchResult .entry-word').textContent);

  console.log('\n[7] 영어+한글 함께 붙여넣기도 그대로');
  await search('nuance 뉘앙스');
  ok('영어 쪽을 단어로', $('#searchResult .entry-word').textContent === 'nuance',
     $('#searchResult .entry-word').textContent);
  ok('한글은 내 뜻으로', $('#searchResult .mymean-text').textContent.trim() === '뉘앙스',
     $('#searchResult .mymean-text').textContent);

  ok('오류 없음', errors.length === 0, errors);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('테스트 중단:', e); process.exit(1); });
