// 발음기호가 단어 아래에 표시되는지 (실제 네트워크)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 200) : '')); }
};
const IPA = /[ˈˌɪɛəɹθðʃʒŋæɑɔʊʌː]/;   // 발음기호에만 쓰이는 글자

(async () => {
  /* ---------- 1부: 조회 계층 ---------- */
  const sb = {};
  vm.createContext(sb);
  vm.runInContext('globalThis.window = globalThis;', sb);
  const mem = {};
  sb.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  sb.navigator = { onLine: true };
  sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout;
  sb.console = console; sb.fetch = (...a) => fetch(...a); sb.AbortController = AbortController;
  for (const f of ['js/store.js', 'js/api.js', 'js/review.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  }
  const { Store, Api } = sb;
  Store.load();

  console.log('\n[1] 단어마다 발음기호를 가져오는가');
  const words = ['resentful', 'recommend', 'subtle', 'thrive', 'nuance'];
  let got = 0;
  for (const w of words) {
    const r = await Api.lookup(w, { force: true });
    const ph = (r.ok && r.entry.phonetic) || '';
    if (ph) got++;
    console.log('      ' + w.padEnd(12) + (ph || '(없음)') + '   [' + (r.ok ? r.entry.source : '실패') + ']');
  }
  // 사전 서버가 간헐적으로 요청을 제한하므로 전부를 요구하지 않는다.
  // 놓친 것은 아래 [5] 처럼 나중에 자동으로 채워진다.
  ok('대부분의 단어에 발음기호', got >= 3, got + '/' + words.length);

  const r1 = await Api.lookup('resentful');
  ok('발음기호 형식이 맞음', IPA.test(r1.entry.phonetic), r1.entry.phonetic);

  console.log('\n[1-b] 눈에 익은 표기로 다듬는가');
  ok('ɹ(뒤집힌 r) → r', Api.prettyIPA('/ɹɪˈzɛntfəl/') === '/rɪˈzɛntfəl/', Api.prettyIPA('/ɹɪˈzɛntfəl/'));
  ok('ɡ(외다리 g) → g', Api.prettyIPA('/ˈɡʊd/') === '/ˈgʊd/', Api.prettyIPA('/ˈɡʊd/'));
  ok('음절 표시 제거', Api.prettyIPA('/ˈsʌtl̩/') === '/ˈsʌtl/', Api.prettyIPA('/ˈsʌtl̩/'));
  ok('조회 결과에 뒤집힌 r 없음', r1.entry.phonetic.indexOf('ɹ') === -1, r1.entry.phonetic);
  ok('모음 기호는 그대로', /ə|ɛ|ɪ/.test(Api.prettyIPA('/rɪˈzɛntfəl/')));
  ok('형식 번호가 최신', r1.entry.schema === Store.ENTRY_SCHEMA, r1.entry.schema);

  console.log('\n[2] 발음기호 없던 옛 결과는 다시 받아오는가');
  Store.putCache({
    word: 'thrive', phonetic: '', audio: '', schema: 2,
    meanings: [{ pos: 'verb', posKo: '동사', defs: [{ def: 'old entry', example: '', synonyms: [] }] }],
    sourceUrl: ''
  });
  const r2 = await Api.lookup('thrive');
  ok('캐시를 쓰지 않고 새로 받음', !r2.cached, { cached: r2.cached });
  ok('발음기호 채워짐', !!r2.entry.phonetic, r2.entry.phonetic);

  /* ---------- 2부: 화면 ---------- */
  console.log('\n[3] 찾기 화면에 표시되는가');
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
  const $ = s => doc.querySelector(s);
  await new Promise(r => (doc.readyState === 'complete' ? r() : window.addEventListener('load', r)));
  await sleep(50);

  $('#searchInput').value = 'resentful';
  $('#searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnLookup').dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 60 && !$('#searchResult .entry-word'); i++) await sleep(300);

  const phEl = $('#searchResult .entry-phonetic');
  ok('발음기호 자리 존재', !!phEl, $('#searchResult').innerHTML.slice(0, 160));
  ok('단어 바로 아래에 표시', !!phEl && IPA.test(phEl.textContent), phEl && phEl.textContent);
  if (phEl) console.log('      화면 표시: ' + $('#searchResult .entry-word').textContent + '  ' + phEl.textContent);

  console.log('\n[4] 저장하면 단어장·암기에도 남는가');
  $('#searchResult .star-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(300);
  ok('저장된 단어에 발음기호', !!window.Store.get('resentful').phonetic,
     window.Store.get('resentful').phonetic);

  window.Store.saveNow();
  window.Store.load();
  ok('다시 열어도 유지', !!window.Store.get('resentful').phonetic);

  console.log('\n[5] 놓친 발음기호를 나중에 스스로 채우는가');
  const W = window.Store;
  W.batchAdd([{ word: 'nuance', ko: '뉘앙스' }], '기본');
  W.update('nuance', { phonetic: '', meanings: [], schema: W.ENTRY_SCHEMA });
  ok('보강 대상에 포함', window.App.__needsKo().indexOf('nuance') !== -1, window.App.__needsKo());

  window.App.__ensure('nuance');
  let filled = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (W.get('nuance').phonetic) { filled = true; break; }
  }
  ok('발음기호 자동 보충', filled, W.get('nuance').phonetic);
  if (filled) console.log('      nuance → ' + W.get('nuance').phonetic);

  ok('오류 없음', errors.length === 0, errors);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
