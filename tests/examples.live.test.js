// 예문 + 한글 뜻이 단어장에 실제로 저장·표시되는지 (실제 네트워크 사용)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://example.com/app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;

window.fetch = (...a) => fetch(...a);          // 실제 네트워크
window.AbortController = AbortController;
window.confirm = () => true;
window.prompt = () => '새폴더';
window.speechSynthesis = { cancel() {}, speak() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

const errors = [];
window.addEventListener('error', e => errors.push(e.message));
for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/app.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true }));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 250) : '')); }
};

/** 조건이 참이 될 때까지 기다린다 */
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 20000);
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  await new Promise(r => (doc.readyState === 'complete' ? r() : window.addEventListener('load', r)));
  await sleep(50);

  const Store = window.Store;

  console.log('\n[1] 사전 예문이 없는 단어 저장 (cryogenic)');
  $('#searchInput').value = 'cryogenic';
  fire($('#searchInput'), 'input');
  click($('#btnLookup'));
  const found = await waitFor(() => !!$('#searchResult .entry-word'), 20000);
  ok('검색 결과 표시', found, $('#searchResult').innerHTML.slice(0, 120));

  click($('#searchResult .star-btn'));
  ok('단어장 저장됨', Store.isFav('cryogenic'));

  const gotEx = await waitFor(() => {
    const w = Store.get('cryogenic');
    return w && ((w.examples && w.examples.length) ||
      (w.meanings || []).some(m => m.defs.some(d => d.example)));
  }, 25000);
  ok('예문 자동 확보', gotEx, Store.get('cryogenic'));

  const w = Store.get('cryogenic');
  const exList = (w.examples || []).concat(
    (w.meanings || []).flatMap(m => m.defs.map(d => d.example).filter(Boolean)));
  console.log('      예문: ' + (exList[0] || '').slice(0, 80));

  const gotKo = await waitFor(() => {
    const x = Store.get('cryogenic');
    return x.exKo && Object.keys(x.exKo).length > 0;
  }, 25000);
  ok('예문의 한글 뜻 저장', gotKo, Store.get('cryogenic').exKo);
  if (gotKo) {
    const k = Store.get('cryogenic').exKo;
    console.log('      한글: ' + k[Object.keys(k)[0]].slice(0, 80));
  }

  console.log('\n[1-b] 영어 뜻풀이의 한글 번역');
  const gotDefKo = await waitFor(() => {
    const x = Store.get('cryogenic');
    return x.defKo && Object.keys(x.defKo).length > 0;
  }, 25000);
  ok('뜻풀이 한글 저장', gotDefKo, Store.get('cryogenic').defKo);
  if (gotDefKo) {
    const dk = Store.get('cryogenic').defKo;
    const k0 = Object.keys(dk)[0];
    console.log('      영어: ' + k0.slice(0, 60));
    console.log('      한글: ' + dk[k0].slice(0, 60));
  }

  console.log('\n[2] 단어장 상세 화면에 예문 + 뜻 표시');
  click($$('.tab').find(t => t.dataset.view === 'list'));
  click($('#favList .word-item'));
  await sleep(400);
  ok('상세 시트 열림', !$('#sheet').hidden);
  ok('예문 영역 존재', $$('#sheetBody .example-en').length > 0,
     $('#sheetBody').innerHTML.slice(0, 200));
  const koEls = $$('#sheetBody .example-ko').filter(e => e.textContent.trim());
  ok('예문 아래 한글 뜻 표시', koEls.length > 0, koEls.map(e => e.textContent));
  if (koEls.length) console.log('      화면 표시: ' + koEls[0].textContent.slice(0, 70));
  ok('예문 듣기 버튼', $$('#sheetBody [data-act="speak"]').length > 0);
  const defKoEls = $$('#sheetBody .def-ko').filter(e => e.textContent.trim());
  ok('뜻풀이 아래 한글 표시', defKoEls.length > 0,
     $$('#sheetBody .def-ko').map(e => e.textContent));
  if (defKoEls.length) console.log('      화면 표시: ' + defKoEls[0].textContent.slice(0, 70));
  ok('번역된 뜻풀이는 버튼 숨김',
     $$('#sheetBody [data-act="trans"][data-kind="def"]').length < $$('#sheetBody .def-text').length);

  console.log('\n[3] 암기 카드 정답면에 예문 + 뜻');
  click($('#sheet .sheet-head .icon-btn'));
  click($$('.tab').find(t => t.dataset.view === 'review'));
  click($$('.mode-btn').find(b => b.dataset.mode === 'flash'));
  click($('[data-act="reveal"]'));
  const ansHtml = $('#flashAnswer').innerHTML;
  ok('정답면에 예문 포함', ansHtml.indexOf('answer-ex') !== -1, ansHtml.slice(0, 200));
  ok('정답면에 한글 뜻 포함', ansHtml.indexOf('example-ko') !== -1);
  click($('#btnEndReview'));

  console.log('\n[4] 저장 유지 (새로고침 후에도 남는가)');
  Store.saveNow();
  Store.load();
  const after = Store.get('cryogenic');
  ok('예문 유지', !!((after.examples && after.examples.length) ||
     (after.meanings || []).some(m => m.defs.some(d => d.example))));
  ok('한글 뜻 유지', !!(after.exKo && Object.keys(after.exKo).length));

  console.log('\n[4-b] 찾기 화면에서도 한글이 함께 보이는가 (저장 전)');
  click($$('.tab').find(t => t.dataset.view === 'search'));
  $('#searchInput').value = 'recommend';
  fire($('#searchInput'), 'input');
  click($('#btnLookup'));
  await waitFor(() => !!$('#searchResult .entry-word'), 20000);
  ok('여러 품사 표시', $$('#searchResult .pos-block').length >= 2,
     $$('#searchResult .pos-name').map(e => e.textContent));
  ok('대표 뜻 굵게 표시', $$('#searchResult .def-text.primary').length >= 1);

  const defFilled = await waitFor(() =>
    $$('#searchResult .def-ko').filter(e => e.textContent.trim()).length > 0, 25000);
  ok('뜻풀이 아래 한글 자동 표시', defFilled,
     $$('#searchResult .def-ko').map(e => e.textContent));
  if (defFilled) {
    console.log('      ' + $$('#searchResult .def-ko').filter(e => e.textContent.trim())[0]
      .textContent.slice(0, 60));
  }
  ok('번역된 뜻풀이는 버튼 숨김',
     $$('#searchResult [data-act="trans"][data-kind="def"]').filter(b => !b.hidden).length
       < $$('#searchResult .def-text').length);

  const mine = await waitFor(() => ($('#searchResult .mymean-text').textContent || '').trim(), 25000);
  ok('내 뜻 자동 입력', mine, $('#searchResult .mymean-text').textContent);
  const mineTxt = $('#searchResult .mymean-text').textContent.trim();
  ok('내 뜻에 여러 뜻 포함', mineTxt.indexOf(',') !== -1, mineTxt);
  console.log('      내 뜻: ' + mineTxt);

  console.log('\n[5] 용례가 없는 단어는 관련 단어 예문으로 (resentful)');
  click($$('.tab').find(t => t.dataset.view === 'search'));
  $('#searchInput').value = 'resentful';
  fire($('#searchInput'), 'input');
  click($('#btnLookup'));
  await waitFor(() => !!$('#searchResult .entry-word'), 20000);
  click($('#searchResult .star-btn'));
  ok('resentful 저장', Store.isFav('resentful'));

  const relOk = await waitFor(() => {
    const x = Store.get('resentful');
    return x && x.examples && x.examples.length;
  }, 30000);
  ok('관련 단어에서 예문 확보', relOk, Store.get('resentful'));
  if (relOk) {
    const x = Store.get('resentful');
    console.log('      출처 단어: ' + (x.examplesFrom || '(자기 자신)'));
    console.log('      예문: ' + x.examples[0].slice(0, 75));
  }

  const defOk = await waitFor(() => {
    const x = Store.get('resentful');
    return x.defKo && Object.keys(x.defKo).length > 0;
  }, 30000);
  ok('뜻풀이 한글 저장', defOk, Store.get('resentful').defKo);
  if (defOk) {
    const dk = Store.get('resentful').defKo;
    console.log('      한글: ' + dk[Object.keys(dk)[0]].slice(0, 60));
  }

  click($$('.tab').find(t => t.dataset.view === 'list'));
  const row = $$('#favList .word-item').find(r => r.dataset.word === 'resentful');
  click(row);
  await sleep(600);
  ok('상세에 관련 단어 표기', $('#sheetBody .pos-name').textContent.length > 0 &&
     $$('#sheetBody .pos-name').some(e => /예문/.test(e.textContent)),
     $$('#sheetBody .pos-name').map(e => e.textContent));
  click($('#sheet .sheet-head .icon-btn'));

  console.log('\n[5-b] 오류 점검');
  ok('런타임 오류 없음', errors.length === 0, errors);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('테스트 중단:', e); process.exit(1); });
