/* =========================================================
   api.js — 사전 조회 / 번역 / 발음
   사전 : Free Dictionary API (무료, 키 불필요)
   번역 : MyMemory (무료, 키 불필요)
   ========================================================= */
(function (global) {
  'use strict';

  var DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  var WIKT_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  var WIKT_API = 'https://en.wiktionary.org/w/api.php';
  var DM_URL = 'https://api.datamuse.com';
  var TRANS_URL = 'https://api.mymemory.translated.net/get';

  var POS_KO = {
    noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사',
    pronoun: '대명사', preposition: '전치사', conjunction: '접속사',
    interjection: '감탄사', determiner: '한정사', exclamation: '감탄사',
    numeral: '수사', article: '관사', prefix: '접두사', suffix: '접미사'
  };

  // 번역기 붙여넣기에 섞여 들어오는 품사 표기
  var KO_POS_TOKENS = ['명사', '동사', '형용사', '부사', '대명사', '전치사',
    '접속사', '감탄사', '한정사', '수사', '관사', '자동사', '타동사', '복수형'];

  /* ---------------------------------------------------------
     붙여넣은 텍스트에서 영어 단어와 한글 뜻을 분리
     예) "resilient\n형용사\n회복력 있는" -> {word:"resilient", ko:"회복력 있는"}
     --------------------------------------------------------- */
  function parseInput(raw) {
    var text = String(raw || '')
      .replace(/ /g, ' ')
      .replace(/[\[\/][^\]\/]*[\]\/]/g, ' ')   // 발음기호 /rɪˈzɪliənt/, [..] 제거
      .trim();
    if (!text) return { word: '', ko: '' };

    var lines = text.split(/[\n\r]+/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean);
    if (!lines.length) lines = [text];

    var enRuns = [];
    var koParts = [];

    lines.forEach(function (line) {
      // 줄 안의 한글 조각
      var ko = (line.match(/[가-힣][가-힣0-9\s,~·ㆍ()<>'"-]*/g) || [])
        .join(' ').replace(/\s+/g, ' ').trim();
      if (ko) {
        // 품사 표기만 있는 조각은 버림
        var cleaned = ko;
        KO_POS_TOKENS.forEach(function (p) {
          cleaned = cleaned.replace(new RegExp('(^|[\\s,·])' + p + '(?=$|[\\s,·])', 'g'), ' ');
        });
        cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[\s,·]+|[\s,·]+$/g, '').trim();
        if (cleaned) koParts.push(cleaned);
      }
      // 줄 안의 영어 조각 (연속된 영단어 묶음)
      var runs = line.match(/[A-Za-z][A-Za-z'’\-]*(?:[ \t]+[A-Za-z][A-Za-z'’\-]*)*/g) || [];
      runs.forEach(function (r) {
        r = r.trim();
        if (r) enRuns.push(r);
      });
    });

    // 알파벳이 가장 많은 묶음을 단어로 채택 (최대 4단어까지: 구동사/숙어 대응)
    enRuns.sort(function (a, b) {
      return b.replace(/[^A-Za-z]/g, '').length - a.replace(/[^A-Za-z]/g, '').length;
    });
    var word = (enRuns[0] || '').split(/\s+/).slice(0, 4).join(' ')
      .replace(/^[-'’]+|[-'’]+$/g, '');

    return {
      word: word,
      ko: koParts.join(', ').slice(0, 200)
    };
  }

  /* ---------------------------------------------------------
     원형 후보 만들기 (사전에 없을 때 재시도용)
     --------------------------------------------------------- */
  function baseForms(word) {
    var w = word.toLowerCase().trim();
    var out = [];
    function add(x) { if (x && x !== w && x.length > 1 && out.indexOf(x) === -1) out.push(x); }

    if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ies$/.test(w)) add(w.slice(0, -2));
    if (/(ches|shes|sses|xes|zes)$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (/ing$/.test(w)) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + 'e');
      if (/([bdgmnprtl])\1ing$/.test(w)) add(w.slice(0, -4)); // running -> run
    }
    if (/ly$/.test(w)) add(w.slice(0, -2));
    if (/est$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
    if (/er$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    return out.slice(0, 5);
  }

  /* ---------------------------------------------------------
     사전 응답 정규화
     --------------------------------------------------------- */
  function normalize(json, queried) {
    if (!Array.isArray(json) || !json.length) return null;

    var word = json[0].word || queried;
    var phonetic = '';
    var audio = '';
    var sourceUrl = '';
    var posMap = {};   // pos -> defs[]
    var posOrder = [];

    json.forEach(function (e) {
      if (!phonetic && e.phonetic) phonetic = e.phonetic;
      (e.phonetics || []).forEach(function (p) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audio && p.audio) audio = p.audio;
      });
      if (!sourceUrl && e.sourceUrls && e.sourceUrls.length) sourceUrl = e.sourceUrls[0];

      (e.meanings || []).forEach(function (m) {
        var pos = m.partOfSpeech || 'etc';
        if (!posMap[pos]) { posMap[pos] = []; posOrder.push(pos); }
        (m.definitions || []).forEach(function (d) {
          if (!d.definition) return;
          var dup = posMap[pos].some(function (x) { return x.def === d.definition; });
          if (dup) return;
          posMap[pos].push({
            def: d.definition,
            example: d.example || '',
            synonyms: (d.synonyms || []).slice(0, 5)
          });
        });
        // 뜻 레벨의 동의어도 첫 정의에 붙여준다
        if (m.synonyms && m.synonyms.length && posMap[pos].length) {
          var first = posMap[pos][0];
          if (!first.synonyms.length) first.synonyms = m.synonyms.slice(0, 5);
        }
      });
    });

    var meanings = posOrder.map(function (pos) {
      var defs = posMap[pos];
      // 예문 있는 정의를 앞으로 (암기 카드에서 예문을 보여주기 위함)
      var withEx = defs.filter(function (d) { return d.example; });
      var noEx = defs.filter(function (d) { return !d.example; });
      return {
        pos: pos,
        posKo: POS_KO[pos] || '',
        defs: withEx.concat(noEx).slice(0, 6)
      };
    }).filter(function (m) { return m.defs.length; });

    if (!meanings.length) return null;

    return {
      word: word,
      phonetic: phonetic,
      audio: audio,
      meanings: meanings,
      sourceUrl: sourceUrl,
      fetchedAt: Date.now()
    };
  }

  /* ---------------------------------------------------------
     공통 fetch — 응답이 없으면 매달려 있지 않도록 시간 제한을 둔다
     --------------------------------------------------------- */
  function fetchJson(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 7000);
    var opts = { headers: { 'Accept': 'application/json' } };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (res.status === 404) return { notFound: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then(function (j) { return { json: j }; });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ---------------------------------------------------------
     사전 1 — Free Dictionary API (뜻 + 예문 + 발음, 가장 풍부)
     --------------------------------------------------------- */
  // 서버가 죽어 있으면 매번 기다리지 않도록 일정 시간 건너뛴다
  var dictApiDownUntil = 0;

  function fromDictionaryApi(word) {
    if (Date.now() < dictApiDownUntil) return Promise.resolve({ skipped: true });

    // 1순위 사전은 짧게 기다린다. 응답이 없으면 곧바로 대체 사전으로 넘어간다.
    return fetchJson(DICT_URL + encodeURIComponent(word), 3500).then(function (r) {
      if (r.notFound) return { notFound: true };
      var entry = normalize(r.json, word);
      if (entry) entry.source = 'Free Dictionary';
      return { entry: entry };
    }).catch(function (err) {
      // 404 가 아닌 실패 = 서버 장애. 5분간 건너뛴다.
      dictApiDownUntil = Date.now() + 5 * 60 * 1000;
      return { failed: true, err: err };
    });
  }

  /* ---------------------------------------------------------
     사전 2 — Wiktionary (정의 + 품사, 때때로 예문)
     --------------------------------------------------------- */
  function stripHtml(s) {
    return String(s || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fromWiktionary(word) {
    var url = WIKT_URL + encodeURIComponent(word.replace(/ /g, '_'));
    return fetchJson(url, 7000).then(function (r) {
      if (r.notFound || !r.json || !r.json.en) return { notFound: true };

      var meanings = [];
      r.json.en.forEach(function (sec) {
        var pos = String(sec.partOfSpeech || '').toLowerCase();
        var defs = [];
        (sec.definitions || []).forEach(function (d) {
          var text = stripHtml(d.definition);
          if (!text || text.length < 2) return;
          var ex = '';
          if (d.parsedExamples && d.parsedExamples.length) ex = stripHtml(d.parsedExamples[0].example);
          else if (d.examples && d.examples.length) ex = stripHtml(d.examples[0]);
          defs.push({ def: text, example: ex, synonyms: [] });
        });
        if (defs.length) {
          meanings.push({ pos: pos, posKo: POS_KO[pos] || '', defs: defs.slice(0, 6) });
        }
      });
      if (!meanings.length) return { notFound: true };

      return { entry: {
        word: word, phonetic: '', audio: '', meanings: meanings,
        sourceUrl: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(word),
        source: 'Wiktionary', fetchedAt: Date.now()
      } };
    }).catch(function (err) { return { failed: true, err: err }; });
  }

  /* ---------------------------------------------------------
     사전 3 — Datamuse (간단한 정의, 매우 빠름)
     --------------------------------------------------------- */
  var DM_POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: 'etc' };

  function fromDatamuse(word) {
    var url = DM_URL + '/words?sp=' + encodeURIComponent(word) + '&md=dp&max=1';
    return fetchJson(url, 7000).then(function (r) {
      var list = r.json;
      if (!Array.isArray(list) || !list.length) return { notFound: true };
      var hit = list[0];
      if (String(hit.word).toLowerCase() !== word.toLowerCase()) return { notFound: true };
      if (!hit.defs || !hit.defs.length) return { notFound: true };

      var posMap = {}, order = [];
      hit.defs.slice(0, 8).forEach(function (d) {
        var parts = String(d).split('\t');
        var pos = DM_POS[parts[0]] || 'etc';
        var text = (parts[1] || parts[0] || '').trim();
        if (!text) return;
        if (!posMap[pos]) { posMap[pos] = []; order.push(pos); }
        posMap[pos].push({ def: text, example: '', synonyms: [] });
      });
      var meanings = order.map(function (pos) {
        return { pos: pos, posKo: POS_KO[pos] || '', defs: posMap[pos].slice(0, 6) };
      });
      if (!meanings.length) return { notFound: true };

      return { entry: {
        word: hit.word, phonetic: '', audio: '', meanings: meanings,
        sourceUrl: '', source: 'Datamuse', fetchedAt: Date.now()
      } };
    }).catch(function (err) { return { failed: true, err: err }; });
  }

  /* ---------------------------------------------------------
     예문 보충 — Wiktionary 원문(위키텍스트)에서 용례와 인용문을 뽑는다.
     REST 응답만으로는 예문이 절반 정도밖에 없어서 보충용으로 쓴다.
     --------------------------------------------------------- */
  function cleanWiki(s) {
    return String(s || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')   // [[link|표시]] -> 표시
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\{\{[^{}]*\}\}/g, '')                 // 남은 템플릿 제거
      .replace(/'''?/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function usableExample(text, word) {
    if (!text) return false;
    if (text.length < 20 || text.length > 160) return false;   // 너무 긴 인용문은 학습에 부담
    if (/[{}|=\[\]]/.test(text)) return false;
    // 해당 단어(또는 어간)가 들어 있는 문장만
    var stem = word.toLowerCase().replace(/(ing|ed|es|s)$/, '');
    if (stem.length > 3 && text.toLowerCase().indexOf(stem) === -1) return false;
    return true;
  }

  function fetchWikiExamples(word, max) {
    max = max || 3;
    var url = WIKT_API + '?action=parse&page=' + encodeURIComponent(word.replace(/ /g, '_')) +
              '&prop=wikitext&format=json&formatversion=2&origin=*';

    return fetchJson(url, 8000).then(function (r) {
      var wt = r.json && r.json.parse && r.json.parse.wikitext;
      if (!wt) return [];
      // 영어 섹션만 사용
      var i = wt.indexOf('==English==');
      if (i !== -1) {
        var rest = wt.slice(i + 11);
        var next = rest.search(/\n==[^=]/);
        wt = next === -1 ? rest : rest.slice(0, next);
      }

      var out = [];
      function push(t) {
        t = cleanWiki(t);
        if (!usableExample(t, word)) return;
        if (out.indexOf(t) === -1) out.push(t);
      }

      // 1) 사전 편집자가 쓴 용례 {{ux|en|...}}
      var m, reUx = /\{\{(?:ux|usex|uxi)\|en\|([^}|]+)/g;
      while ((m = reUx.exec(wt)) !== null && out.length < max * 2) push(m[1]);

      // 2) 실제 출판물 인용문 |passage=...
      var rePass = /\|passage=([^|}]{25,220})/g;
      while ((m = rePass.exec(wt)) !== null && out.length < max * 2) push(m[1]);

      // 완전한 문장(대문자로 시작하고 문장부호로 끝남)을 앞쪽으로, 그다음 짧은 순
      function sentenceScore(t) {
        return (/^[A-Z"']/.test(t) ? 0 : 1) + (/[.!?]"?$/.test(t) ? 0 : 1);
      }
      out.sort(function (a, b) {
        return sentenceScore(a) - sentenceScore(b) || a.length - b.length;
      });
      return out.slice(0, max);
    }).catch(function () { return []; });
  }

  /**
   * 예문을 찾지 못했을 때 대신 찾아볼 관련 단어
   * 예) resentful -> resent, happiness -> happy
   */
  function relatedForms(word) {
    var w = String(word || '').toLowerCase().trim();
    var out = [];
    function add(x) {
      if (x && x !== w && x.length > 2 && out.indexOf(x) === -1) out.push(x);
    }
    baseForms(w).forEach(add);

    [['fully', ''], ['ful', ''], ['ness', ''], ['ment', ''], ['ity', ''],
     ['ive', ''], ['ous', ''], ['able', ''], ['ible', ''], ['ly', '']
    ].forEach(function (p) {
      var suf = p[0];
      if (w.length > suf.length + 2 && w.slice(-suf.length) === suf) {
        var stem = w.slice(0, -suf.length);
        if (/i$/.test(stem)) add(stem.slice(0, -1) + 'y');   // happiness -> happy (먼저 시도)
        add(stem);
        add(stem + 'e');
      }
    });
    return out.slice(0, 4);
  }

  /* ---------------------------------------------------------
     철자 교정 제안 (cyogenic -> cryogenic)
     --------------------------------------------------------- */
  function suggestSpelling(word) {
    return fetchJson(DM_URL + '/sug?s=' + encodeURIComponent(word) + '&max=6', 6000)
      .then(function (r) {
        if (!Array.isArray(r.json)) return [];
        return r.json.map(function (x) { return x.word; })
          .filter(function (w) { return w.toLowerCase() !== word.toLowerCase(); })
          .slice(0, 5);
      }).catch(function () { return []; });
  }

  /** 사전 세 곳을 차례로 시도한다 */
  function fetchAnySource(word) {
    return fromDictionaryApi(word).then(function (a) {
      if (a.entry) return a;
      return fromWiktionary(word).then(function (b) {
        if (b.entry) return b;
        return fromDatamuse(word).then(function (c) {
          if (c.entry) return c;
          // 세 곳 모두 "없음" 이면 진짜 없는 단어, 하나라도 통신 실패면 연결 문제
          var failed = a.failed && (b.failed || c.failed);
          return { notFound: !failed, failed: failed, err: a.err || b.err || c.err };
        });
      });
    });
  }

  /* ---------------------------------------------------------
     단어 조회
     반환: {ok, entry, cached, viaBase}  또는  {ok:false, notFound, suggestions, error}
     --------------------------------------------------------- */
  function lookup(word, opts) {
    opts = opts || {};
    var q = String(word || '').trim();
    if (!q) return Promise.resolve({ ok: false, error: '단어를 입력해 주세요' });

    // 저장된 단어 / 캐시 우선
    if (!opts.force) {
      var saved = Store.get(q);
      if (saved && saved.meanings && saved.meanings.length) {
        return Promise.resolve({ ok: true, cached: true, entry: {
          word: saved.word, phonetic: saved.phonetic, audio: saved.audio,
          meanings: saved.meanings, sourceUrl: saved.sourceUrl
        } });
      }
      var cached = Store.getCache(q);
      if (cached) return Promise.resolve({ ok: true, cached: true, entry: cached });
    }

    if (!navigator.onLine) {
      return Promise.resolve({ ok: false, offline: true, error: '오프라인입니다. 저장해 둔 단어만 볼 수 있어요.' });
    }

    var candidates = [q].concat(baseForms(q));
    var idx = 0;

    var anyNetworkFail = false;

    function attempt() {
      if (idx >= candidates.length) {
        // 못 찾았으면 철자 교정 후보를 제안한다
        return suggestSpelling(q).then(function (sug) {
          if (anyNetworkFail && !sug.length) {
            return {
              ok: false,
              error: '사전 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
            };
          }
          return {
            ok: false, notFound: true,
            error: sug.length
              ? '"' + q + '" 을(를) 찾지 못했습니다. 혹시 이 단어인가요?'
              : '"' + q + '" 은(는) 사전에서 찾지 못했습니다.',
            suggestions: sug.length ? sug : baseForms(q)
          };
        });
      }

      var cand = candidates[idx++];
      return fetchAnySource(cand).then(function (r) {
        if (r.failed) anyNetworkFail = true;
        if (!r.entry) return attempt();
        Store.putCache(r.entry);
        return { ok: true, entry: r.entry, viaBase: (idx > 1 ? cand : null), source: r.entry.source };
      });
    }

    return attempt();
  }

  /* ---------------------------------------------------------
     번역 (영 -> 한). 캐시 + 중복요청 합치기.
     --------------------------------------------------------- */
  var inflight = {};

  function translate(text, opts) {
    opts = opts || {};
    var src = String(text || '').trim();
    if (!src) return Promise.resolve('');
    if (src.length > 480) src = src.slice(0, 480);

    var key = 'en|ko|' + src.toLowerCase();
    var hit = Store.getTrans(key);
    if (hit) return Promise.resolve(hit);
    if (!navigator.onLine) return Promise.resolve('');
    if (inflight[key]) return inflight[key];

    /**
     * 같은 문장이라도 끝의 마침표 때문에 번역이 안 되는 경우가 있어
     * (잘못된 번역 메모리 항목) 변형을 차례로 시도한다.
     */
    var variants = [src];
    var noDot = src.replace(/[.。]\s*$/, '').trim();
    if (noDot && noDot !== src) variants.push(noDot);
    var lower = src.charAt(0).toLowerCase() + src.slice(1);
    if (lower !== src) variants.push(lower);

    function askOne(text) {
      var url = TRANS_URL + '?q=' + encodeURIComponent(text) + '&langpair=en|ko&de=vocab@app.local';
      return fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var t = j && j.responseData && j.responseData.translatedText;
          if (!t) return '';
          if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t)) return '';
          t = t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
          // 한글이 한 글자도 없으면 번역이 안 된 것으로 본다
          if (!/[가-힣]/.test(t)) return '';
          return t;
        })
        .catch(function () { return ''; });
    }

    function tryNext(i) {
      if (i >= variants.length) return Promise.resolve('');
      return askOne(variants[i]).then(function (t) {
        return t || tryNext(i + 1);
      });
    }

    var p = tryNext(0)
      .then(function (t) {
        if (t) Store.putTrans(key, t);   // 캐시는 항상 원문 기준
        return t;
      })
      .then(function (v) { delete inflight[key]; return v; });

    inflight[key] = p;
    return p;
  }

  /* ---------------------------------------------------------
     발음
     --------------------------------------------------------- */
  var audioEl = null;
  var voice = null;

  function pickVoice() {
    if (!global.speechSynthesis) return null;
    if (voice) return voice;
    var list = global.speechSynthesis.getVoices() || [];
    voice = list.filter(function (v) { return /^en[-_]US/i.test(v.lang); })[0] ||
            list.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
    return voice;
  }
  if (global.speechSynthesis) {
    global.speechSynthesis.onvoiceschanged = function () { voice = null; pickVoice(); };
  }

  function speak(text, audioUrl) {
    var t = String(text || '').trim();
    if (!t) return;

    // 사전에서 온 원어민 음성이 있으면 우선 사용
    if (audioUrl) {
      try {
        if (!audioEl) audioEl = new Audio();
        audioEl.src = audioUrl;
        var pr = audioEl.play();
        if (pr && pr.catch) pr.catch(function () { tts(t); });
        return;
      } catch (e) { /* fallthrough */ }
    }
    tts(t);
  }

  function tts(t) {
    if (!global.speechSynthesis) return;
    try {
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(t);
      u.lang = 'en-US';
      u.rate = Store.settings().ttsRate || 0.9;
      var v = pickVoice();
      if (v) u.voice = v;
      global.speechSynthesis.speak(u);
    } catch (e) { /* 무시 */ }
  }

  /** 재생이 끝나면 resolve 되는 발음 (연속 듣기 모드용) */
  function speakP(text, audioUrl) {
    var t = String(text || '').trim();
    if (!t) return Promise.resolve();

    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (!done) { done = true; resolve(); } }

      // 길이에 비례한 안전장치 (기기에 따라 onend 가 안 오는 경우 대비)
      var guard = Math.min(15000, 1200 + t.length * 95);
      setTimeout(fin, guard);

      if (audioUrl) {
        try {
          if (!audioEl) audioEl = new Audio();
          audioEl.onended = fin;
          audioEl.onerror = function () { ttsP(t).then(fin); };
          audioEl.src = audioUrl;
          var pr = audioEl.play();
          if (pr && pr.catch) pr.catch(function () { ttsP(t).then(fin); });
          return;
        } catch (e) { /* fallthrough */ }
      }
      ttsP(t).then(fin);
    });
  }

  function ttsP(t) {
    return new Promise(function (resolve) {
      if (!global.speechSynthesis) { resolve(); return; }
      try {
        global.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(t);
        u.lang = 'en-US';
        u.rate = Store.settings().ttsRate || 0.9;
        var v = pickVoice();
        if (v) u.voice = v;
        u.onend = resolve;
        u.onerror = resolve;
        global.speechSynthesis.speak(u);
      } catch (e) { resolve(); }
    });
  }

  function stopSpeak() {
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) { /* 무시 */ }
    try { if (audioEl) { audioEl.pause(); audioEl.onended = null; audioEl.onerror = null; } } catch (e) { /* 무시 */ }
  }

  global.Api = {
    parseInput: parseInput,
    baseForms: baseForms,
    lookup: lookup,
    suggestSpelling: suggestSpelling,
    fetchWikiExamples: fetchWikiExamples,
    relatedForms: relatedForms,
    translate: translate,
    speak: speak,
    speakP: speakP,
    stopSpeak: stopSpeak,
    POS_KO: POS_KO
  };
})(window);
