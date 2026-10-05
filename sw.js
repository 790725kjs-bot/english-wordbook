/* =========================================================
   sw.js — 오프라인 지원
   앱 파일: 네트워크 우선(온라인이면 항상 최신) → 실패하면 캐시
   사전/번역 API: 캐시하지 않음 (앱이 결과를 직접 저장한다)
   ========================================================= */
var PREFIX = 'engvoc-';          // 이 앱이 쓰는 캐시 이름 앞머리
var CACHE = PREFIX + 'v15';   // 파일이 바뀌면 숫자를 올린다 (옛 캐시 자동 폐기)
var V = '?v=15';            // index.html 의 버전 표기와 맞춘다
var SHELL = [
  './',
  './index.html',
  './css/styles.css' + V,
  './js/store.js' + V,
  './js/api.js' + V,
  './js/review.js' + V,
  './js/app.js' + V,
  './js/pack.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (url) {
        return c.add(url).catch(function () { /* 일부 실패는 무시 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // 같은 도메인에 다른 단어장이 함께 있을 수 있으므로
      // 내 이름(PREFIX)으로 시작하는 옛 캐시만 지운다
      return Promise.all(keys.map(function (k) {
        return (k !== CACHE && k.indexOf(PREFIX) === 0) ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // 외부 API 는 캐시하지 않는다 (앱이 자체적으로 결과를 저장함)
  if (url.origin !== location.origin) return;

  // 네트워크 우선: 온라인이면 항상 최신 파일을 쓰고, 받은 것을 캐시에 넣어 둔다.
  // 오프라인일 때만 캐시를 꺼내 쓴다. (캐시 우선으로 두면 수정한 파일이 반영되지 않는다)
  // 페이지(HTML)는 항상 서버에 최신인지 물어본다.
  // GitHub Pages 가 10분 캐시를 지시하므로, 이게 없으면 고친 내용이 늦게 반영된다.
  var request = (req.mode === 'navigate')
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : req;

  e.respondWith(
    fetch(request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
