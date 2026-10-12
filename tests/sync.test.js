// 기기 간 동기화: 태블릿 ↔ (가짜 Gist) ↔ 휴대폰 시나리오
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.argv[2];

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 240) : '')); }
};

/* ---- GitHub Gist 를 흉내 내는 가짜 서버 ---- */
const cloud = { gists: {}, nextId: 1, calls: 0 };

function fakeFetch(url, init) {
  cloud.calls++;
  init = init || {};
  const u = String(url);
  const auth = (init.headers || {})['Authorization'] || '';
  if (!/^Bearer /.test(auth)) {
    return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
  }
  if (auth === 'Bearer badtoken') {
    return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
  }

  const json = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

  if (/\/gists\?per_page/.test(u)) {
    return json(Object.keys(cloud.gists).map(id => ({ id, description: cloud.gists[id].description, files: cloud.gists[id].files })));
  }
  if (/\/gists$/.test(u) && init.method === 'POST') {
    const b = JSON.parse(init.body);
    const id = 'g' + (cloud.nextId++);
    cloud.gists[id] = { description: b.description, files: b.files };
    return json({ id });
  }
  const m = u.match(/\/gists\/([a-z0-9]+)$/i);
  if (m) {
    const g = cloud.gists[m[1]];
    if (!g) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    if (init.method === 'PATCH') {
      const b = JSON.parse(init.body);
      Object.assign(g.files, b.files);
      return json({ id: m[1] });
    }
    return json({ id: m[1], description: g.description, files: g.files });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

/** 기기 하나를 만든다 (각자 자기 브라우저 저장소를 가진다) */
function device(name) {
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
  sb.console = { log: () => {}, error: () => {} };
  sb.fetch = fakeFetch;
  sb.AbortController = AbortController;
  for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/sync.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  }
  sb.Store.load();
  sb.__name = name;
  sb.__mem = mem;
  return sb;
}

(async () => {
  console.log('\n[1] 태블릿에서 단어 저장 후 첫 동기화');
  const tab = device('태블릿');
  tab.Store.batchAdd([
    { word: 'alpha', ko: '알파' }, { word: 'bravo', ko: '브라보' }
  ], '기본');
  tab.Store.saveNow();
  let r = await tab.Sync.connect('tok123');
  ok('토큰 연결', r.ok, r.error);
  r = await tab.Sync.run();
  ok('첫 동기화 성공', r.ok, r.error);
  ok('클라우드에 저장됨', Object.keys(cloud.gists).length === 1, Object.keys(cloud.gists));

  console.log('\n[2] 휴대폰에서 같은 토큰으로 연결 → 단어가 따라오는가');
  const phone = device('휴대폰');
  ok('처음엔 비어 있음', phone.Store.favorites().length === 0);
  await phone.Sync.connect('tok123');
  r = await phone.Sync.run();
  ok('동기화 성공', r.ok, r.error);
  ok('태블릿 단어 2개 받음', phone.Store.favorites().length === 2,
     phone.Store.favorites().map(w => w.word));
  ok('뜻도 함께', phone.Store.get('alpha').myMeaning === '알파');
  ok('같은 저장 공간 사용', Object.keys(cloud.gists).length === 1);

  console.log('\n[3] 양쪽에서 각각 추가 → 둘 다 합쳐지는가');
  phone.Store.batchAdd([{ word: 'charlie', ko: '찰리' }], '기본');
  phone.Store.saveNow();
  await phone.Sync.run();
  tab.Store.batchAdd([{ word: 'delta', ko: '델타' }], '기본');
  tab.Store.saveNow();
  await tab.Sync.run();
  await phone.Sync.run();
  const tw = tab.Store.favorites().map(w => w.word).sort().join(',');
  const pw = phone.Store.favorites().map(w => w.word).sort().join(',');
  ok('태블릿에 4개', tw === 'alpha,bravo,charlie,delta', tw);
  ok('휴대폰에 4개', pw === 'alpha,bravo,charlie,delta', pw);

  console.log('\n[4] 추가한 순서가 유지되는가');
  ok('태블릿 순서', tab.Store.favorites().map(w => w.word).join(',') === 'alpha,bravo,charlie,delta',
     tab.Store.favorites().map(w => w.word));
  ok('휴대폰도 같은 순서', phone.Store.favorites().map(w => w.word).join(',') === 'alpha,bravo,charlie,delta',
     phone.Store.favorites().map(w => w.word));

  console.log('\n[5] 한쪽에서 뜻을 고치면 다른 쪽에도 반영');
  await new Promise(r2 => setTimeout(r2, 5));
  phone.Store.update('alpha', { myMeaning: '휴대폰에서 고친 뜻' });
  phone.Store.saveNow();
  await phone.Sync.run();
  await tab.Sync.run();
  ok('고친 뜻이 건너감', tab.Store.get('alpha').myMeaning === '휴대폰에서 고친 뜻',
     tab.Store.get('alpha').myMeaning);

  console.log('\n[6] 보관함 상태도 함께');
  await new Promise(r2 => setTimeout(r2, 5));
  tab.Store.archiveFav('bravo');
  tab.Store.saveNow();
  await tab.Sync.run();
  await phone.Sync.run();
  ok('휴대폰에서도 보관 상태', phone.Store.isArchived('bravo'),
     { fav: phone.Store.isFav('bravo'), arch: phone.Store.isArchived('bravo') });
  ok('단어장에는 3개', phone.Store.favorites().length === 3,
     phone.Store.favorites().map(w => w.word));

  console.log('\n[7] 지운 단어가 되살아나지 않는가');
  await new Promise(r2 => setTimeout(r2, 5));
  tab.Store.removeFav('delta');
  tab.Store.saveNow();
  await tab.Sync.run();
  await phone.Sync.run();
  ok('휴대폰에서도 삭제됨', !phone.Store.get('delta'));
  await phone.Sync.run();
  await tab.Sync.run();
  ok('다시 동기화해도 안 돌아옴', !tab.Store.get('delta') && !phone.Store.get('delta'));

  console.log('\n[8] 암기 기록도 합쳐지는가');
  await new Promise(r2 => setTimeout(r2, 5));
  phone.Review.start('flash', null);
  phone.Review.grade('alpha', 'good', 900);
  phone.Store.saveNow();
  await phone.Sync.run();
  await tab.Sync.run();
  ok('학습 횟수 전달', tab.Store.get('alpha').stats.seen === 1, tab.Store.get('alpha').stats);

  console.log('\n[9] 받아 둔 사전 자료는 잃지 않는가');
  await new Promise(r2 => setTimeout(r2, 5));
  tab.Store.update('charlie', {
    meanings: [{ pos: 'noun', posKo: '명사', defs: [{ def: 'a test', example: 'x', synonyms: [] }] }],
    defKo: { 'a test': '시험' }, schema: tab.Store.ENTRY_SCHEMA
  });
  tab.Store.saveNow();
  await tab.Sync.run();
  await phone.Sync.run();
  ok('휴대폰이 사전 자료 받음', !!(phone.Store.get('charlie').meanings || []).length);
  ok('한글 뜻도 함께', phone.Store.get('charlie').defKo['a test'] === '시험');
  // 휴대폰에서 뜻만 고쳐 올려도 사전 자료가 날아가면 안 된다
  await new Promise(r2 => setTimeout(r2, 5));
  phone.Store.update('charlie', { myMeaning: '찰리2' });
  phone.Store.saveNow();
  await phone.Sync.run();
  await tab.Sync.run();
  ok('태블릿 사전 자료 유지', !!(tab.Store.get('charlie').meanings || []).length,
     tab.Store.get('charlie'));

  console.log('\n[10] 토큰은 백업 파일에 들어가지 않는가');
  const dump = JSON.parse(tab.Store.exportData());
  ok('백업에 토큰 없음', JSON.stringify(dump).indexOf('tok123') === -1);
  ok('토큰은 따로 보관', Object.keys(tab.__mem).some(k => /sync/.test(k)), Object.keys(tab.__mem));

  console.log('\n[11] 잘못된 토큰 처리');
  const bad = device('새기기');
  const br = await bad.Sync.connect('badtoken');
  ok('연결 거부', br.ok === false, br);
  ok('안내 문구', /토큰/.test(br.error || ''), br.error);

  console.log('\n[12] 하람이 단어장과 섞이지 않는가');
  const kid = device('하람태블릿');
  kid.APP_PROFILE = 'haram';
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8'), kid, { filename: 'sync.js' });
  await kid.Sync.connect('tok123');
  await kid.Sync.run();
  ok('별도 저장 공간 생성', Object.keys(cloud.gists).length === 2, Object.keys(cloud.gists));
  ok('아빠 단어가 넘어오지 않음', kid.Store.favorites().length === 0,
     kid.Store.favorites().map(w => w.word));

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed  (가짜 서버 호출 ' + cloud.calls + '회)');
  process.exit(fail ? 1 : 0);
})();
