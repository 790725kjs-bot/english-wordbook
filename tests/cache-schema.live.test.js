// 예전 형식으로 캐시된 결과가 새 형식으로 갱신되는지 (실제 네트워크)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

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
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 220) : '')); }
};
const countDefs = e => e.meanings.reduce((a, m) => a + m.defs.length, 0);

(async () => {
  console.log('\n[1] 예전 형식(사전 한 곳, 동사만)으로 캐시를 심는다');
  const stale = {
    word: 'recommend', phonetic: '', audio: '',
    meanings: [{ pos: 'verb', posKo: '동사', defs: [
      { def: 'To bestow commendation on; to represent favourably.', example: '', synonyms: [] }
    ] }],
    sourceUrl: '', fetchedAt: Date.now()
    // schema 없음 = 예전 형식
  };
  Store.putCache(stale);
  Store.saveNow();
  ok('옛 캐시 저장됨', !!Store.getCache('recommend'));
  ok('옛 캐시에는 형식 표시 없음', Store.getCache('recommend').schema === undefined);

  console.log('\n[2] 다시 검색하면 새로 받아오는가');
  const r = await Api.lookup('recommend');
  ok('조회 성공', r.ok, r.error);
  ok('캐시를 쓰지 않음', !r.cached, { cached: r.cached });
  ok('새 형식으로 표시됨', r.entry.schema === Store.ENTRY_SCHEMA, r.entry.schema);
  const poss = r.entry.meanings.map(m => m.pos);
  ok('명사 뜻까지 포함', poss.indexOf('noun') !== -1, poss);
  ok('뜻이 여러 개', countDefs(r.entry) >= 4, countDefs(r.entry));
  ok('대표 뜻 표시 있음',
     r.entry.meanings.some(m => m.defs.some(d => d.primary)));
  console.log('      품사: ' + poss.join(', ') + ' / 뜻 ' + countDefs(r.entry) + '개');

  console.log('\n[3] 새 형식은 캐시를 재사용하는가');
  const t0 = Date.now();
  const r2 = await Api.lookup('recommend');
  const ms = Date.now() - t0;
  ok('캐시 재사용', r2.cached === true && ms < 60, { cached: r2.cached, ms });
  ok('내용 동일', countDefs(r2.entry) === countDefs(r.entry));

  console.log('\n[4] 저장해 둔 단어도 형식이 낡으면 보강 대상');
  Store.batchAdd([{ word: 'oldword', ko: '옛단어' }], '기본');
  const w = Store.get('oldword');
  w.meanings = [{ pos: 'noun', posKo: '명사', defs: [{ def: 'something old', example: '', synonyms: [] }] }];
  // schema 를 지정하지 않음 = 예전 형식
  Store.saveNow();
  ok('보강 대상에 포함', Store.needsDetail().indexOf('oldword') !== -1, Store.needsDetail());

  Store.update('oldword', { schema: Store.ENTRY_SCHEMA });
  ok('새 형식이면 제외', Store.needsDetail().indexOf('oldword') === -1, Store.needsDetail());

  console.log('\n[5] 오프라인에서는 옛 캐시라도 쓴다');
  sandbox.navigator.onLine = false;
  const stale2 = { word: 'offlineword', phonetic: '', audio: '', meanings: [
    { pos: 'noun', posKo: '명사', defs: [{ def: 'cached offline', example: '', synonyms: [] }] }], sourceUrl: '' };
  Store.putCache(stale2);
  const r3 = await Api.lookup('offlineword');
  ok('오프라인이면 옛 캐시 사용', r3.ok === true && r3.cached === true, r3);
  sandbox.navigator.onLine = true;

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
