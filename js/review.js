/* =========================================================
   review.js — 암기 엔진
   규칙
     · 저장한 단어 중 "앞쪽 대기열"에서 랜덤으로 출제
     · 뜻 보기까지 걸린 시간 <= 즉답기준(기본 2초) + '알았어요' = 즉답 성공
     · 즉답이 연속 targetStreak(기본 4)회 쌓이면 → 대기열 맨 뒤로 (익힘)
     · 틀리거나 느리면 연속 기록 초기화 + 앞쪽으로 복귀
   ========================================================= */
(function (global) {
  'use strict';

  var WINDOW = 5;          // 대기열 앞쪽 몇 개 중에서 랜덤으로 뽑을지
  var session = null;

  function queue() { return Store.raw().queue; }

  function conf() {
    var s = Store.settings();
    return { fastMs: s.fastMs || 2000, target: s.targetStreak || 4 };
  }

  /* ---------------- 세션 ---------------- */

  function start(mode, folder) {
    session = {
      mode: mode || 'flash',
      folder: folder && folder !== '*' ? folder : null,
      answered: 0, fast: 0, correct: 0,
      startedAt: Date.now(), lastId: null, shownAt: 0
    };
    return session;
  }

  /** 현재 세션 범위(폴더)에 해당하는 대기열 */
  function scopedQueue() {
    var q = queue();
    if (!session || !session.folder) return q;
    return q.filter(function (id) {
      var w = Store.get(id);
      return w && (w.folder || Store.DEFAULT_FOLDER) === session.folder;
    });
  }

  function end() {
    var s = session;
    session = null;
    return s;
  }

  function current() { return session; }

  /* ---------------- 출제 ---------------- */

  /** 대기열 앞쪽 창(window) 안에서 랜덤으로 한 단어를 고른다 */
  function next() {
    var q = scopedQueue();
    if (!q.length) return null;

    var win = Math.min(WINDOW, q.length);
    var pool = q.slice(0, win);

    // 직전 단어가 연속으로 다시 나오는 것 방지
    if (session && session.lastId && pool.length > 1) {
      pool = pool.filter(function (id) { return id !== session.lastId; });
    }
    var id = pool[Math.floor(Math.random() * pool.length)];
    var w = Store.get(id);
    if (!w) {                       // 데이터가 깨진 경우 실제 큐에서 제거하고 재시도
      var real = queue();
      var i = real.indexOf(id);
      if (i !== -1) real.splice(i, 1);
      return next();
    }
    if (session) {
      session.lastId = id;
      session.shownAt = Date.now();
    }
    return w;
  }

  /** 카드를 화면에 띄운 시각 기록 (뜻 보기까지의 시간 측정 시작) */
  function markShown() {
    if (session) session.shownAt = Date.now();
  }

  function elapsed() {
    if (!session || !session.shownAt) return 0;
    return Date.now() - session.shownAt;
  }

  /* ---------------- 채점 ---------------- */

  /**
   * 대기열에서 id를 빼고 depth 위치에 다시 꽂는다.
   * 폴더 범위로 학습 중이면 "그 폴더 안에서의 depth"가 되도록 실제 위치를 계산한다.
   */
  function moveTo(id, depth) {
    var q = queue();
    var i = q.indexOf(id);
    if (i !== -1) q.splice(i, 1);

    var scope = session && session.folder;
    if (!scope) {
      q.splice(Math.max(0, Math.min(depth, q.length)), 0, id);
      return;
    }
    var count = 0, pos = q.length;
    for (var k = 0; k < q.length; k++) {
      var w = Store.get(q[k]);
      if (w && (w.folder || Store.DEFAULT_FOLDER) === scope) {
        if (count >= depth) { pos = k; break; }
        count++;
      }
    }
    q.splice(pos, 0, id);
  }

  /**
   * grade: 'good'(알았어요) | 'hard'(헷갈려요) | 'again'(몰랐어요)
   * ms   : 단어가 보인 뒤 '뜻 보기'까지 걸린 시간
   * 반환 : {fast, streak, mastered, target, promoted}
   */
  function grade(id, grade_, ms) {
    var w = Store.get(id);
    if (!w) return null;
    var c = conf();
    var st = w.stats || (w.stats = Store.newStats());

    var correct = (grade_ === 'good');
    var fast = correct && ms <= c.fastMs;
    var promoted = false;

    st.seen++;
    st.lastSeen = Date.now();
    st.lastMs = ms;
    if (correct) st.correct++;

    if (fast) {
      st.fast++;
      st.fastStreak++;
    } else {
      st.fastStreak = 0;         // 즉답이 끊기면 연속 기록 초기화
      if (grade_ === 'again') st.mastered = false;
    }

    if (st.fastStreak >= c.target) {
      // 목표 연속 즉답 달성 → 익힘 처리하고 맨 뒤로 밀어 새 단어에 자리를 내준다
      st.mastered = true;
      promoted = true;
      moveTo(id, queue().length);
    } else if (fast) {
      moveTo(id, 5 + st.fastStreak * 4);
    } else if (correct) {
      moveTo(id, 4);             // 느리게 맞춤 → 조금 뒤
    } else if (grade_ === 'hard') {
      moveTo(id, 3);
    } else {
      moveTo(id, 2);             // 몰랐음 → 곧 다시
    }

    if (session) {
      session.answered++;
      if (fast) session.fast++;
      if (correct) session.correct++;
    }
    var g = Store.raw().stats;
    g.totalAnswers++;
    if (fast) g.fastAnswers++;

    Store.save();

    return {
      fast: fast,
      correct: correct,
      streak: st.fastStreak,
      mastered: !!st.mastered,
      target: c.target,
      promoted: promoted
    };
  }

  /* ---------------- 통계 ---------------- */

  /** 카드 뒷면·객관식 보기에 쓸 대표 뜻 */
  function meaningLabel(w) {
    if (!w) return '';
    if (w.myMeaning) return w.myMeaning;
    if (w.meanings && w.meanings[0] && w.meanings[0].defs[0]) return w.meanings[0].defs[0].def;
    return '';
  }

  /** 객관식 오답 보기 만들기 (같은 범위의 다른 단어 뜻에서 뽑는다) */
  function distractors(word, n, folder) {
    var pool = Store.favorites(folder || (session && session.folder) || null)
      .filter(function (w) { return w.id !== word.id; })
      .map(meaningLabel)
      .filter(function (t) { return t && t !== meaningLabel(word); });

    // 중복 제거
    var uniq = [];
    pool.forEach(function (t) { if (uniq.indexOf(t) === -1) uniq.push(t); });

    // 범위 안에 보기가 모자라면 전체 단어장에서 보충
    if (uniq.length < n) {
      Store.favorites().forEach(function (w) {
        if (uniq.length >= n * 3) return;
        var t = meaningLabel(w);
        if (w.id !== word.id && t && t !== meaningLabel(word) && uniq.indexOf(t) === -1) uniq.push(t);
      });
    }

    // 셔플 후 n개
    for (var i = uniq.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t2 = uniq[i]; uniq[i] = uniq[j]; uniq[j] = t2;
    }
    return uniq.slice(0, n);
  }

  function stats(folder) {
    var favs = Store.favorites(folder && folder !== '*' ? folder : null);
    var target = conf().target;
    var mastered = 0, learning = 0;
    favs.forEach(function (w) {
      var st = w.stats || {};
      if (st.mastered || (st.fastStreak || 0) >= target) mastered++;
      else if (st.seen) learning++;
    });
    return {
      total: favs.length,
      mastered: mastered,
      learning: learning,
      fresh: favs.length - mastered - learning
    };
  }

  /** 이 단어를 대기열 앞쪽으로 끌어온다 (연속 듣기 중 "다시 볼래요") */
  function bump(id) {
    var w = Store.get(id);
    if (!w) return;
    if (w.stats) { w.stats.fastStreak = 0; w.stats.mastered = false; }
    moveTo(id, 0);
    Store.save();
  }

  /** 연속 즉답 진행 표시용 ●●○○ */
  function streakDots(streak, target) {
    var s = Math.max(0, Math.min(streak, target));
    return new Array(s + 1).join('●') + new Array(target - s + 1).join('○');
  }

  global.Review = {
    start: start,
    end: end,
    current: current,
    next: next,
    markShown: markShown,
    elapsed: elapsed,
    grade: grade,
    bump: bump,
    stats: stats,
    streakDots: streakDots,
    meaningLabel: meaningLabel,
    distractors: distractors,
    scopedQueue: scopedQueue,
    conf: conf
  };
})(window);
