/* =========================================================
   app.js — 화면 로직
   찾기 / 단어장 / 암기(4가지 모드) / 설정
   ========================================================= */
(function (global) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var pendingMeaning = '';    // 아직 저장 안 한 단어의 '내 뜻'
  var lastEntry = null;       // 현재 검색 결과
  var currentView = 'search';
  var listFolder = '*';       // 단어장 화면에서 보고 있는 폴더
  var reviewFolder = '*';     // 암기 범위
  var maskMeanings = false;   // 단어장에서 뜻 가리기
  var showArchive = false;    // 단어장 대신 보관함 보기
  var sheetMode = 'entry';    // entry | bulk

  var MODE_NAME = { flash: '플래시카드', mcq: '객관식', spell: '스펠링', listen: '연속 듣기' };

  /* ================= 공통 ================= */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 1900);
  }

  function setView(name) {
    if (currentView === 'review' && name !== 'review') endReview(true);
    currentView = name;
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    $('#main').scrollTop = 0;
    if (name === 'list') renderFavList();
    if (name === 'review') renderReviewIntro();
    if (name === 'settings') fillSettings();
  }

  function updateNetBadge() {
    var b = $('#netBadge');
    var on = navigator.onLine;
    b.textContent = on ? '온라인' : '오프라인';
    b.classList.toggle('badge-off', !on);
  }

  function folderOf(w) { return (w && w.folder) || Store.DEFAULT_FOLDER; }

  /* ================= 단어 카드 ================= */

  function entryHtml(entry, opts) {
    opts = opts || {};
    var saved = opts.saved || Store.get(entry.word);
    var known = !!saved;                     // 저장된 자료가 있는가 (보관함 포함)
    var fav = Store.isFav(entry.word);       // 별표가 켜져 있는가
    var archived = known && !fav;
    var mine = known ? (saved.myMeaning || '') : pendingMeaning;
    var exKo = (known && saved.exKo) || {};
    var defKo = (known && saved.defKo) || {};
    var w = esc(entry.word);

    var h = '<div class="entry" data-word="' + w + '">';

    h += '<div class="entry-head"><div class="entry-head-main">';
    h += '<h2 class="entry-word">' + w + '</h2>';
    if (entry.phonetic) h += '<div class="entry-phonetic">' + esc(entry.phonetic) + '</div>';
    h += '</div><div class="entry-actions">';
    h += '<button class="icon-btn" data-act="speak" data-text="' + w + '" data-audio="' +
         esc(entry.audio || '') + '" aria-label="발음 듣기">🔊</button>';
    h += '<button class="star-btn' + (fav ? ' on' : '') + '" data-act="star" aria-label="즐겨찾기">' +
         (fav ? '★' : '☆') + '</button>';
    h += '</div></div>';

    if (archived) {
      h += '<div class="archived-note">보관함에 있는 단어입니다. ☆ 를 누르면 단어장으로 되돌아갑니다.</div>';
    }

    h += '<div class="mymean"><div class="mymean-label">내 뜻 · 탭해서 수정</div>';
    h += '<div class="mymean-text" contenteditable="true" data-act="mymean">' + esc(mine) + '</div></div>';

    if (known) {
      var folders = Store.folders();
      h += '<div class="pos-block" style="display:flex;align-items:center;gap:8px">';
      h += '<span class="section-title" style="margin:0">폴더</span>';
      h += '<select class="select" data-act="folder" style="flex:1">';
      folders.forEach(function (f) {
        h += '<option value="' + esc(f) + '"' + (folderOf(saved) === f ? ' selected' : '') + '>' + esc(f) + '</option>';
      });
      h += '<option value="__new__">+ 새 폴더…</option>';
      h += '</select></div>';
    }

    (entry.meanings || []).forEach(function (m, mi) {
      h += '<div class="pos-block">';
      h += '<span class="pos-name">' + esc(m.pos) + (m.posKo ? ' · ' + esc(m.posKo) : '') + '</span>';
      m.defs.forEach(function (d, di) {
        h += '<div class="def-item"><div class="def-row">';
        h += '<span class="def-num' + (d.primary ? ' primary' : '') + '">' + (di + 1) + '</span>';
        h += '<span class="def-text' + (d.primary ? ' primary' : '') + '">' + esc(d.def);
        if (d.primary) h += '<span class="def-tag">자주 쓰임</span>';
        h += '</span></div>';
        h += '<div class="def-ko" data-ko-slot="d' + mi + '-' + di + '">' +
             esc(defKo[d.def] || '') + '</div>';
        if (!defKo[d.def]) {
          h += '<div class="example-tools" style="margin-left:27px">';
          h += '<button class="mini-btn" data-act="trans" data-kind="def" data-text="' + esc(d.def) +
               '" data-slot="d' + mi + '-' + di + '">한글 뜻</button></div>';
        }
        if (d.example) {
          h += exampleHtml(d.example, exKo[d.example], 'e' + mi + '-' + di);
        }
        if (d.synonyms && d.synonyms.length) {
          h += '<div class="syn">비슷한 말: ' + esc(d.synonyms.join(', ')) + '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    });

    if (!entry.meanings || !entry.meanings.length) {
      h += '<div class="pos-block"><div class="def-text" style="color:var(--text-3)">';
      h += navigator.onLine
        ? '사전 뜻이 아직 없습니다. 위에 뜻을 직접 적어 두세요.'
        : '오프라인이라 사전 뜻을 불러오지 못했습니다. 연결되면 자동으로 채워집니다.';
      h += '</div>';
      if (navigator.onLine) {
        h += '<div class="btn-row"><button class="btn btn-ghost" data-act="refetch">사전에서 다시 찾기</button></div>';
      }
      h += '</div>';
    }

    // 사전 정의에 예문이 없어 따로 보충해 온 예문
    if (known && saved.examples && saved.examples.length) {
      h += '<div class="pos-block">';
      h += '<span class="pos-name">예문' +
           (saved.examplesFrom ? ' · 관련 단어 ' + esc(saved.examplesFrom) : '') + '</span>';
      saved.examples.forEach(function (t, xi) {
        h += exampleHtml(t, exKo[t], 'x' + xi);
      });
      h += '</div>';
    }

    if (known && opts.showNote !== false) {
      var st = saved.stats || {};
      var c = Review.conf();
      h += '<div class="entry-note"><div class="section-title">메모</div>';
      h += '<textarea class="note-input" data-act="note" placeholder="연상법·나만의 예문 등">' +
           esc(saved.note || '') + '</textarea>';
      h += '<div class="hint" style="margin-top:8px">출제 ' + (st.seen || 0) + '회 · 즉답 ' +
           (st.fast || 0) + '회 · 연속 ' + Review.streakDots(st.fastStreak || 0, c.target) + '</div>';
      h += '<div class="btn-row"><button class="btn btn-danger-ghost" data-act="remove">완전히 삭제 (자료·기록까지)</button></div>';
      h += '</div>';
    }

    return h + '</div>';
  }

  /* ================= 예문 확보 · 번역 저장 =================
     단어장에는 뜻뿐 아니라 "예문 + 그 뜻" 이 함께 남아야 하므로,
     저장 시점에 예문을 확보하고 한글 번역까지 붙여 둔다.
     ========================================================= */

  /** 단어가 가진 모든 예문(정의에 붙은 것 + 보충해 온 것) */
  function allExamples(w) {
    var list = [];
    (w.meanings || []).forEach(function (m) {
      m.defs.forEach(function (d) {
        if (d.example && list.indexOf(d.example) === -1) list.push(d.example);
      });
    });
    (w.examples || []).forEach(function (e) {
      if (e && list.indexOf(e) === -1) list.push(e);
    });
    return list;
  }

  /**
   * 저장된 단어의 예문을 채우고 번역까지 붙인다.
   * @param {string} id 단어 id
   * @param {function} [done] 완료 콜백 (화면 갱신용)
   */
  function ensureExamples(id, done, opts) {
    opts = opts || {};
    var w = Store.get(id);
    if (!w) { if (done) done(false); return; }
    if (!navigator.onLine) { if (done) done(false); return; }

    var changed = false;

    /** 영어 뜻풀이와 예문을 한글로 옮겨 저장한다 */
    function translateThem() {
      if (opts.translate === false || !Store.settings().exampleTranslate) {
        if (done) done(changed);
        return;
      }

      w.defKo = w.defKo || {};
      w.exKo = w.exKo || {};

      // 영어 뜻풀이 (최대 3개)
      var defs = [];
      (w.meanings || []).forEach(function (m) {
        m.defs.forEach(function (d) {
          if (d.def && defs.length < 3 && defs.indexOf(d.def) === -1) defs.push(d.def);
        });
      });

      var jobs = [];
      defs.forEach(function (t) {
        if (w.defKo[t]) return;
        jobs.push(Api.translate(t).then(function (ko) {
          if (ko) { w.defKo[t] = ko; changed = true; }
        }));
      });
      allExamples(w).slice(0, 2).forEach(function (t) {
        if (w.exKo[t]) return;
        jobs.push(Api.translate(t).then(function (ko) {
          if (ko) { w.exKo[t] = ko; changed = true; }
        }));
      });

      if (!jobs.length) { if (done) done(changed); return; }
      Promise.all(jobs).then(function () {
        Store.save();
        if (done) done(changed);
      });
    }

    // 예문이 이미 있거나, 전에 찾아봤지만 없던 단어면 바로 번역으로 넘어간다
    if (allExamples(w).length || w.exTried) { translateThem(); return; }

    // 예문이 하나도 없으면 Wiktionary 원문에서 보충하고,
    // 그래도 없으면 관련 단어(resentful -> resent)의 예문을 가져온다
    Api.fetchWikiExamples(w.word, 2).then(function (ex) {
      if (ex && ex.length) return { list: ex, from: '' };

      var rel = Api.relatedForms(w.word).slice(0, 2);
      function tryRel(i) {
        if (i >= rel.length) return Promise.resolve({ list: [], from: '' });
        return Api.fetchWikiExamples(rel[i], 2).then(function (r) {
          return (r && r.length) ? { list: r, from: rel[i] } : tryRel(i + 1);
        });
      }
      return tryRel(0);
    }).then(function (res) {
      w.exTried = true;              // 없는 단어를 매번 다시 조회하지 않도록
      if (res.list.length) {
        w.examples = res.list;
        if (res.from) w.examplesFrom = res.from;
        changed = true;
      }
      Store.save();
      translateThem();
    });
  }

  /**
   * 화면에 그려진 카드의 영어 뜻풀이·예문 아래에 한글을 채워 넣는다.
   * 찾기 결과도 단어장 상세와 똑같이 보이도록 하기 위한 것.
   * 번역 한도를 생각해 뜻풀이 3개, 예문 2개까지만 받는다.
   */
  function fillKoreanSlots(rootSel, entry) {
    if (!navigator.onLine || !entry || !entry.meanings) return;
    if (!Store.settings().exampleTranslate) return;

    var jobs = [];
    var defLeft = 3, exLeft = 2;

    entry.meanings.forEach(function (m, mi) {
      m.defs.forEach(function (d, di) {
        if (defLeft > 0) {
          jobs.push({ text: d.def, slot: 'd' + mi + '-' + di, kind: 'def' });
          defLeft--;
        }
        if (d.example && exLeft > 0) {
          jobs.push({ text: d.example, slot: 'e' + mi + '-' + di, kind: 'ex' });
          exLeft--;
        }
      });
    });

    jobs.forEach(function (job) {
      var root = $(rootSel);
      var slot = root && root.querySelector('[data-ko-slot="' + job.slot + '"]');
      if (!slot || slot.textContent.trim()) return;

      Api.translate(job.text).then(function (ko) {
        if (!ko) return;
        // 번역이 오는 사이 화면이 바뀌었을 수 있으니 다시 찾는다
        var root2 = $(rootSel);
        var slot2 = root2 && root2.querySelector('[data-ko-slot="' + job.slot + '"]');
        if (!slot2 || slot2.textContent.trim()) return;
        slot2.textContent = ko;

        var btn = root2.querySelector('[data-act="trans"][data-slot="' + job.slot + '"]');
        if (btn) btn.hidden = true;

        // 저장된 단어면 다음에 또 받지 않도록 남겨 둔다
        var host = slot2.closest('.entry');
        var sw = host && Store.get(host.dataset.word);
        if (sw) {
          var bucket = job.kind === 'def' ? 'defKo' : 'exKo';
          sw[bucket] = sw[bucket] || {};
          sw[bucket][job.text] = ko;
          Store.save();
        }
      });
    });
  }

  /** 예문 한 줄의 HTML (한글 뜻이 있으면 함께, 없으면 번역 버튼) */
  function exampleHtml(text, ko, slot) {
    var h = '<div class="example">';
    h += '<span class="example-en">' + esc(text) + '</span>';
    h += '<span class="example-ko" data-ko-slot="' + slot + '">' + esc(ko || '') + '</span>';
    h += '<span class="example-tools">';
    h += '<button class="mini-btn" data-act="speak" data-text="' + esc(text) + '">🔊 듣기</button>';
    if (!ko) {
      h += '<button class="mini-btn" data-act="trans" data-kind="ex" data-text="' + esc(text) +
           '" data-slot="' + slot + '">한글 뜻</button>';
    }
    h += '</span></div>';
    return h;
  }

  /**
   * 저장한 단어 전부의 한글 뜻·예문을 미리 받아 둔다 (오프라인 대비).
   * 번역 서버에 부담을 주지 않도록 한 단어씩 순서대로 처리한다.
   */
  var AUTO_BATCH = 40;      // 자동으로는 한 번에 이만큼까지만 (번역 한도 배려)
  var fillJob = null;

  /** 아직 한글 뜻이나 예문이 비어 있는 단어들 */
  function wordsNeedingKorean() {
    return Store.favorites().filter(function (w) {
      var needDef = (w.meanings || []).some(function (m) {
        return m.defs.some(function (d) { return !(w.defKo && w.defKo[d.def]); });
      });
      var needEx = !allExamples(w).length && !w.exTried;
      var needExKo = allExamples(w).slice(0, 2).some(function (t) { return !(w.exKo && w.exKo[t]); });
      return needDef || needEx || needExKo;
    });
  }

  function setFillStatus(msg) {
    var el = $('#fillKoStatus');
    if (el) el.textContent = msg;
  }

  /**
   * 한글 뜻·예문 채우기.
   * manual=true 면 끝까지, 아니면 조금씩 천천히 (앱을 열어 둔 동안 알아서 진행).
   */
  function startFill(manual) {
    if (!navigator.onLine) {
      if (manual) toast('인터넷에 연결된 상태에서 눌러 주세요');
      return;
    }
    if (fillJob) {                       // 이미 돌고 있으면 범위만 넓힌다
      if (manual) { fillJob.manual = true; fillJob.list = wordsNeedingKorean(); }
      return;
    }

    var list = wordsNeedingKorean();
    if (!list.length) {
      if (manual) setFillStatus('이미 모두 채워져 있습니다.');
      return;
    }
    if (!manual) {
      var conn = navigator.connection;
      if (conn && conn.saveData) return;              // 데이터 절약 모드면 건드리지 않는다
      if (!Store.settings().autoFill) return;
      list = list.slice(0, AUTO_BATCH);
    }

    fillJob = { list: list, i: 0, updated: 0, manual: !!manual };
    var btn = $('#btnFillKo');
    if (btn) btn.disabled = true;

    (function step() {
      if (!fillJob) return;
      if (!navigator.onLine) { finish('연결이 끊겨 멈췄습니다.'); return; }
      if (fillJob.i >= fillJob.list.length) {
        var left = wordsNeedingKorean().length;
        finish(left ? '채움 ' + fillJob.updated + '개 · 남은 단어 ' + left + '개 (앱을 열어 두면 계속됩니다)'
                    : '완료 — 모든 단어가 준비됐습니다.');
        return;
      }
      var w = fillJob.list[fillJob.i++];
      setFillStatus('채우는 중… ' + fillJob.i + ' / ' + fillJob.list.length + '  (' + w.word + ')');
      ensureExamples(w.id, function (changed) {
        if (changed) fillJob.updated++;
        setTimeout(step, fillJob.manual ? 250 : 1500);   // 자동일 때는 천천히
      });
    })();

    function finish(msg) {
      var job = fillJob;
      fillJob = null;
      if (btn) btn.disabled = false;
      setFillStatus(msg);
      if (job && job.updated) {
        renderFavList();
        if (job.manual) toast('오프라인 준비 완료 (' + job.updated + '개)');
      }
    }
  }

  function fillAllKorean() { startFill(true); }

  /* ================= 찾기 ================= */

  function setStatus(msg, isError, suggestions) {
    var el = $('#searchStatus');
    if (!msg) { el.hidden = true; el.innerHTML = ''; return; }
    var h = esc(msg);
    if (suggestions && suggestions.length) {
      h += '<div>' + suggestions.map(function (s) {
        return '<button class="sug" data-act="sug" data-word="' + esc(s) + '">' + esc(s) + ' 로 찾기</button>';
      }).join('') + '</div>';
    }
    el.innerHTML = h;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
  }

  function doLookup(rawText) {
    var raw = rawText != null ? rawText : $('#searchInput').value;
    var parsed = Api.parseInput(raw);

    if (!parsed.word) {
      setStatus('영어 단어를 찾지 못했습니다. 영어를 포함해 붙여넣어 주세요.', true);
      return;
    }
    pendingMeaning = parsed.ko || '';
    $('#searchResult').innerHTML = '';
    setStatus('"' + parsed.word + '" 찾는 중…');

    Api.lookup(parsed.word).then(function (r) {
      if (!r.ok) {
        lastEntry = { word: parsed.word, phonetic: '', audio: '', meanings: [], sourceUrl: '' };
        $('#searchResult').innerHTML = entryHtml(lastEntry, {});
        setStatus(r.error, true, r.suggestions);
        maybeAutoTranslate(parsed);
        return;
      }
      lastEntry = r.entry;
      Store.pushRecent(r.entry.word);
      $('#searchResult').innerHTML = entryHtml(r.entry, {});
      var notes = [];
      if (r.viaBase) notes.push('원형 "' + r.viaBase + '" 의 결과입니다.');
      if (r.source && r.source !== 'Free Dictionary') notes.push(r.source + ' 사전에서 가져왔습니다.');
      setStatus(notes.join(' '));
      maybeAutoTranslate(parsed);
      fillKoreanSlots('#searchResult', r.entry);   // 뜻풀이·예문의 한글도 함께
      renderRecent();
    });
  }

  function maybeAutoTranslate(parsed) {
    if (parsed.ko) return;
    if (!Store.settings().autoTranslate) return;
    var slot = $('#searchResult .mymean-text');
    if (!slot || slot.textContent.trim()) return;
    Api.translateWord(parsed.word).then(function (ko) {
      if (!ko) return;
      var el = $('#searchResult .mymean-text');
      if (el && !el.textContent.trim() && document.activeElement !== el) {
        el.textContent = ko;
        pendingMeaning = ko;
        var saved = Store.get(parsed.word);
        if (saved && !saved.myMeaning) Store.update(saved.id, { myMeaning: ko });
      }
    });
  }

  function renderRecent() {
    var list = Store.recent();
    $('#recentBox').hidden = !list.length;
    $('#recentList').innerHTML = list.map(function (w) {
      return '<button class="chip" data-act="sug" data-word="' + esc(w) + '">' + esc(w) + '</button>';
    }).join('');
  }

  /* ================= 일괄 추가 ================= */

  function parseBulk(text) {
    var lines = String(text || '').split(/[\n\r]+/);
    var out = [];
    var seen = {};
    lines.forEach(function (line) {
      if (!line.trim()) return;
      // "word - 뜻", "word : 뜻", "word 뜻" 모두 지원
      var p = Api.parseInput(line.replace(/\s*[-–—:=]\s*/, ' '));
      if (!p.word) return;
      var id = p.word.toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      out.push({ word: p.word, ko: p.ko, dup: Store.isFav(p.word) });
    });
    return out;
  }

  function openBulkSheet() {
    sheetMode = 'bulk';
    $('#sheetTitle').textContent = '여러 단어 한 번에 추가';
    var folders = Store.folders();
    var h = '';
    h += '<p class="hint" style="margin-bottom:10px">한 줄에 한 단어씩 붙여넣으세요. ' +
         '<b>apple - 사과</b> 처럼 뜻을 같이 적으면 함께 저장됩니다.</p>';
    h += '<textarea id="bulkText" class="bulk-area" placeholder="resilient - 회복력 있는&#10;take on - 떠맡다&#10;nuance 뉘앙스"></textarea>';
    h += '<div class="setting-row"><span>폴더</span><span class="setting-ctl">';
    h += '<select id="bulkFolder" class="select">';
    folders.forEach(function (f) { h += '<option value="' + esc(f) + '">' + esc(f) + '</option>'; });
    h += '<option value="__new__">+ 새 폴더…</option></select></span></div>';
    h += '<div id="bulkPreview" class="bulk-preview" hidden></div>';
    h += '<div class="btn-row"><button class="btn btn-ghost" id="bulkCheck">미리보기</button>';
    h += '<button class="btn btn-primary" id="bulkAdd">단어장에 추가</button></div>';
    h += '<p class="hint" id="bulkHint" style="margin-top:10px"></p>';
    $('#sheetBody').innerHTML = h;
    $('#sheet').hidden = false;

    $('#bulkCheck').addEventListener('click', function () {
      var items = parseBulk($('#bulkText').value);
      var box = $('#bulkPreview');
      if (!items.length) { box.hidden = true; toast('인식된 단어가 없습니다'); return; }
      box.innerHTML = items.map(function (it) {
        return '<div class="bulk-row' + (it.dup ? ' dup' : '') + '">' +
          '<span class="bulk-en">' + esc(it.word) + '</span>' +
          '<span class="bulk-ko">' + esc(it.ko || (it.dup ? '이미 있음' : '뜻 없음')) + '</span></div>';
      }).join('');
      box.hidden = false;
      $('#bulkHint').textContent = items.length + '개 인식 · 이미 있는 단어 ' +
        items.filter(function (i) { return i.dup; }).length + '개';
    });

    $('#bulkFolder').addEventListener('change', function () {
      if (this.value !== '__new__') return;
      var name = prompt('새 폴더 이름');
      if (name && name.trim()) {
        Store.addFolder(name.trim());
        var opt = document.createElement('option');
        opt.value = opt.textContent = name.trim();
        this.insertBefore(opt, this.lastChild);
        this.value = name.trim();
      } else {
        this.value = Store.DEFAULT_FOLDER;
      }
    });

    $('#bulkAdd').addEventListener('click', function () {
      var items = parseBulk($('#bulkText').value);
      if (!items.length) { toast('인식된 단어가 없습니다'); return; }
      var folder = $('#bulkFolder').value;
      if (folder === '__new__') folder = Store.DEFAULT_FOLDER;
      var res = Store.batchAdd(items, folder);
      closeSheet();
      toast(res.added + '개 추가 (중복 ' + res.skipped + '개 제외)');
      renderFavList(); renderReviewIntro();
      enrich();
    });
  }

  /* 사전 정보가 비어 있는 단어를 천천히 채워 넣는다 */
  var enriching = false;
  function enrich() {
    if (enriching || !navigator.onLine) return;
    var ids = Store.needsDetail();
    if (!ids.length) return;
    enriching = true;
    var i = 0;
    var total = ids.length;

    (function step() {
      if (i >= ids.length) {
        enriching = false;
        if (total) { toast('사전 정보 ' + total + '개 채웠습니다'); renderFavList(); }
        return;
      }
      var id = ids[i++];
      var w = Store.get(id);
      if (!w) { step(); return; }
      Api.lookup(w.word).then(function (r) {
        if (r.ok && r.entry) {
          Store.update(id, {
            phonetic: r.entry.phonetic, audio: r.entry.audio,
            meanings: r.entry.meanings, sourceUrl: r.entry.sourceUrl
          });
          if (!w.myMeaning && Store.settings().autoTranslate) {
            return Api.translateWord(w.word).then(function (ko) {
              if (ko) Store.update(id, { myMeaning: ko });
            });
          }
        }
      }).then(function () {
        // 예문은 미리 받아 두고, 번역은 단어를 열어 볼 때 채운다 (번역 한도 절약)
        return new Promise(function (res) { ensureExamples(id, res, { translate: false }); });
      }).catch(function () { /* 무시 */ })
        .then(function () { setTimeout(step, 450); });   // API 배려용 간격
    })();
  }

  /* ================= 기본 단어팩 ================= */

  var packLoading = false;
  function loadPack() {
    if (packLoading) return;
    function apply() {
      var pack = global.STARTER_PACK;
      if (!pack || !pack.words) { toast('단어팩을 불러오지 못했습니다'); return; }
      var res = Store.batchAdd(pack.words.map(function (p) {
        return { word: p.w, ko: p.k };
      }), pack.folder || '기본 단어팩');
      // 예문을 바로 붙여 준다 (오프라인에서도 학습 가능)
      pack.words.forEach(function (p) {
        if (!p.e) return;
        var w = Store.get(p.w);
        if (w && (!w.meanings || !w.meanings.length)) {
          w.meanings = [{ pos: p.p || 'phrase', posKo: '', defs: [{ def: p.d || p.k, example: p.e, synonyms: [] }] }];
        }
      });
      Store.saveNow();
      toast(res.added + '개 단어를 불러왔습니다');
      renderFavList(); renderReviewIntro();
    }
    if (global.STARTER_PACK) { apply(); return; }
    packLoading = true;
    var s = document.createElement('script');
    s.src = (global.APP_BASE || '') + 'js/pack.js';
    s.onload = function () { packLoading = false; apply(); };
    s.onerror = function () { packLoading = false; toast('단어팩 파일을 찾지 못했습니다'); };
    document.head.appendChild(s);
  }

  /* ================= 단어장 ================= */

  function renderFolderChips(hostSel, current, onPick) {
    var counts = Store.folderCounts();
    var total = Store.favorites().length;
    var h = '<button class="chip' + (current === '*' ? ' active' : '') + '" data-act="' + onPick +
            '" data-folder="*">전체<span class="chip-n">' + total + '</span></button>';
    Store.folders().forEach(function (f) {
      var n = counts[f] || 0;
      if (!n && f !== Store.DEFAULT_FOLDER) return;
      h += '<button class="chip' + (current === f ? ' active' : '') + '" data-act="' + onPick +
           '" data-folder="' + esc(f) + '">' + esc(f) + '<span class="chip-n">' + n + '</span></button>';
    });
    $(hostSel).innerHTML = h;
  }

  function renderFavList() {
    var favs = Store.favorites();
    var arch = Store.archived();
    var target = Review.conf().target;

    // 보관함 버튼
    var abtn = $('#btnArchive');
    abtn.classList.toggle('on', showArchive);
    abtn.textContent = showArchive ? '단어장' : '보관함' + (arch.length ? ' ' + arch.length : '');

    $('#favCount').textContent = showArchive ? arch.length : favs.length;
    $('.count-label').textContent = showArchive ? '개 보관 중' : '개 저장됨';
    $('#listFolders').hidden = showArchive;
    if (!showArchive) renderFolderChips('#listFolders', listFolder, 'listFolder');

    if (showArchive) {
      renderArchiveList(arch);
      return;
    }

    var q = $('#filterInput').value.trim().toLowerCase();
    var sort = $('#sortSelect').value;

    var rows = favs.map(function (w, i) { return { w: w, order: i + 1 }; });
    if (listFolder !== '*') rows = rows.filter(function (r) { return folderOf(r.w) === listFolder; });
    if (q) {
      rows = rows.filter(function (r) {
        return r.w.word.toLowerCase().indexOf(q) !== -1 ||
               (r.w.myMeaning || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    if (sort === 'addedDesc') rows.reverse();
    else if (sort === 'alpha') rows.sort(function (a, b) { return a.w.word.localeCompare(b.w.word); });
    else if (sort === 'weak') {
      rows.sort(function (a, b) {
        var sa = a.w.stats || {}, sb = b.w.stats || {};
        return (sa.fastStreak || 0) - (sb.fastStreak || 0) || (sa.seen || 0) - (sb.seen || 0);
      });
    }

    $('#favEmpty').hidden = favs.length > 0;
    $('#btnMask').classList.toggle('on', maskMeanings);
    $('#btnMask').textContent = maskMeanings ? '뜻 보이기' : '뜻 가리기';

    $('#favList').innerHTML = rows.map(function (r) {
      var w = r.w, st = w.stats || {};
      var badge, cls = '';
      if (st.mastered || (st.fastStreak || 0) >= target) { badge = '익힘'; cls = 'mastered'; }
      else if (st.seen) { badge = '연속 ' + (st.fastStreak || 0); cls = 'learning'; }
      else badge = '새 단어';
      return '<div class="word-item" data-act="open" data-word="' + esc(w.id) + '">' +
        '<span class="wi-index">' + r.order + '</span>' +
        '<span class="wi-main"><span class="wi-word">' + esc(w.word) + '</span>' +
        '<span class="wi-mean' + (maskMeanings ? ' masked' : '') + '">' +
          esc(Review.meaningLabel(w) || '뜻을 입력해 주세요') + '</span></span>' +
        '<span class="wi-badge ' + cls + '">' + badge + '</span></div>';
    }).join('');
  }

  /** 보관함 목록 — 최근에 보관한 것부터, 지난 기간과 함께 */
  function renderArchiveList(list) {
    var q = $('#filterInput').value.trim().toLowerCase();
    var all = list;
    if (q) {
      list = list.filter(function (w) {
        return w.word.toLowerCase().indexOf(q) !== -1 ||
               (w.myMeaning || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    $('#favEmpty').hidden = all.length > 0;
    $('#btnMask').classList.toggle('on', maskMeanings);
    $('#btnMask').textContent = maskMeanings ? '뜻 보이기' : '뜻 가리기';

    if (!list.length) {
      $('#favList').innerHTML = all.length
        ? '<div class="empty">검색 결과가 없습니다.</div>'
        : '';
      return;
    }

    $('#favList').innerHTML = list.map(function (w, idx) {
      var days = w.archivedAt ? Math.floor((Date.now() - w.archivedAt) / 86400000) : null;
      var ago = days === null ? '보관됨' : (days === 0 ? '오늘' : days + '일 전');
      var st = w.stats || {};
      return '<div class="word-item" data-act="open" data-word="' + esc(w.id) + '">' +
        '<span class="wi-index">' + (idx + 1) + '</span>' +
        '<span class="wi-main"><span class="wi-word">' + esc(w.word) + '</span>' +
        '<span class="wi-mean' + (maskMeanings ? ' masked' : '') + '">' +
          esc(Review.meaningLabel(w) || '뜻 없음') + '</span></span>' +
        '<span class="wi-side">' +
          '<span class="wi-badge archived">' + esc(ago) + '</span>' +
          (st.seen ? '<span class="wi-sub">' + st.seen + '회 학습</span>' : '') +
        '</span>' +
        '<button class="star-btn row-star" data-act="star" data-word="' + esc(w.id) +
          '" aria-label="단어장으로 되돌리기" title="다시 암기하기">☆</button>' +
      '</div>';
    }).join('');
  }

  /* ================= 상세 시트 ================= */

  function openSheet(id) {
    var w = Store.get(id);
    if (!w) return;
    sheetMode = 'entry';
    $('#sheetTitle').textContent = '단어 상세';
    $('#sheetBody').innerHTML = entryHtml({
      word: w.word, phonetic: w.phonetic, audio: w.audio,
      meanings: w.meanings || [], sourceUrl: w.sourceUrl
    }, { saved: w });
    $('#sheet').hidden = false;

    // 열어 본 김에 예문과 한글 뜻을 채워 둔다 (이미 있으면 아무 일도 하지 않음)
    ensureExamples(id, function (changed) {
      if (changed && !$('#sheet').hidden) openSheet(id);
    });
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheetBody').innerHTML = '';
    if (sheetMode === 'entry' && currentView === 'list') renderFavList();
  }

  /* ================= 암기 ================= */

  var rv = {
    mode: 'flash', word: null, revealed: false, revealMs: 0,
    timer: 0, busy: false,
    listenList: [], listenIdx: 0, listenOn: false, listenTimer: 0, listenToken: 0
  };

  function renderReviewIntro() {
    renderFolderChips('#reviewFolders', reviewFolder, 'reviewFolder');
    var s = Review.stats(reviewFolder);
    var c = Review.conf();
    $('#rvTotal').textContent = s.total;
    $('#rvLearning').textContent = s.learning + s.fresh;
    $('#rvMastered').textContent = s.mastered;
    $('#descFastSec').textContent = (c.fastMs / 1000).toFixed(c.fastMs % 1000 ? 1 : 0);
    $('#descStreak').textContent = c.target;
    $('#reviewNoWords').hidden = s.total > 0;
    $$('.mode-btn').forEach(function (b) { b.disabled = s.total === 0; });
  }

  function startReview(mode) {
    var s = Review.stats(reviewFolder);
    if (!s.total) { toast('먼저 단어를 저장해 주세요'); return; }
    if (mode === 'mcq' && s.total < 3) { toast('객관식은 단어가 3개 이상일 때 쓸 수 있어요'); return; }

    rv.mode = mode;
    Review.start(mode, reviewFolder);
    $('#sessMode').textContent = MODE_NAME[mode] || '';
    $('#reviewIntro').hidden = true;
    $('#reviewSession').hidden = false;
    $('.timer-wrap').hidden = (mode === 'listen');
    updateSessionCounter();

    if (mode === 'listen') startListen();
    else nextCard();
  }

  function endReview(silent) {
    stopTimer();
    stopListen();
    var s = Review.end();
    $('#reviewSession').hidden = true;
    $('#reviewIntro').hidden = false;
    $('#rvStage').innerHTML = '';
    $('.timer-wrap').hidden = false;   // 연속 듣기에서 숨겼던 것을 되돌린다
    renderReviewIntro();
    if (!silent && s && s.answered) toast(s.answered + '문제 완료 · 즉답 ' + s.fast + '회');
  }

  function updateSessionCounter() {
    var s = Review.current();
    if (!s) return;
    $('#sessDone').textContent = s.answered;
    $('#sessRate').textContent = s.answered ? Math.round(s.fast / s.answered * 100) : 0;
  }

  /* -------- 타이머 바 -------- */
  function startTimer(ms) {
    var bar = $('#timerBar');
    stopTimer();
    bar.classList.remove('slow');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = 'transform ' + ms + 'ms linear';
    bar.style.transform = 'scaleX(0)';
    rv.timer = setTimeout(function () { bar.classList.add('slow'); }, ms);
  }

  function stopTimer() {
    if (rv.timer) { clearTimeout(rv.timer); rv.timer = 0; }
    var bar = $('#timerBar');
    if (!bar) return;
    var cs = global.getComputedStyle(bar).transform;
    bar.style.transition = 'none';
    bar.style.transform = (cs === 'none' ? 'scaleX(0)' : cs);
  }

  /* -------- 카드 진행 -------- */
  function nextCard() {
    if (!Review.current()) return;      // 세션이 끝난 뒤 예약된 호출은 무시
    var w = Review.next();
    if (!w) { toast('이 범위에 단어가 없습니다'); endReview(true); return; }
    rv.word = w;
    rv.revealed = false;
    rv.busy = false;

    if (rv.mode === 'flash') renderFlash(w);
    else if (rv.mode === 'mcq') renderMcq(w);
    else if (rv.mode === 'spell') renderSpell(w);

    Review.markShown();
    startTimer(Review.conf().fastMs);
  }

  function streakLine(w) {
    var st = w.stats || {};
    var c = Review.conf();
    return Review.streakDots(st.fastStreak || 0, c.target) + (st.mastered ? '  익힘' : '');
  }

  function answerHtml(w) {
    var h = '';
    var ko = w.myMeaning || '';
    var exKo = w.exKo || {};
    var defKo = w.defKo || {};
    if (ko) h += '<div class="answer-ko">' + esc(ko) + '</div>';

    var shown = 0, exShown = 0;
    function exBlock(t) {
      if (exShown >= 2) return '';
      exShown++;
      var s = '<div class="answer-ex"><span class="example-en">' + esc(t) + '</span>';
      if (exKo[t]) s += '<span class="example-ko">' + esc(exKo[t]) + '</span>';
      s += ' <button class="mini-btn" data-act="speak" data-text="' + esc(t) + '">🔊</button></div>';
      return s;
    }

    (w.meanings || []).forEach(function (m) {
      m.defs.forEach(function (d) {
        if (shown >= 3) return;
        shown++;
        h += '<div class="answer-def"><b>' + esc(m.pos) + '</b> ' + esc(d.def);
        if (defKo[d.def]) h += '<span class="answer-def-ko">' + esc(defKo[d.def]) + '</span>';
        h += '</div>';
        if (d.example) h += exBlock(d.example);
      });
    });
    // 정의에 예문이 없으면 따로 보충해 둔 예문을 보여준다
    (w.examples || []).forEach(function (t) { h += exBlock(t); });

    if (!ko && !shown) h += '<div class="answer-def">저장된 뜻이 없습니다.</div>';
    h += '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="open" data-word="' +
         esc(w.id) + '">자세히 보기</button></div>';
    return h;
  }

  function gradeButtonsHtml() {
    return '<div class="review-actions grade-actions">' +
      '<button class="btn btn-danger" data-act="grade" data-g="again">몰랐어요</button>' +
      '<button class="btn btn-warn" data-act="grade" data-g="hard">헷갈려요</button>' +
      '<button class="btn btn-success" data-act="grade" data-g="good">알았어요</button></div>';
  }

  /* -------- 모드: 플래시카드 -------- */
  function renderFlash(w) {
    var h = '<div class="card"><div class="card-word-row">';
    h += '<h2 class="card-word">' + esc(w.word) + '</h2>';
    h += '<button class="icon-btn speak" data-act="speak" data-text="' + esc(w.word) +
         '" data-audio="' + esc(w.audio || '') + '">🔊</button></div>';
    h += '<div class="card-phonetic">' + esc(w.phonetic || '') + '</div>';
    h += '<div class="streak-row">' + streakLine(w) + '</div>';
    h += '<div class="card-answer" id="flashAnswer" hidden></div></div>';
    h += '<div class="review-actions"><button class="btn btn-primary btn-lg" data-act="reveal">뜻 보기</button></div>';
    $('#rvStage').innerHTML = h;
  }

  function reveal() {
    if (rv.revealed || !rv.word) return;
    rv.revealMs = Review.elapsed();
    rv.revealed = true;
    stopTimer();
    var box = $('#flashAnswer');
    if (box) { box.innerHTML = answerHtml(rv.word); box.hidden = false; }
    var acts = $('#rvStage .review-actions');
    if (acts) acts.outerHTML = gradeButtonsHtml();
  }

  /* -------- 모드: 객관식 -------- */
  function renderMcq(w) {
    var correct = Review.meaningLabel(w);
    if (!correct) {   // 뜻이 없으면 건너뛴다
      Review.grade(w.id, 'hard', 99999);
      setTimeout(nextCard, 10);
      return;
    }
    var opts = Review.distractors(w, 3).concat([correct]);
    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    rv.mcqAnswer = correct;

    var h = '<div class="card"><div class="card-word-row">';
    h += '<h2 class="card-word">' + esc(w.word) + '</h2>';
    h += '<button class="icon-btn speak" data-act="speak" data-text="' + esc(w.word) +
         '" data-audio="' + esc(w.audio || '') + '">🔊</button></div>';
    h += '<div class="card-phonetic">' + esc(w.phonetic || '') + '</div>';
    h += '<div class="streak-row">' + streakLine(w) + '</div></div>';
    h += '<div class="mcq-list">';
    opts.forEach(function (o, i2) {
      h += '<button class="mcq-option" data-act="mcq" data-val="' + esc(o) + '">' +
           '<span class="mcq-key">' + (i2 + 1) + '</span><span>' + esc(o) + '</span></button>';
    });
    h += '</div>';
    $('#rvStage').innerHTML = h;
  }

  function answerMcq(btn) {
    if (rv.busy || !rv.word) return;
    rv.busy = true;
    var ms = Review.elapsed();
    stopTimer();
    var ok = btn.dataset.val === rv.mcqAnswer;

    $$('#rvStage .mcq-option').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.val === rv.mcqAnswer) b.classList.add('correct');
    });
    if (!ok) btn.classList.add('wrong');

    var res = Review.grade(rv.word.id, ok ? 'good' : 'again', ms);
    updateSessionCounter();
    flashResult(res, ms);
    setTimeout(nextCard, ok ? 620 : 1500);
  }

  /* -------- 모드: 스펠링 -------- */
  function renderSpell(w) {
    var ko = Review.meaningLabel(w);
    if (!ko) {
      Review.grade(w.id, 'hard', 99999);
      setTimeout(nextCard, 10);
      return;
    }
    var hint = w.word.replace(/[A-Za-z]/g, '_').split('').map(function (ch, i) {
      return i === 0 ? w.word[0] : ch;
    }).join('');

    var h = '<div class="card"><div class="spell-prompt">';
    h += '<div class="spell-ko">' + esc(ko) + '</div>';
    h += '<div class="spell-hint">' + esc(hint) + '</div></div>';
    h += '<input id="spellInput" class="spell-input" type="text" autocomplete="off" ' +
         'autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="영어 철자 입력">';
    h += '<div id="spellAnswer" class="spell-answer" hidden></div></div>';
    h += '<div class="review-actions">';
    h += '<button class="btn btn-ghost" data-act="spell-skip">모르겠어요</button>';
    h += '<button class="btn btn-primary" style="flex:1" data-act="spell-submit">확인</button></div>';
    $('#rvStage').innerHTML = h;

    var inp = $('#spellInput');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitSpell(); }
    });
    setTimeout(function () { inp.focus(); }, 60);
  }

  function normSpell(s) {
    return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function submitSpell(skip) {
    if (rv.busy || !rv.word) return;
    var inp = $('#spellInput');
    var val = inp ? inp.value : '';
    if (!skip && !val.trim()) { toast('철자를 입력해 주세요'); return; }
    rv.busy = true;
    var ms = Review.elapsed();
    stopTimer();

    var ok = !skip && normSpell(val) === normSpell(rv.word.word);
    if (inp) { inp.classList.add(ok ? 'correct' : 'wrong'); inp.blur(); }

    var box = $('#spellAnswer');
    if (box) {
      box.className = 'spell-answer ' + (ok ? 'ok' : 'no');
      box.textContent = ok ? '정답! ' + rv.word.word : '정답: ' + rv.word.word;
      box.hidden = false;
    }
    Api.speak(rv.word.word, rv.word.audio || '');

    var res = Review.grade(rv.word.id, ok ? 'good' : 'again', ms);
    updateSessionCounter();
    flashResult(res, ms);
    setTimeout(nextCard, ok ? 750 : 1700);
  }

  function flashResult(res, ms) {
    if (!res) return;
    var sec = (ms / 1000).toFixed(1);
    if (res.promoted) toast('연속 ' + res.target + '회 성공! 뒤로 미룹니다 👍');
    else if (res.fast) toast('즉답 ' + sec + '초 · 연속 ' + res.streak + '회');
    else if (res.correct) toast(sec + '초 · 연속 기록 초기화');
  }

  /* -------- 모드: 연속 듣기 -------- */
  function startListen() {
    rv.listenList = Review.scopedQueue().map(function (id) { return Store.get(id); }).filter(Boolean);
    if (!rv.listenList.length) { toast('단어가 없습니다'); endReview(true); return; }
    rv.listenIdx = 0;
    rv.listenOn = true;
    renderListen();
    playListen();
  }

  function renderListen() {
    var w = rv.listenList[rv.listenIdx];
    if (!w) return;
    var ex = '';
    (w.meanings || []).some(function (m) {
      return m.defs.some(function (d) { if (d.example) { ex = d.example; return true; } return false; });
    });
    var h = '<div class="card listen-card">';
    h += '<div class="listen-word">' + esc(w.word) + '</div>';
    h += '<div class="card-phonetic">' + esc(w.phonetic || '') + '</div>';
    h += '<div class="listen-ko">' + esc(Review.meaningLabel(w) || '') + '</div>';
    if (ex) h += '<div class="listen-ex">' + esc(ex) + '</div>';
    h += '</div>';
    h += '<div class="listen-controls">';
    h += '<button class="btn btn-ghost" data-act="listen-prev">◀</button>';
    h += '<button class="btn btn-primary" data-act="listen-toggle">' + (rv.listenOn ? '⏸ 일시정지' : '▶ 재생') + '</button>';
    h += '<button class="btn btn-ghost" data-act="listen-next">▶</button>';
    h += '</div>';
    h += '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="listen-bump">이 단어 다시 볼래요</button></div>';
    h += '<div class="listen-progress">' + (rv.listenIdx + 1) + ' / ' + rv.listenList.length + '</div>';
    $('#rvStage').innerHTML = h;
  }

  function playListen() {
    if (!rv.listenOn) return;
    var token = ++rv.listenToken;
    var w = rv.listenList[rv.listenIdx];
    if (!w) { stopListen(); return; }
    var s = Store.settings();
    var gap = s.listenGap || 1500;

    var ex = '';
    if (s.listenExample) {
      (w.meanings || []).some(function (m) {
        return m.defs.some(function (d) { if (d.example) { ex = d.example; return true; } return false; });
      });
    }

    // 단어 → (예문) → 다음 카드
    Api.speakP(w.word, w.audio || '').then(function () {
      if (token !== rv.listenToken || !rv.listenOn) return null;
      return wait(gap / 2);
    }).then(function () {
      if (token !== rv.listenToken || !rv.listenOn) return null;
      return ex ? Api.speakP(ex) : null;
    }).then(function () {
      if (token !== rv.listenToken || !rv.listenOn) return;
      var st = w.stats || (w.stats = Store.newStats());
      st.lastSeen = Date.now();
      Store.save();
      rv.listenTimer = setTimeout(function () {
        if (token !== rv.listenToken || !rv.listenOn) return;
        listenStep(1);
      }, gap);
    });
  }

  function wait(ms) {
    return new Promise(function (res) { rv.listenTimer = setTimeout(res, ms); });
  }

  function listenStep(dir) {
    rv.listenIdx += dir;
    if (rv.listenIdx >= rv.listenList.length) rv.listenIdx = 0;
    if (rv.listenIdx < 0) rv.listenIdx = rv.listenList.length - 1;
    renderListen();
    playListen();
  }

  function stopListen() {
    rv.listenOn = false;
    rv.listenToken++;
    if (rv.listenTimer) { clearTimeout(rv.listenTimer); rv.listenTimer = 0; }
    Api.stopSpeak();
  }

  function toggleListen() {
    if (rv.listenOn) { stopListen(); renderListen(); }
    else { rv.listenOn = true; renderListen(); playListen(); }
  }

  /* ================= 설정 ================= */

  /** 지금 실행 중인 앱 버전 (script 태그의 ?v= 값에서 읽는다) */
  function appVersion() {
    var el = document.querySelector('script[src*="app.js"]');
    var m = el && el.src.match(/[?&]v=([^&]+)/);
    return m ? m[1] : '?';
  }

  function fillSettings() {
    var s = Store.settings();
    var ver = $('#appVersion');
    if (ver) ver.textContent = 'v' + appVersion();
    $('#setFastMs').value = s.fastMs;
    $('#setFastMsVal').textContent = (s.fastMs / 1000).toFixed(1) + '초';
    $('#setStreak').value = s.targetStreak;
    $('#setStreakVal').textContent = s.targetStreak + '회';
    $('#setAutoTrans').checked = !!s.autoTranslate;
    $('#setExTrans').checked = !!s.exampleTranslate;
    $('#setAutoFill').checked = !!s.autoFill;
    $('#setRate').value = s.ttsRate;
    $('#setRateVal').textContent = Number(s.ttsRate).toFixed(1) + 'x';
    $('#setListenGap').value = s.listenGap;
    $('#setListenGapVal').textContent = (s.listenGap / 1000).toFixed(1) + '초';
    $('#setListenEx').checked = !!s.listenExample;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  /* ================= 이벤트 위임 ================= */

  function onAction(e) {
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;

    switch (act) {
      case 'speak':
        e.preventDefault();
        Api.speak(el.dataset.text, el.dataset.audio || '');
        return;

      case 'sug':
        setView('search');
        $('#searchInput').value = el.dataset.word;
        $('#btnClear').hidden = false;
        doLookup(el.dataset.word);
        return;

      case 'open':
        openSheet(el.dataset.word);
        return;

      case 'listFolder':
        listFolder = el.dataset.folder;
        renderFavList();
        return;

      case 'reviewFolder':
        reviewFolder = el.dataset.folder;
        renderReviewIntro();
        return;

      case 'trans': {
        var host = el.closest('.entry');
        var slot = host && host.querySelector('[data-ko-slot="' + el.dataset.slot + '"]');
        if (!slot) return;
        var srcText = el.dataset.text;
        el.textContent = '번역 중…';
        Api.translate(srcText).then(function (ko) {
          el.textContent = '한글 뜻';
          if (!ko) { toast('번역을 가져오지 못했습니다'); return; }
          slot.textContent = ko;
          el.hidden = true;
          // 저장된 단어라면 번역을 남겨 두어 다음에 또 부르지 않는다
          var wid = host && Store.normId(host.dataset.word);
          var sw = wid && Store.get(wid);
          if (sw) {
            var bucket = el.dataset.kind === 'def' ? 'defKo' : 'exKo';
            sw[bucket] = sw[bucket] || {};
            sw[bucket][srcText] = ko;
            Store.save();
          }
        });
        return;
      }

      case 'refetch': {
        var eEl0 = el.closest('.entry');
        var w0 = eEl0.dataset.word;
        el.disabled = true;
        Api.lookup(w0, { force: true }).then(function (r) {
          el.disabled = false;
          if (!r.ok) { toast(r.error || '찾지 못했습니다'); return; }
          if (Store.isFav(w0)) {
            Store.update(Store.normId(w0), {
              phonetic: r.entry.phonetic, audio: r.entry.audio,
              meanings: r.entry.meanings, sourceUrl: r.entry.sourceUrl
            });
            openSheet(Store.normId(w0));
          } else {
            lastEntry = r.entry;
            $('#searchResult').innerHTML = entryHtml(r.entry, {});
          }
          toast('사전 정보를 채웠습니다');
        });
        return;
      }

      case 'star': {
        // 상세 카드의 별, 목록 행 끝의 별 둘 다 처리한다
        var entryEl = el.closest('.entry');
        var word = el.dataset.word || (entryEl && entryEl.dataset.word);
        if (!word) return;
        if (Store.isFav(word)) {
          // 지우지 않고 보관함으로. 받아 둔 뜻·예문과 암기 기록은 그대로 남는다.
          Store.archiveFav(word);
          toast('보관함으로 옮겼습니다 · 자료와 기록은 그대로 남아요');
          renderFavList();
          renderReviewIntro();
          if (!$('#sheet').hidden) openSheet(Store.normId(word));
          else if (lastEntry && Store.normId(lastEntry.word) === Store.normId(word)) {
            $('#searchResult').innerHTML = entryHtml(lastEntry, {});
          }
          return;
        }
        if (Store.isArchived(word)) {
          Store.restoreFav(word);
          toast('단어장으로 되돌렸습니다');
          renderFavList();
          renderReviewIntro();
          if (!$('#sheet').hidden) openSheet(Store.normId(word));
          else if (lastEntry && Store.normId(lastEntry.word) === Store.normId(word)) {
            $('#searchResult').innerHTML = entryHtml(lastEntry, {});
          }
          return;
        }
        {
          var mineEl = entryEl.querySelector('.mymean-text');
          var mine = mineEl ? mineEl.textContent.trim() : '';
          var src = (lastEntry && Store.normId(lastEntry.word) === Store.normId(word))
            ? lastEntry : { word: word, meanings: [] };
          Store.addFav(src, mine, listFolder !== '*' ? listFolder : Store.DEFAULT_FOLDER);
          el.classList.add('on');
          el.textContent = '★';
          pendingMeaning = '';
          toast('단어장에 저장했습니다 (' + Store.favorites().length + '개)');

          // 예문과 그 한글 뜻을 확보해 단어장에 함께 남긴다
          var savedId = Store.normId(word);
          ensureExamples(savedId, function (changed) {
            if (!changed) return;
            renderFavList();
            if (!$('#sheet').hidden) openSheet(savedId);
            else if (lastEntry && Store.normId(lastEntry.word) === savedId) {
              $('#searchResult').innerHTML = entryHtml(lastEntry, {});
            }
          });
        }
        renderFavList();
        renderReviewIntro();
        return;
      }

      case 'remove': {
        var eEl = el.closest('.entry');
        var wid = eEl.dataset.word;
        if (!confirm('"' + wid + '" 을(를) 단어장에서 삭제할까요?')) return;
        Store.removeFav(wid);
        toast('삭제했습니다');
        if (!$('#sheet').hidden) closeSheet();
        renderFavList();
        renderReviewIntro();
        if (lastEntry && Store.normId(lastEntry.word) === Store.normId(wid)) {
          $('#searchResult').innerHTML = entryHtml(lastEntry, {});
        }
        return;
      }

      /* --- 암기 --- */
      case 'reveal': reveal(); return;
      case 'grade': gradeCard(el.dataset.g); return;
      case 'mcq': answerMcq(el); return;
      case 'spell-submit': submitSpell(false); return;
      case 'spell-skip': submitSpell(true); return;
      case 'listen-toggle': toggleListen(); return;
      case 'listen-next': stopListenTimersAndStep(1); return;
      case 'listen-prev': stopListenTimersAndStep(-1); return;
      case 'listen-bump': {
        var lw = rv.listenList[rv.listenIdx];
        if (lw) { Review.bump(lw.id); toast('앞쪽으로 옮겼습니다'); }
        return;
      }
    }
  }

  function stopListenTimersAndStep(dir) {
    var wasOn = rv.listenOn;
    stopListen();
    rv.listenOn = wasOn;
    listenStep(dir);
  }

  function gradeCard(g) {
    if (!rv.revealed || !rv.word || rv.busy) return;
    rv.busy = true;
    var res = Review.grade(rv.word.id, g, rv.revealMs);
    updateSessionCounter();
    flashResult(res, rv.revealMs);
    setTimeout(nextCard, 380);
  }

  function onEditBlur(e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.act) return;
    var entryEl = el.closest('.entry');
    if (!entryEl) return;
    var word = entryEl.dataset.word;

    if (el.dataset.act === 'mymean') {
      var val = el.textContent.replace(/\s+/g, ' ').trim();
      el.textContent = val;
      if (Store.isFav(word)) Store.update(Store.normId(word), { myMeaning: val });
      else pendingMeaning = val;
    }
    if (el.dataset.act === 'note' && Store.isFav(word)) {
      Store.update(Store.normId(word), { note: el.value });
    }
  }

  function onChange(e) {
    var el = e.target;
    if (!el.dataset || el.dataset.act !== 'folder') return;
    var entryEl = el.closest('.entry');
    if (!entryEl) return;
    var id = Store.normId(entryEl.dataset.word);
    if (el.value === '__new__') {
      var name = prompt('새 폴더 이름');
      if (name && name.trim()) {
        Store.setFolder(id, name.trim());
        openSheet(id);
      } else {
        el.value = folderOf(Store.get(id));
      }
    } else {
      Store.setFolder(id, el.value);
      toast('"' + el.value + '" 폴더로 옮겼습니다');
    }
    renderFavList();
  }

  /* ================= 초기화 ================= */

  /**
   * 주소 뒤에 ?fresh 를 붙여 열면 서비스워커와 캐시를 모두 비우고 다시 로드한다.
   * (저장한 단어는 localStorage 에 있으므로 지워지지 않는다)
   */
  function freshStart() {
    if (location.search.indexOf('fresh') === -1) return false;
    var jobs = [];
    if ('serviceWorker' in navigator) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }).catch(function () {}));
    }
    if (global.caches && caches.keys) {
      jobs.push(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    Promise.all(jobs).then(function () {
      location.replace(location.pathname);   // ?fresh 떼고 새로 로드
    });
    return true;
  }

  function init() {
    if (freshStart()) return;

    Store.load();
    updateNetBadge();

    // 혹시 시트가 열린 상태로 남아 화면을 가리지 않도록 확실히 닫고 시작
    $('#sheet').hidden = true;
    renderRecent();
    fillSettings();
    renderReviewIntro();
    renderFavList();

    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });
    $('#btnSettingsTop').addEventListener('click', function () { setView('settings'); });

    /* 찾기 */
    $('#btnLookup').addEventListener('click', function () { doLookup(); });
    $('#searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
    });
    $('#searchInput').addEventListener('input', function () { $('#btnClear').hidden = !this.value; });
    $('#searchInput').addEventListener('paste', function () {
      setTimeout(function () { $('#btnClear').hidden = false; doLookup(); }, 30);
    });
    $('#btnClear').addEventListener('click', function () {
      $('#searchInput').value = '';
      this.hidden = true;
      $('#searchResult').innerHTML = '';
      setStatus('');
      $('#searchInput').focus();
    });
    $('#btnPaste').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (txt) {
          if (!txt) { toast('클립보드가 비어 있습니다'); return; }
          $('#searchInput').value = txt.trim();
          $('#btnClear').hidden = false;
          doLookup(txt);
        }).catch(function () {
          $('#searchInput').focus();
          toast('입력창을 길게 눌러 붙여넣어 주세요');
        });
      } else {
        $('#searchInput').focus();
        toast('입력창을 길게 눌러 붙여넣어 주세요');
      }
    });
    $('#btnBulk').addEventListener('click', openBulkSheet);
    $('#btnBulk2').addEventListener('click', function () { openBulkSheet(); });

    /* 단어장 */
    $('#sortSelect').addEventListener('change', renderFavList);
    $('#filterInput').addEventListener('input', renderFavList);
    $('#btnArchive').addEventListener('click', function () {
      showArchive = !showArchive;
      $('#filterInput').value = '';
      renderFavList();
      $('#main').scrollTop = 0;
    });
    $('#btnMask').addEventListener('click', function () {
      maskMeanings = !maskMeanings;
      renderFavList();
    });
    $('#btnFillKo').addEventListener('click', fillAllKorean);
    $('#btnHardRefresh').addEventListener('click', function () {
      toast('최신 버전을 받는 중…');
      location.replace(location.pathname + '?fresh');   // 서비스워커·캐시를 비우고 다시 로드
    });
    $('#btnLoadPack').addEventListener('click', loadPack);
    $('#btnLoadPack2').addEventListener('click', loadPack);
    $('#btnLoadPackEmpty').addEventListener('click', loadPack);

    /* 시트 */
    $('#sheet').addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.close) closeSheet();
    });

    /* 암기 */
    $$('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { startReview(b.dataset.mode); });
    });
    $('#btnEndReview').addEventListener('click', function () { endReview(); });

    /* 키보드 단축키 */
    document.addEventListener('keydown', function (e) {
      if (currentView !== 'review' || $('#reviewSession').hidden) return;
      if (e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (rv.mode === 'flash') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); rv.revealed ? gradeCard('good') : reveal(); }
        else if (e.key === '1') gradeCard('again');
        else if (e.key === '2') gradeCard('hard');
        else if (e.key === '3') gradeCard('good');
      } else if (rv.mode === 'mcq') {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4) {
          var b = $$('#rvStage .mcq-option')[n - 1];
          if (b && !b.disabled) answerMcq(b);
        }
      } else if (rv.mode === 'listen') {
        if (e.code === 'Space') { e.preventDefault(); toggleListen(); }
      }
    });

    /* 설정 */
    $('#setFastMs').addEventListener('input', function () {
      Store.setSetting('fastMs', Number(this.value));
      $('#setFastMsVal').textContent = (this.value / 1000).toFixed(1) + '초';
    });
    $('#setStreak').addEventListener('input', function () {
      Store.setSetting('targetStreak', Number(this.value));
      $('#setStreakVal').textContent = this.value + '회';
    });
    $('#setAutoTrans').addEventListener('change', function () {
      Store.setSetting('autoTranslate', this.checked);
    });
    $('#setExTrans').addEventListener('change', function () {
      Store.setSetting('exampleTranslate', this.checked);
    });
    $('#setAutoFill').addEventListener('change', function () {
      Store.setSetting('autoFill', this.checked);
      if (this.checked) startFill(false);
    });
    $('#setRate').addEventListener('input', function () {
      Store.setSetting('ttsRate', Number(this.value));
      $('#setRateVal').textContent = Number(this.value).toFixed(1) + 'x';
    });
    $('#setListenGap').addEventListener('input', function () {
      Store.setSetting('listenGap', Number(this.value));
      $('#setListenGapVal').textContent = (this.value / 1000).toFixed(1) + '초';
    });
    $('#setListenEx').addEventListener('change', function () {
      Store.setSetting('listenExample', this.checked);
    });

    $('#btnExport').addEventListener('click', function () {
      download('wordbook-' + stamp() + '.json', Store.exportData());
      toast('내보냈습니다');
    });
    $('#btnExportCsv').addEventListener('click', function () {
      download('wordbook-' + stamp() + '.csv', Store.exportCsv(), 'text/csv;charset=utf-8');
      toast('CSV로 내보냈습니다');
    });
    $('#btnImport').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = Store.importData(String(reader.result));
          toast(n + '개 단어를 추가했습니다');
          renderFavList(); renderReviewIntro(); fillSettings();
        } catch (err) {
          toast('가져오기 실패: ' + err.message);
        }
      };
      reader.readAsText(f);
      this.value = '';
    });
    $('#btnResetStats').addEventListener('click', function () {
      if (!confirm('암기 기록(연속 성공·출제 횟수)만 초기화할까요? 단어는 그대로 남습니다.')) return;
      Store.resetStats();
      toast('암기 기록을 초기화했습니다');
      renderReviewIntro(); renderFavList();
    });
    $('#btnWipe').addEventListener('click', function () {
      if (!confirm('저장된 단어와 기록을 모두 삭제합니다. 계속할까요?')) return;
      if (!confirm('되돌릴 수 없습니다. 정말 삭제할까요?')) return;
      Store.wipe();
      listFolder = reviewFolder = '*';
      toast('모두 삭제했습니다');
      renderFavList(); renderReviewIntro(); renderRecent(); fillSettings();
      $('#searchResult').innerHTML = '';
    });

    document.addEventListener('click', onAction);
    document.addEventListener('focusout', onEditBlur);
    document.addEventListener('change', onChange);

    global.addEventListener('online', function () {
      updateNetBadge();
      enrich();
      setTimeout(function () { startFill(false); }, 3000);
    });
    global.addEventListener('offline', updateNetBadge);
    global.addEventListener('pagehide', function () { Api.stopSpeak(); Store.saveNow(); });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 무시 */ });
    }

    // 시작 후 잠시 뒤, 사전 정보가 빈 단어를 조용히 채운다
    setTimeout(enrich, 2500);
    // 이어서 한글 뜻·예문도 천천히 채워 둔다 (오프라인 대비)
    setTimeout(function () { startFill(false); }, 8000);
    // 앱을 열어 둔 동안 남은 단어를 이어서 처리
    setInterval(function () { startFill(false); }, 3 * 60 * 1000);
  }

  global.App = {
    toast: toast,
    setView: setView,
    refresh: function () { renderFavList(); renderReviewIntro(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
