// 여러 사전의 뜻을 합치고, 많이 쓰이는 순서로 정렬·표시하는지 (실제 네트워크)
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

const flat = e => e.meanings.reduce((a, m) => a.concat(m.defs.map(d => ({ pos: m.pos, ...d }))), []);
const firstOf = (e, pos) => {
  const m = e.meanings.find(x => x.pos === pos);
  return m ? m.defs[0].def : '';
};

(async () => {
  console.log('\n[1] 여러 품사가 모두 나오는가 (recommend)');
  let r = await Api.lookup('recommend', { force: true });
  ok('조회 성공', r.ok, r.error);
  const poss = r.entry.meanings.map(m => m.pos);
  ok('동사와 명사 모두 포함', poss.indexOf('verb') !== -1 && poss.indexOf('noun') !== -1, poss);
  ok('뜻이 2개 이상', flat(r.entry).length >= 4, flat(r.entry).length);
  console.log('      품사: ' + poss.join(', ') + ' / 뜻 ' + flat(r.entry).length + '개');

  console.log('\n[2] 많이 쓰이는 뜻이 앞에 오는가 (run)');
  r = await Api.lookup('run', { force: true });
  ok('조회 성공', r.ok, r.error);
  ok('동사가 첫 품사', r.entry.meanings[0].pos === 'verb', r.entry.meanings.map(m => m.pos));
  const runFirst = firstOf(r.entry, 'verb');
  ok('"달리다/움직이다"가 대표 뜻', /move|run/i.test(runFirst), runFirst);
  console.log('      대표 뜻: ' + runFirst.slice(0, 60));

  console.log('\n[3] 자주 쓰임 표시 (book)');
  r = await Api.lookup('book', { force: true });
  ok('조회 성공', r.ok, r.error);
  const all = flat(r.entry);
  const prim = all.filter(d => d.primary);
  ok('표시가 1~2개', prim.length >= 1 && prim.length <= 2, prim.map(d => d.def.slice(0, 40)));
  ok('명사가 첫 품사', r.entry.meanings[0].pos === 'noun', r.entry.meanings.map(m => m.pos));
  ok('"종이를 묶은 책"이 대표 뜻', /sheets of paper|written work|collection/i.test(firstOf(r.entry, 'noun')),
     firstOf(r.entry, 'noun'));
  ok('뜻이 10개 이상', all.length >= 10, all.length);
  prim.forEach(d => console.log('      자주쓰임 [' + d.pos + '] ' + d.def.slice(0, 55)));

  console.log('\n[4] 옛말·속어는 대표 뜻으로 뽑지 않는가');
  const narrow = prim.filter(d => /^\s*\((?:[^)]*(?:archaic|obsolete|slang|colloquial|rare|dated))/i.test(d.def));
  ok('꼬리표 붙은 뜻은 제외', narrow.length === 0, narrow.map(d => d.def.slice(0, 50)));

  console.log('\n[5] 중복 뜻이 합쳐지는가');
  const keys = all.map(d => d.def.toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 50));
  ok('같은 뜻이 두 번 나오지 않음', new Set(keys).size === keys.length,
     keys.length - new Set(keys).size + '개 중복');

  console.log('\n[6] 사전 하나만 살아 있어도 동작');
  r = await Api.lookup('serendipity', { force: true });
  ok('조회 성공', r.ok, r.error);
  ok('대표 뜻 표시 있음', flat(r.entry).some(d => d.primary), flat(r.entry).map(d => d.primary));

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
