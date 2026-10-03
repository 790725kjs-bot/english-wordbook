/* =========================================================
   store.js — 로컬 저장소 (localStorage)
   words   : 단어 사전 데이터 + 내 뜻 + 암기 통계
   order   : 즐겨찾기에 "추가한 순서" (알파벳순 아님)
   queue   : 암기 출제 순서 (앞에 있을수록 빨리 나옴)
   cache   : 검색해 본 단어의 사전 응답 (오프라인 재사용)
   ========================================================= */
(function (global) {
  'use strict';

  var KEY = 'engvoc.v1';
  var CACHE_MAX = 400;      // 사전 응답 캐시 최대 개수
  var RECENT_MAX = 24;      // 최근 검색어 개수
  var TRANS_MAX = 1200;     // 번역 캐시 최대 개수

  var DEFAULT_SETTINGS = {
    fastMs: 2000,        // 즉답 기준 (2초)
    targetStreak: 4,     // 연속 즉답 4회 → 뒤로 밀기
    autoTranslate: true, // 한글 뜻 자동 번역
    exampleTranslate: true, // 예문의 한글 뜻도 함께 저장
    autoFill: true,      // 인터넷에 연결돼 있으면 한글 뜻·예문을 알아서 채움
    ttsRate: 0.9,        // 발음 속도
    listenGap: 1500,     // 연속 듣기 카드 간격(ms)
    listenExample: true  // 연속 듣기에 예문 포함
  };

  var DEFAULT_FOLDER = '기본';

  var state = null;
  var saveTimer = null;

  function blank() {
    return {
      version: 1,
      words: {},      // id -> word object
      order: [],      // 즐겨찾기 추가 순서 (별표 켜진 단어)
      archive: [],    // 보관함 — 별표를 껐지만 받아 둔 자료와 기록은 그대로 남긴다
      queue: [],      // 암기 출제 순서
      folders: [DEFAULT_FOLDER],
      recent: [],     // 최근 검색어 (문자열)
      cache: {},      // word -> 사전 entry
      cacheOrder: [], // 캐시 LRU
      trans: {},      // 번역 캐시 "en|ko|text" -> 결과
      transOrder: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      stats: { totalAnswers: 0, fastAnswers: 0 }
    };
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { /* 시크릿 모드 등 */ }
    if (!raw) { state = blank(); return state; }
    try {
      var data = JSON.parse(raw);
      state = Object.assign(blank(), data);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      // 무결성 보정
      if (!state.words || typeof state.words !== 'object') state.words = {};
      ['order', 'archive', 'queue', 'recent', 'cacheOrder', 'transOrder', 'folders'].forEach(function (k) {
        if (!Array.isArray(state[k])) state[k] = [];
      });
      if (state.folders.indexOf(DEFAULT_FOLDER) === -1) state.folders.unshift(DEFAULT_FOLDER);
      state.order = state.order.filter(function (id) { return !!state.words[id]; });
      state.archive = state.archive.filter(function (id) {
        return !!state.words[id] && state.order.indexOf(id) === -1;
      });
      // 보관함 단어는 출제 대기열에서 빠진다
      state.queue = state.queue.filter(function (id) {
        return !!state.words[id] && state.archive.indexOf(id) === -1;
      });
      // 즐겨찾기에 있는데 큐에 없는 단어 보충
      state.order.forEach(function (id) {
        if (state.queue.indexOf(id) === -1) state.queue.push(id);
      });
      // 어느 목록에도 없는 단어가 생기면 잃어버리지 않도록 보관함으로
      Object.keys(state.words).forEach(function (id) {
        if (state.order.indexOf(id) === -1 && state.archive.indexOf(id) === -1) {
          state.archive.push(id);
        }
      });
    } catch (e) {
      state = blank();
    }
    return state;
  }

  function saveNow() {
    if (!state) return;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // 용량 초과 시 캐시부터 비우고 재시도
      try {
        state.cache = {}; state.cacheOrder = [];
        state.trans = {}; state.transOrder = [];
        global.localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e2) {
        if (global.App && global.App.toast) global.App.toast('저장 공간이 부족합니다');
      }
    }
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function normId(word) {
    return String(word || '').trim().toLowerCase();
  }

  function newStats() {
    return { fastStreak: 0, seen: 0, correct: 0, fast: 0, lastSeen: 0, lastMs: 0, mastered: false };
  }

  /* ------------------------- 단어 ------------------------- */

  function get(id) { return state.words[normId(id)] || null; }

  function isFav(id) { return state.order.indexOf(normId(id)) !== -1; }

  /**
   * 즐겨찾기 추가. entry는 api.js가 만든 정규화된 사전 데이터.
   * 이미 있으면 사전 데이터만 갱신하고 순서는 유지한다.
   */
  function addFav(entry, myMeaning, folder) {
    var id = normId(entry.word);
    if (!id) return null;
    var w = state.words[id];
    if (!w) {
      w = {
        id: id,
        word: entry.word,
        addedAt: Date.now(),
        myMeaning: myMeaning || '',
        note: '',
        folder: folder || DEFAULT_FOLDER,
        stats: newStats()
      };
      state.words[id] = w;
      addFolder(w.folder);
    }
    w.phonetic = entry.phonetic || w.phonetic || '';
    w.audio = entry.audio || w.audio || '';
    w.meanings = entry.meanings || w.meanings || [];
    w.sourceUrl = entry.sourceUrl || w.sourceUrl || '';
    if (myMeaning && !w.myMeaning) w.myMeaning = myMeaning;
    if (state.order.indexOf(id) === -1) state.order.push(id);
    if (state.queue.indexOf(id) === -1) state.queue.splice(0, 0, id); // 새 단어는 앞쪽에
    save();
    return w;
  }

  /** 완전 삭제 — 받아 둔 자료와 기록까지 모두 지운다 */
  function removeFav(id) {
    id = normId(id);
    [state.order, state.queue, state.archive].forEach(function (arr) {
      var i = arr.indexOf(id);
      if (i !== -1) arr.splice(i, 1);
    });
    delete state.words[id];
    save();
  }

  /**
   * 보관함으로 보내기 — 별표만 끄고 뜻·예문·암기 기록은 그대로 남긴다.
   * 나중에 복원하면 다시 내려받을 필요가 없다.
   */
  function archiveFav(id) {
    id = normId(id);
    var w = state.words[id];
    if (!w) return;
    var i = state.order.indexOf(id);
    if (i !== -1) state.order.splice(i, 1);
    var q = state.queue.indexOf(id);
    if (q !== -1) state.queue.splice(q, 1);
    if (state.archive.indexOf(id) === -1) state.archive.unshift(id);
    w.archivedAt = Date.now();
    save();
  }

  /** 보관함에서 단어장으로 되돌리기 (원래의 추가 순서 자리로) */
  function restoreFav(id) {
    id = normId(id);
    var w = state.words[id];
    if (!w) return;
    var a = state.archive.indexOf(id);
    if (a !== -1) state.archive.splice(a, 1);

    if (state.order.indexOf(id) === -1) {
      var at = w.addedAt || 0;
      var pos = state.order.length;
      for (var k = 0; k < state.order.length; k++) {
        var other = state.words[state.order[k]];
        if (other && (other.addedAt || 0) > at) { pos = k; break; }
      }
      state.order.splice(pos, 0, id);
    }
    if (state.queue.indexOf(id) === -1) state.queue.unshift(id);
    delete w.archivedAt;
    save();
  }

  function isArchived(id) { return state.archive.indexOf(normId(id)) !== -1; }

  /** 보관함 목록 — 오래전에 보관한 것이 위로 (알파벳순 아님) */
  function archived() {
    return state.archive.map(function (id) { return state.words[id]; })
      .filter(Boolean)
      .sort(function (a, b) { return (a.archivedAt || 0) - (b.archivedAt || 0); });
  }

  function update(id, patch) {
    var w = get(id);
    if (!w) return null;
    Object.assign(w, patch);
    save();
    return w;
  }

  /** 즐겨찾기 목록을 추가 순서대로 반환 (folder 지정 시 해당 폴더만) */
  function favorites(folder) {
    var list = state.order.map(function (id) { return state.words[id]; }).filter(Boolean);
    if (folder && folder !== '*') {
      list = list.filter(function (w) { return (w.folder || DEFAULT_FOLDER) === folder; });
    }
    return list;
  }

  /* ------------------------- 폴더 ------------------------- */

  function folders() {
    var used = {};
    Object.keys(state.words).forEach(function (id) {
      used[state.words[id].folder || DEFAULT_FOLDER] = true;
    });
    var list = state.folders.slice();
    Object.keys(used).forEach(function (f) { if (list.indexOf(f) === -1) list.push(f); });
    return list;
  }

  function folderCounts() {
    var c = {};
    favorites().forEach(function (w) {
      var f = w.folder || DEFAULT_FOLDER;
      c[f] = (c[f] || 0) + 1;
    });
    return c;
  }

  function addFolder(name) {
    name = String(name || '').trim();
    if (!name) return null;
    if (state.folders.indexOf(name) === -1) { state.folders.push(name); save(); }
    return name;
  }

  function removeFolder(name) {
    if (name === DEFAULT_FOLDER) return;
    var i = state.folders.indexOf(name);
    if (i !== -1) state.folders.splice(i, 1);
    Object.keys(state.words).forEach(function (id) {
      if (state.words[id].folder === name) state.words[id].folder = DEFAULT_FOLDER;
    });
    save();
  }

  function setFolder(id, folder) {
    var w = get(id);
    if (!w) return;
    w.folder = addFolder(folder) || DEFAULT_FOLDER;
    save();
  }

  /* ------------------------- 일괄 추가 ------------------------- */

  /**
   * items: [{word, ko}]  — 사전 정보 없이 먼저 저장하고, 나중에 채워 넣는다.
   * 이미 있는 단어는 건너뛰되, 뜻이 비어 있으면 채워 준다.
   */
  function batchAdd(items, folder) {
    var added = 0, skipped = 0;
    items.forEach(function (it) {
      var id = normId(it.word);
      if (!id) return;
      var exist = state.words[id];
      if (exist) {
        if (!exist.myMeaning && it.ko) exist.myMeaning = it.ko;
        skipped++;
        return;
      }
      state.words[id] = {
        id: id,
        word: it.word,
        addedAt: Date.now(),
        myMeaning: it.ko || '',
        note: '',
        folder: folder || DEFAULT_FOLDER,
        meanings: [],
        stats: newStats()
      };
      state.order.push(id);
      state.queue.push(id);
      added++;
    });
    if (folder) addFolder(folder);
    saveNow();
    return { added: added, skipped: skipped };
  }

  /** 사전 정보가 아직 없는 단어들의 id 목록 (백그라운드 보강용) */
  function needsDetail() {
    return favorites().filter(function (w) {
      return !w.meanings || !w.meanings.length;
    }).map(function (w) { return w.id; });
  }

  /* ------------------------- 캐시 ------------------------- */

  function putCache(entry) {
    if (!entry || !entry.word) return;
    var id = normId(entry.word);
    if (!state.cache[id]) state.cacheOrder.push(id);
    state.cache[id] = entry;
    while (state.cacheOrder.length > CACHE_MAX) {
      var old = state.cacheOrder.shift();
      if (old !== id) delete state.cache[old];
    }
    save();
  }

  function getCache(word) { return state.cache[normId(word)] || null; }

  function pushRecent(word) {
    var w = String(word || '').trim();
    if (!w) return;
    var i = state.recent.indexOf(w);
    if (i !== -1) state.recent.splice(i, 1);
    state.recent.unshift(w);
    if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
    save();
  }

  function getTrans(key) { return state.trans[key] || null; }

  function putTrans(key, value) {
    if (!state.trans[key]) state.transOrder.push(key);
    state.trans[key] = value;
    while (state.transOrder.length > TRANS_MAX) {
      var old = state.transOrder.shift();
      if (old !== key) delete state.trans[old];
    }
    save();
  }

  /* ------------------------- 설정 ------------------------- */

  function settings() { return state.settings; }

  function setSetting(k, v) {
    state.settings[k] = v;
    save();
  }

  /* ------------------------- 백업 ------------------------- */

  function exportData() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      words: state.words,
      order: state.order,
      archive: state.archive,
      queue: state.queue,
      folders: state.folders,
      settings: state.settings,
      stats: state.stats
    }, null, 2);
  }

  /** 엑셀·다른 단어장 앱으로 옮길 때 쓰는 CSV */
  function exportCsv() {
    function cell(v) {
      v = String(v == null ? '' : v).replace(/"/g, '""');
      return '"' + v + '"';
    }
    var rows = [['word', 'meaning', 'folder', 'example', 'seen', 'fastStreak'].join(',')];
    favorites().forEach(function (w) {
      var ex = '';
      (w.meanings || []).some(function (m) {
        return m.defs.some(function (d) { if (d.example) { ex = d.example; return true; } return false; });
      });
      var st = w.stats || {};
      rows.push([cell(w.word), cell(w.myMeaning), cell(w.folder || DEFAULT_FOLDER),
                 cell(ex), st.seen || 0, st.fastStreak || 0].join(','));
    });
    return '﻿' + rows.join('\r\n');   // BOM: 엑셀 한글 깨짐 방지
  }

  /** 가져오기: 기존 단어는 유지하고 없는 단어만 뒤에 붙인다 */
  function importData(json) {
    var data = JSON.parse(json);
    if (!data || !data.words || !Array.isArray(data.order)) {
      throw new Error('형식이 올바르지 않습니다');
    }
    var added = 0;
    data.order.forEach(function (id) {
      var w = data.words[id];
      if (!w) return;
      if (!state.words[id]) {
        w.stats = Object.assign(newStats(), w.stats || {});
        state.words[id] = w;
        state.order.push(id);
        state.queue.push(id);
        added++;
      }
    });
    (data.archive || []).forEach(function (id) {
      var w = data.words[id];
      if (!w || state.words[id]) return;
      w.stats = Object.assign(newStats(), w.stats || {});
      state.words[id] = w;
      state.archive.push(id);
      added++;
    });
    if (Array.isArray(data.folders)) data.folders.forEach(addFolder);
    if (data.settings) state.settings = Object.assign({}, state.settings, data.settings);
    saveNow();
    return added;
  }

  function resetStats() {
    Object.keys(state.words).forEach(function (id) {
      state.words[id].stats = newStats();
    });
    state.queue = state.order.slice();
    state.stats = { totalAnswers: 0, fastAnswers: 0 };
    saveNow();
  }

  function wipe() {
    state = blank();
    saveNow();
  }

  global.Store = {
    load: load,
    save: save,
    saveNow: saveNow,
    raw: function () { return state; },
    normId: normId,
    newStats: newStats,
    get: get,
    isFav: isFav,
    addFav: addFav,
    removeFav: removeFav,
    archiveFav: archiveFav,
    restoreFav: restoreFav,
    isArchived: isArchived,
    archived: archived,
    update: update,
    favorites: favorites,
    folders: folders,
    folderCounts: folderCounts,
    addFolder: addFolder,
    removeFolder: removeFolder,
    setFolder: setFolder,
    batchAdd: batchAdd,
    needsDetail: needsDetail,
    exportCsv: exportCsv,
    DEFAULT_FOLDER: DEFAULT_FOLDER,
    putCache: putCache,
    getCache: getCache,
    pushRecent: pushRecent,
    recent: function () { return state.recent.slice(); },
    getTrans: getTrans,
    putTrans: putTrans,
    settings: settings,
    setSetting: setSetting,
    exportData: exportData,
    importData: importData,
    resetStats: resetStats,
    wipe: wipe
  };
})(window);
