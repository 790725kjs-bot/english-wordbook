/* =========================================================
   sync.js — 기기 간 단어장 동기화 (GitHub Gist)

   단어장을 회원 본인 GitHub 계정의 '비공개 Gist' 한 곳에 두고,
   태블릿·휴대폰·PC 가 각자 그것과 주고받는다. 서버가 따로 필요 없다.

   토큰은 이 기기 브라우저에만 저장되며, 백업 파일에는 들어가지 않는다.
   ========================================================= */
(function (global) {
  'use strict';

  var API = 'https://api.github.com';
  var MARK = 'english-wordbook-sync';          // 내 Gist 를 알아보는 표시

  function profile() { return global.APP_PROFILE || 'main'; }
  function confKey() { return 'engvoc.sync.' + profile(); }
  function fileName() { return 'wordbook-' + profile() + '.json'; }
  function description() { return MARK + ' (' + profile() + ') — 내 영어 단어장 데이터'; }

  /* ------------------------- 설정 보관 ------------------------- */

  function conf() {
    try {
      return JSON.parse(global.localStorage.getItem(confKey()) || '{}') || {};
    } catch (e) { return {}; }
  }

  function saveConf(c) {
    try { global.localStorage.setItem(confKey(), JSON.stringify(c)); } catch (e) { /* 무시 */ }
  }

  function isOn() { return !!conf().token; }

  function status() {
    var c = conf();
    return {
      on: !!c.token,
      gistId: c.gistId || '',
      lastSync: c.lastSync || 0,
      lastError: c.lastError || '',
      profile: profile()
    };
  }

  function connect(token) {
    var t = String(token || '').trim();
    if (!t) return Promise.resolve({ ok: false, error: '토큰을 입력해 주세요' });

    // 토큰이 쓸 수 있는 것인지 먼저 확인한다
    return call('/gists?per_page=1', { token: t }).then(function () {
      var c = conf();
      c.token = t;
      c.lastError = '';
      saveConf(c);
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: friendly(e) };
    });
  }

  function disconnect() {
    var c = conf();
    delete c.token;
    c.lastError = '';
    saveConf(c);          // gistId 는 남겨 둔다 (다시 연결하면 같은 곳을 쓴다)
  }

  function friendly(e) {
    var m = String((e && e.message) || e || '');
    if (/401/.test(m)) return '토큰이 올바르지 않습니다. 다시 발급해 주세요.';
    if (/403/.test(m)) return 'GitHub 가 요청을 거부했습니다. 토큰 권한(Gists 읽기/쓰기)을 확인해 주세요.';
    if (/404/.test(m)) return '저장 공간을 찾지 못했습니다.';
    if (/Failed to fetch|NetworkError|aborted/i.test(m)) return '인터넷 연결을 확인해 주세요.';
    return m || '알 수 없는 오류';
  }

  /* ------------------------- GitHub 호출 ------------------------- */

  function call(path, opts) {
    opts = opts || {};
    var token = opts.token || conf().token;
    if (!token) return Promise.reject(new Error('연결되어 있지 않습니다'));

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 15000);

    var init = {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    return fetch(API + path, init).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.status === 204 ? null : res.json();
    }).catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  /** 내 단어장 Gist 를 찾고, 없으면 만든다 */
  function ensureGist() {
    var c = conf();
    if (c.gistId) return Promise.resolve(c.gistId);

    return call('/gists?per_page=100').then(function (list) {
      var found = null;
      (list || []).forEach(function (g) {
        if (found) return;
        if (g.files && g.files[fileName()]) found = g.id;
        else if (String(g.description || '').indexOf(description()) === 0) found = g.id;
      });
      if (found) {
        c.gistId = found;
        saveConf(c);
        return found;
      }
      var files = {};
      files[fileName()] = { content: JSON.stringify(Store.syncPayload(), null, 1) };
      return call('/gists', {
        method: 'POST',
        body: { description: description(), public: false, files: files }
      }).then(function (g) {
        c.gistId = g.id;
        saveConf(c);
        return g.id;
      });
    });
  }

  function readGist(id) {
    return call('/gists/' + id).then(function (g) {
      var f = g.files && g.files[fileName()];
      if (!f) return null;
      if (f.truncated && f.raw_url) {
        return fetch(f.raw_url).then(function (r) { return r.json(); });
      }
      try { return JSON.parse(f.content); } catch (e) { return null; }
    });
  }

  function writeGist(id, payload) {
    var files = {};
    files[fileName()] = { content: JSON.stringify(payload, null, 1) };
    return call('/gists/' + id, { method: 'PATCH', body: { files: files } });
  }

  /* ------------------------- 동기화 ------------------------- */

  var running = false;

  /**
   * 받아서 합치고, 다시 올린다.
   * @returns {Promise<{ok:boolean, added?:number, updated?:number, removed?:number, error?:string}>}
   */
  function run() {
    if (!isOn()) return Promise.resolve({ ok: false, error: '연결되어 있지 않습니다' });
    if (running) return Promise.resolve({ ok: false, error: '이미 동기화 중입니다' });
    if (!navigator.onLine) return Promise.resolve({ ok: false, error: '인터넷에 연결되어 있지 않습니다' });

    running = true;
    return ensureGist()
      .then(function (id) {
        return readGist(id).then(function (remote) {
          var res = Store.mergeRemote(remote);
          return writeGist(id, Store.syncPayload()).then(function () { return res; });
        });
      })
      .then(function (res) {
        var c = conf();
        c.lastSync = Date.now();
        c.lastError = '';
        saveConf(c);
        running = false;
        return { ok: true, added: res.added, updated: res.updated, removed: res.removed };
      })
      .catch(function (e) {
        var c = conf();
        c.lastError = friendly(e);
        saveConf(c);
        running = false;
        return { ok: false, error: c.lastError };
      });
  }

  global.Sync = {
    isOn: isOn,
    status: status,
    connect: connect,
    disconnect: disconnect,
    run: run,
    fileName: fileName
  };
})(window);
