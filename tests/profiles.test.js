// 아빠 단어장과 하람이 단어장이 같은 브라우저에서 서로 섞이지 않는지
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.argv[2];

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e).slice(0, 220) : '')); }
};

/** 한 페이지를 띄운다. 같은 localStorage 를 공유시켜 '같은 도메인' 상황을 재현한다. */
function boot(pageRel, sharedStore) {
  const html = fs.readFileSync(path.join(ROOT, pageRel), 'utf8');
  const dir = path.dirname(path.join(ROOT, pageRel));
  const dom = new JSDOM(html, { url: 'https://x.github.io/app/', runScripts: 'outside-only' });
  const { window } = dom;

  window.localStorage.clear();
  window.__store = sharedStore;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: k => (k in sharedStore ? sharedStore[k] : null),
      setItem: (k, v) => { sharedStore[k] = String(v); },
      removeItem: k => { delete sharedStore[k]; }
    }
  });

  window.fetch = () => Promise.reject(new Error('no network'));
  window.AbortController = AbortController;
  window.confirm = () => true;
  window.speechSynthesis = { cancel() {}, speak() {}, getVoices: () => [] };
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  // 페이지 안의 설정 스크립트(APP_PROFILE 등)를 먼저 실행
  [...window.document.querySelectorAll('script:not([src])')].forEach(el => window.eval(el.textContent));

  const errors = [];
  for (const f of ['js/store.js', 'js/api.js', 'js/review.js', 'js/app.js']) {
    try { window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
    catch (e) { errors.push(f + ': ' + e.message); }
  }
  return { window, doc: window.document, errors, dir };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ready(ctx) {
  await new Promise(r => (ctx.doc.readyState === 'complete' ? r() : ctx.window.addEventListener('load', r)));
  await sleep(30);
}

async function main() {
  const shared = {};          // 두 페이지가 공유하는 브라우저 저장소

  console.log('\n[1] 아빠 단어장에 단어 저장');
  const dad = boot('index.html', shared);
  await ready(dad);
  ok('스크립트 오류 없음', dad.errors.length === 0, dad.errors);
  ok('제목', dad.doc.title === '내 영어 단어장', dad.doc.title);
  dad.window.Store.batchAdd([{ word: 'alpha', ko: '아빠단어' }], '기본');
  dad.window.Store.saveNow();
  ok('아빠 단어 1개', dad.window.Store.favorites().length === 1);
  ok('저장 키가 기존 그대로', Object.keys(shared).indexOf('engvoc.v1') !== -1, Object.keys(shared));

  console.log('\n[2] 하람이 단어장 열기 (같은 브라우저)');
  const kid = boot('haram/index.html', shared);
  await ready(kid);
  ok('스크립트 오류 없음', kid.errors.length === 0, kid.errors);
  ok('제목', kid.doc.title === '하람이의 영어 단어장', kid.doc.title);
  ok('프로필 지정됨', kid.window.APP_PROFILE === 'haram', kid.window.APP_PROFILE);
  ok('아빠 단어가 보이지 않음', kid.window.Store.favorites().length === 0,
     kid.window.Store.favorites().map(w => w.word));

  console.log('\n[3] 하람이 단어 저장 후 서로 확인');
  kid.window.Store.batchAdd([{ word: 'bravo', ko: '하람단어' }, { word: 'charlie', ko: '하람단어2' }], '기본');
  kid.window.Store.saveNow();
  ok('하람이 단어 2개', kid.window.Store.favorites().length === 2);
  ok('별도 저장 키 사용', Object.keys(shared).indexOf('engvoc.haram.v1') !== -1, Object.keys(shared));

  dad.window.Store.load();
  ok('아빠 쪽은 그대로 1개', dad.window.Store.favorites().length === 1,
     dad.window.Store.favorites().map(w => w.word));
  ok('아빠 단어가 바뀌지 않음', dad.window.Store.get('alpha').myMeaning === '아빠단어');
  ok('아빠 쪽에 하람 단어 없음', !dad.window.Store.get('bravo'));

  kid.window.Store.load();
  ok('하람 쪽에 아빠 단어 없음', !kid.window.Store.get('alpha'));

  console.log('\n[4] 설정도 따로 저장되는가');
  dad.window.Store.setSetting('fastMs', 2000);
  kid.window.Store.setSetting('fastMs', 5000);
  dad.window.Store.saveNow(); kid.window.Store.saveNow();
  dad.window.Store.load(); kid.window.Store.load();
  ok('아빠 설정 유지', dad.window.Store.settings().fastMs === 2000, dad.window.Store.settings().fastMs);
  ok('하람 설정 유지', kid.window.Store.settings().fastMs === 5000, kid.window.Store.settings().fastMs);

  console.log('\n[5] 화면 구성이 동일한가');
  const ids = s => [...s.querySelectorAll('[id]')].map(e => e.id).sort().join(',');
  ok('모든 화면 요소 동일', ids(dad.doc) === ids(kid.doc));
  ok('탭 4개', kid.doc.querySelectorAll('.tab').length === 4);
  ok('학습 모드 4개', kid.doc.querySelectorAll('.mode-btn').length === 4);
  ok('보관함 버튼 있음', !!kid.doc.querySelector('#btnArchive'));

  console.log('\n[6] 하람이 페이지의 파일 경로');
  const kidHtml = fs.readFileSync(path.join(ROOT, 'haram/index.html'), 'utf8');
  ok('공용 CSS 를 상위에서 참조', kidHtml.indexOf('../css/styles.css') !== -1);
  ok('공용 JS 를 상위에서 참조', kidHtml.indexOf('../js/app.js') !== -1);
  ok('단어팩 경로 설정', kid.window.APP_BASE === '../', kid.window.APP_BASE);
  ok('전용 아이콘', kidHtml.indexOf('haram-192.png') !== -1);
  ok('전용 매니페스트 존재', fs.existsSync(path.join(ROOT, 'haram/manifest.webmanifest')));

  console.log('\n[7] 서비스워커 캐시 이름 분리');
  const dadSw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const kidSw = fs.readFileSync(path.join(ROOT, 'haram/sw.js'), 'utf8');
  ok('아빠 캐시 접두사', /var PREFIX = 'engvoc-'/.test(dadSw));
  ok('하람 캐시 접두사', /var PREFIX = 'haram-'/.test(kidSw));
  ok('아빠는 자기 캐시만 정리', dadSw.indexOf("k.indexOf(PREFIX) === 0") !== -1);
  ok('하람도 자기 캐시만 정리', kidSw.indexOf("k.indexOf(PREFIX) === 0") !== -1);

  console.log('\n-------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('테스트 중단:', e); process.exit(1); });
