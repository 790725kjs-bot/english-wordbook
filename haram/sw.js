/* =========================================================
   haram/sw.js — 하람이 단어장 오프라인 지원
   앱 파일: 네트워크 우선(온라인이면 항상 최신) → 실패하면 캐시
   캐시 이름은 아빠 단어장과 겹치지 않게 'haram-' 으로 시작한다.
   ========================================================= */
var PREFIX = 'haram-';
var CACHE = PREFIX + 'v2';
var V = '?v=13';            // index.html 의 버전 표기와 맞춘다
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../css/styles.css' + V,
  '../js/store.js' + V,
  '../js/api.js' + V,
  '../js/review.js' + V,
  '../js/app.js' + V,
  '../js/pack.js',
  '../icons/haram-192.png',
  '../icons/haram-512.png'
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
      // 같은 도메인에 아빠 단어장도 있으므로 내 캐시만 정리한다
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
  if (url.origin !== location.origin) return;   // 사전·번역 API 는 캐시하지 않는다

  e.respondWith(
    fetch(req).then(function (res) {
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
