// store.js / api.js / review.js 로직 검증 (브라우저 없이)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.argv[2];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext('globalThis.window = globalThis;', sandbox);

// 브라우저 흉내
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
sandbox.fetch = () => Promise.reject(new Error('no network in test'));

for (const f of ['js/store.js', 'js/api.js', 'js/review.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

const { Store, Api, Review } = sandbox;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

console.log('\n[1] 붙여넣기 파서');
Store.load();
const cases = [
  ['resilient 회복력 있는', 'resilient', '회복력 있는'],
  ['resilient\n형용사\n회복력 있는', 'resilient', '회복력 있는'],
  ['회복력 있는\nresilient', 'resilient', '회복력 있는'],
  ['take on', 'take on', ''],
  ['nuance /ˈnuːɑːns/ 뉘앙스', 'nuance', '뉘앙스'],
  ['  Overwhelming  ', 'Overwhelming', '']
];
cases.forEach(([input, w, k]) => {
  const r = Api.parseInput(input);
  ok('"' + input.replace(/\n/g, '\\n') + '" → ' + w, r.word === w && r.ko === k, r);
});

console.log('\n[2] 원형 추정');
ok('running → run 포함', Api.baseForms('running').includes('run'), Api.baseForms('running'));
ok('studies → study 포함', Api.baseForms('studies').includes('study'), Api.baseForms('studies'));
ok('acknowledged → acknowledge 포함', Api.baseForms('acknowledged').includes('acknowledge'), Api.baseForms('acknowledged'));

console.log('\n[3] 저장 · 폴더');
const items = [];
for (let i = 1; i <= 10; i++) items.push({ word: 'word' + i, ko: '뜻' + i });
let res = Store.batchAdd(items, '팟캐스트');
ok('10개 추가', res.added === 10 && res.skipped === 0, res);
ok('중복 추가 방지', Store.batchAdd([{ word: 'WORD1', ko: 'x' }], '팟캐스트').added === 0);
ok('추가 순서 유지', Store.favorites().map(w => w.word).join(',') === items.map(i => i.word).join(','));
Store.batchAdd([{ word: 'apple', ko: '사과' }], '기본');
ok('폴더별 조회', Store.favorites('기본').length === 1 && Store.favorites('팟캐스트').length === 10);
ok('폴더 목록', Store.folders().includes('팟캐스트'), Store.folders());

console.log('\n[4] 암기 규칙 — 2초 즉답 4회 연속');
Store.setSetting('fastMs', 2000);
Store.setSetting('targetStreak', 4);
Review.start('flash', null);
const id = 'word1';
let last;
for (let i = 1; i <= 3; i++) {
  last = Review.grade(id, 'good', 1500);   // 1.5초 = 즉답
  ok(i + '회 즉답 → streak ' + i, last.streak === i && last.fast === true && !last.promoted, last);
}
last = Review.grade(id, 'good', 1200);
ok('4회 연속 즉답 → 뒤로 밀림(promoted)', last.promoted === true && last.mastered === true, last);
const q = Store.raw().queue;
ok('맨 뒤로 이동', q[q.length - 1] === id, q.slice(-3));

console.log('\n[5] 느린 정답 / 오답');
Review.grade('word2', 'good', 1000);
let slow = Review.grade('word2', 'good', 3500);   // 3.5초 = 느림
ok('느린 정답 → 연속 초기화', slow.streak === 0 && slow.fast === false && slow.correct === true, slow);
let wrong = Review.grade('word3', 'again', 800);
ok('오답 → 정답 아님', wrong.correct === false && wrong.streak === 0, wrong);
ok('오답 단어는 앞쪽(depth 2)', Store.raw().queue.indexOf('word3') <= 2, Store.raw().queue.slice(0, 5));

console.log('\n[6] 폴더 범위 학습');
Review.start('flash', '기본');
const scoped = Review.scopedQueue();
ok('범위 안 단어만 출제', scoped.length === 1 && scoped[0] === 'apple', scoped);
const picked = Review.next();
ok('next() 도 범위 준수', picked && picked.id === 'apple', picked && picked.id);
Review.grade('apple', 'good', 900);
ok('범위 학습 후에도 전체 큐 유지', Store.raw().queue.length === 11, Store.raw().queue.length);

console.log('\n[7] 객관식 보기');
Review.start('mcq', null);
const target = Store.get('word5');
const ds = Review.distractors(target, 3);
ok('오답 보기 3개', ds.length === 3, ds);
ok('정답이 오답에 섞이지 않음', !ds.includes(Review.meaningLabel(target)), ds);

console.log('\n[8] 통계 · 백업');
const st = Review.stats();
ok('전체 11개', st.total === 11, st);
ok('익힘 1개(word1)', st.mastered === 1, st);
const json = Store.exportData();
ok('JSON 내보내기', JSON.parse(json).order.length === 11);
const csv = Store.exportCsv();
ok('CSV 헤더', csv.includes('word,meaning,folder'), csv.split('\r\n')[0]);
ok('CSV 행 수', csv.split('\r\n').length === 12, csv.split('\r\n').length);

console.log('\n[9] 복원');
const dump = Store.exportData();
Store.wipe();
ok('전체 삭제', Store.favorites().length === 0);
const n = Store.importData(dump);
ok('가져오기 복원', n === 11 && Store.favorites().length === 11, n);
ok('순서 보존', Store.favorites()[0].word === 'word1', Store.favorites()[0].word);

console.log('\n[10] 저장소 왕복');
Store.saveNow();
Store.load();
ok('재시작 후에도 유지', Store.favorites().length === 11 && Store.get('word1').stats.mastered === true);

console.log('\n─────────────────────────');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
