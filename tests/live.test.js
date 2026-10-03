// 실제 네트워크로 사전 폴백 동작 확인
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.argv[2];

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext('globalThis.window = globalThis;', sandbox);
const mem = {};
sandbox.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
sandbox.navigator = { onLine: true };
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.console = console;
sandbox.fetch = (...a) => fetch(...a);
sandbox.AbortController = AbortController;

for (const f of ['js/store.js', 'js/api.js', 'js/review.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const { Store, Api } = sandbox;
Store.load();

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 200) : '')); }
};

(async () => {
  console.log('\n[1] 정상 단어 (cryogenic) — 1순위 사전 장애 상황');
  let t0 = Date.now();
  let r = await Api.lookup('cryogenic');
  console.log('      걸린 시간: ' + ((Date.now() - t0) / 1000).toFixed(1) + '초, 출처: ' + (r.entry && r.entry.source));
  ok('찾기 성공', r.ok === true, r.error);
  ok('뜻 있음', r.ok && r.entry.meanings.length > 0);
  ok('대체 사전 사용', r.ok && r.entry.source !== 'Free Dictionary', r.ok && r.entry.source);

  console.log('\n[2] 오타 (cyogenic) — 교정 제안');
  t0 = Date.now();
  r = await Api.lookup('cyogenic');
  console.log('      걸린 시간: ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  ok('찾기 실패로 처리', r.ok === false);
  ok('교정 후보 제시', !!(r.suggestions && r.suggestions.length), r.suggestions);
  ok('cryogenic 포함', !!(r.suggestions || []).some(s => s === 'cryogenic'), r.suggestions);
  console.log('      안내 문구: ' + r.error);
  console.log('      후보: ' + (r.suggestions || []).join(', '));

  console.log('\n[3] 일반 단어 (resilient)');
  r = await Api.lookup('resilient');
  ok('찾기 성공', r.ok === true, r.error);
  ok('품사 구분', r.ok && !!r.entry.meanings[0].pos, r.ok && r.entry.meanings[0]);
  if (r.ok) console.log('      뜻: ' + r.entry.meanings[0].defs[0].def.slice(0, 70));

  console.log('\n[4] 구동사 (take on)');
  r = await Api.lookup('take on');
  ok('구동사 처리', r.ok === true || (r.suggestions || []).length > 0, r.error);
  if (r.ok) console.log('      출처: ' + r.entry.source + ' / 뜻: ' + r.entry.meanings[0].defs[0].def.slice(0, 60));

  console.log('\n[5] 활용형 (acknowledged → 원형)');
  r = await Api.lookup('acknowledged');
  ok('활용형 처리', r.ok === true, r.error);
  if (r.ok) console.log('      단어: ' + r.entry.word + ' / 원형경유: ' + r.viaBase);

  console.log('\n[6] 캐시 재사용');
  t0 = Date.now();
  r = await Api.lookup('cryogenic');
  const ms = Date.now() - t0;
  ok('캐시로 즉시 응답', r.cached === true && ms < 50, { cached: r.cached, ms });

  console.log('\n[7] 번역');
  const ko = await Api.translate('cryogenic');
  ok('한글 번역', !!ko, ko);
  console.log('      결과: ' + ko);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
