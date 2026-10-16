/* 音感练习 - 三个独立模式：音级听辨 / 旋律听写 / 聆听模式
 * 核心方法 (Alain Benbassat): I-IV-V-I 锚定调性 -> 单音音级识别
 * 音频: js-synthesizer + FluidSynth(WASM) 加载本地 SF2
 */
(function () {
  'use strict';

  // ---------- 音乐数据 ----------
  var SCALES = { major: { name: '大调' }, minor: { name: '小调' } };
  var CHROMA = [
    { deg: '1',  sf: 'Do' }, { deg: '#1', sf: 'Di' }, { deg: '2',  sf: 'Re' },
    { deg: 'b3', sf: 'Me' }, { deg: '3',  sf: 'Mi' }, { deg: '4',  sf: 'Fa' },
    { deg: '#4', sf: 'Fi' }, { deg: '5',  sf: 'Sol' }, { deg: 'b6', sf: 'Se' },
    { deg: '6',  sf: 'La' }, { deg: 'b7', sf: 'Te' }, { deg: '7',  sf: 'Ti' }
  ];
  var ORDER_DIATONIC = [0, 2, 4, 5, 7, 9, 11];
  var ORDER_CHROMA   = [0, 2, 4, 5, 7, 9, 11, 3, 6, 8, 10];
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // ---------- 音频引擎 ----------
  var Audio = {
    ctx: null, synth: null, ready: false, currentProgram: 0,
    init: function () {
      // 幂等：页面加载即自动调用，后续各模式的 init 调用共享同一次加载
      if (this._initPromise) return this._initPromise;
      var self = this;
      var ov = document.getElementById('bootOverlay');
      var s = document.getElementById('status');
      if (ov) ov.classList.remove('hidden');
      this._initPromise = new Promise(function (resolve, reject) {
        try {
          self.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { reject(e); return; }
        if (typeof JSSynth === 'undefined' || !JSSynth.waitForReady) {
          reject(new Error('js-synthesizer 未加载'));
          return;
        }
        JSSynth.waitForReady().then(function () {
          self.synth = new JSSynth.Synthesizer();
          self.synth.init(self.ctx.sampleRate);
          var node = self.synth.createAudioNode(self.ctx, 8192);
          node.connect(self.ctx.destination);
          return fetch(SOUNDFONT_URL)
            .then(function (r) {
              if (!r.ok) throw new Error('SF2 加载失败 HTTP ' + r.status);
              return r.arrayBuffer();
            })
            .then(function (buf) { return self.synth.loadSFont(buf); })
            .then(function () {
              self.ready = true;
              self.setProgram(self.currentProgram);
              resolve();
            });
        }).catch(function (e) { reject(e); });
      });
      this._initPromise.then(function () {
        if (ov) ov.classList.add('hidden');
        s.textContent = '声音准备好了，可以直接开始。';
      }).catch(function (e) {
        if (ov) ov.classList.add('hidden');
        self._initPromise = null;  // 允许下次点击重试
        s.className = 'status err';
        s.textContent = '声音初始化失败：' + e.message + '，点击「开始」可重试。';
      });
      return this._initPromise;
    },
    setProgram: function (p) {
      this.currentProgram = p;
      if (this.synth) this.synth.midiProgramChange(0, p);
    },
    playNote: function (midi, durMs, velocity) {
      if (!this.ready) return;
      this.synth.midiNoteOn(0, midi, velocity || 90);
      var self = this;
      setTimeout(function () { self.synth.midiNoteOff(0, midi); }, durMs);
    },
    resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    allOff: function () { if (this.synth) this.synth.midiAllNotesOff(0); }
  };

  // ---------- 精确时序调度 ----------
  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  var seqTimer = null;
  var playToken = 0;
  var timelineBase = 0;   // 当前时间轴的起点时刻
  var SOUNDFONT_URL = './soundfonts/GeneralUserGS-Trimmed.sf2';

  function buildEvents(list) {
    var evs = [];
    list.forEach(function (n) {
      n.midis.forEach(function (m) {
        evs.push({ at: n.at, midi: m, vel: n.vel || 85, on: true });
        evs.push({ at: n.at + n.dur, midi: m, on: false });
      });
    });
    evs.sort(function (a, b) {
      if (a.at !== b.at) return a.at - b.at;
      if (a.on === b.on) return 0;
      return a.on ? 1 : -1;
    });
    // 修正被后续同音高截断的 OFF（连奏必需）
    var nextOn = {};
    for (var i = evs.length - 1; i >= 0; i--) {
      var e = evs[i];
      if (e.on) { nextOn[e.midi] = e.at; continue; }
      var nx = nextOn[e.midi];
      if (nx !== undefined && e.at > nx) e.at = nx;
    }
    return evs;
  }

  function runTimeline(list, token, onDone) {
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = null; }
    var evs = buildEvents(list);
    var base = nowMs();
    timelineBase = base;
    var i = 0;
    function tick() {
      if (token !== undefined && token !== playToken) { seqTimer = null; return; }
      var t = nowMs() - base;
      while (i < evs.length && evs[i].at <= t) {
        var e = evs[i++];
        if (e.on) Audio.synth.midiNoteOn(0, e.midi, e.vel);
        else Audio.synth.midiNoteOff(0, e.midi);
      }
      if (i >= evs.length) {
        seqTimer = null;
        if (onDone) onDone();
        return;
      }
      seqTimer = setTimeout(tick, Math.max(4, Math.min(evs[i].at - t, 120)));
    }
    tick();
  }

  function stopTimeline() {
    playToken++;
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = null; }
    Audio.allOff();
  }

  // ---------- 共享设置 ----------
  var TOTAL_ROUNDS = 10;
  var CADENCE_TO_TARGET_DELAY = 1000;

  var State = {
    scale: 'major',
    label: 'solfege',
    chromatics: false,
    tempo: 1,
    interval: 400,
    difficulty: 1,
    fixedKey: true,
    keyRoot: 0,
    tonic: 60,
    targetOffset: 0,
    answered: false,
    started: false,
    running: false,
    finished: false,
    round: 0,
    firstTry: 0,
    wrongCount: 0,
    wrongThisRound: 0
  };

  // 旋律听写状态（独立）
  var Dict = {
    len: 4, total: 10,
    started: false, running: false, finished: false,
    round: 0, melody: [], pos: 0,
    firstTryNotes: 0, totalNotes: 0, hintUsed: 0,
    mistakesThisNote: 0, _streak: 0
  };

  // 聆听模式状态（独立）
  var Lis = {
    running: false, count: 0, round: 0,
    gap: 3500, repeat: 2, keepAwake: false,
    _timer: null, _wakeLock: null
  };

  var STATS_KEY = 'fet_stats_v1';
  function statsKey() {
    return State.scale + '|' + State.label + '|' + State.difficulty + '|' + (State.chromatics ? 1 : 0);
  }
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStats(o) { try { localStorage.setItem(STATS_KEY, JSON.stringify(o)); } catch (e) {} }

  // ---------- 工具 ----------
  function activeOrder() { return State.chromatics ? ORDER_CHROMA : ORDER_DIATONIC; }
  function maxDifficulty() { return activeOrder().length - 1; }
  function availableIndices() {
    return activeOrder().slice(0, Math.min(State.difficulty + 1, activeOrder().length));
  }
  function poolNames() {
    return availableIndices().map(function (i) { return CHROMA[i].sf; }).join(' ');
  }
  function keyInfoText() {
    var k = State.fixedKey
      ? ('固定 ' + NOTE_NAMES[State.keyRoot] + ' ' + SCALES[State.scale].name)
      : ('调性随机 ' + SCALES[State.scale].name);
    return State.chromatics ? k + ' + 半音' : k;
  }
  function labelFor(idx, tonicOverride) {
    var c = CHROMA[idx];
    if (State.label === 'solfege') return c.sf;
    if (State.label === 'number') return c.deg;
    var midi = (tonicOverride || State.tonic) + idx;
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }
  function $(id) { return document.getElementById(id); }
  function pickTonic() {
    if (State.fixedKey) return 60 + State.keyRoot;
    return 55 + Math.floor(Math.random() * 13);
  }

  function cadenceChords(T) {
    if (State.scale === 'major') {
      return [
        [T, T + 4, T + 7],
        [T + 5, T + 9, T + 12],
        [T + 7, T + 11, T + 14],
        [T, T + 4, T + 7]
      ];
    }
    return [
      [T, T + 3, T + 7],
      [T + 5, T + 8, T + 12],
      [T + 7, T + 10, T + 14],
      [T, T + 3, T + 7]
    ];
  }
  function fitRange(midi) {
    while (midi > 79) midi -= 12;
    while (midi < 48) midi += 12;
    return midi;
  }

  // 构建和弦进行的时间轴（连奏）
  function cadenceTimeline(T, unit, dur) {
    var chords = cadenceChords(T);
    var list = [];
    for (var i = 0; i < chords.length; i++) {
      var vel = (i === chords.length - 1) ? 92 : 82;
      list.push({ at: i * unit, midis: chords[i], dur: dur, vel: vel });
    }
    return { list: list, endAt: (chords.length - 1) * unit + dur };
  }

  // ============ Tab 1: 音级听辨 ============
  function renderGrid() {
    renderPreviewBar();
    var grid = $('grid');
    grid.innerHTML = '';
    availableIndices().forEach(function (idx) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'deg';
      d.dataset.idx = idx;
      var c = CHROMA[idx];
      var main = State.label === 'solfege' ? c.sf : (State.label === 'number' ? c.deg : labelFor(idx));
      var meta = State.label === 'solfege' ? c.deg : (State.label === 'number' ? c.sf : '');
      d.innerHTML = '<span class="sf"></span>' + (meta ? '<span class="meta"></span>' : '');
      d.querySelector('.sf').textContent = main;
      if (meta) d.querySelector('.meta').textContent = meta;
      d.addEventListener('click', function () { answer(idx, d); });
      grid.appendChild(d);
    });
  }

  function renderProgress() {
    var info = $('progressInfo');
    var dots = $('progressDots');
    dots.innerHTML = '';
    for (var i = 1; i <= TOTAL_ROUNDS; i++) {
      var d = document.createElement('i');
      if (i < State.round || (State.finished && i <= State.round)) d.className = 'done';
      if (State.running && i === State.round) d.className = 'cur';
      dots.appendChild(d);
    }
    if (!State.started) info.textContent = '未开始';
    else if (State.finished) info.textContent = State.round + ' / ' + TOTAL_ROUNDS + ' 已练完';
    else info.textContent = State.round + ' / ' + TOTAL_ROUNDS;
  }

  function updatePlayBtn() {
    var b = $('playBtn');
    if (State.running) { b.disabled = true; b.textContent = '练习中'; }
    else if (State.finished) { b.disabled = false; b.textContent = '开启新一轮'; }
    else if (State.started) { b.disabled = false; b.textContent = '重新开始'; }
    else { b.disabled = false; b.textContent = '开始训练'; }
  }

  function renderStats() {
    var all = loadStats();
    var rec = all[statsKey()] || {};
    var body = document.querySelector('#statsTable tbody');
    body.innerHTML = '';
    availableIndices().forEach(function (idx) {
      var c = CHROMA[idx];
      var s = rec[idx] || { correct: 0, total: 0 };
      var pct = s.total ? Math.round(100 * s.correct / s.total) : 0;
      var tr = document.createElement('tr');
      var td1 = document.createElement('td');
      td1.textContent = c.sf + ' (' + c.deg + ')';
      var td2 = document.createElement('td');
      td2.className = 'num';
      td2.textContent = s.total ? pct + '%' : '-';
      var td3 = document.createElement('td');
      td3.className = 'num';
      td3.textContent = s.correct + ' / ' + s.total;
      var td4 = document.createElement('td');
      var bar = document.createElement('div');
      bar.className = 'bar';
      var fill = document.createElement('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      td4.appendChild(bar);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
      body.appendChild(tr);
    });
  }

  function clearMarks() {
    document.querySelectorAll('#grid .deg').forEach(function (d) {
      d.classList.remove('correct', 'wrong', 'playing');
    });
  }

  function playSequence() {
    if (!Audio.ready) return;
    Audio.resume();
    var T = State.tonic;
    var unit = 440 * State.tempo;
    var dur = unit * 1.25;
    var my = ++playToken;
    var target = fitRange(T + State.targetOffset);
    State._targetMidi = target;

    var cad = cadenceTimeline(T, unit, dur);
    cad.list.push({
      at: cad.endAt + CADENCE_TO_TARGET_DELAY,
      midis: [target], dur: 950 * State.tempo, vel: 95
    });
    runTimeline(cad.list, my);
  }

  function replayTarget() {
    if (!Audio.ready || !State.started) return;
    Audio.resume();
    playSequence();
  }

  // 只重播当前题的目标单音，不重播定调和弦
  function replayNoteOnly() {
    if (!Audio.ready || !State.started) return;
    Audio.resume();
    var target = fitRange(State.tonic + State.targetOffset);
    var my = ++playToken;
    runTimeline([{ at: 0, midis: [target], dur: 950 * State.tempo, vel: 95 }], my);
  }

  function playDescending(done) {
    var pool = availableIndices().slice().sort(function (a, b) { return b - a; });
    var gap = State.interval;
    var my = ++playToken;
    var dur = Math.max(150, gap * 0.72);
    $('feedback').textContent =
      '✓ 正确：' + CHROMA[State.targetOffset].sf + '（' + CHROMA[State.targetOffset].deg +
      '）。正在降序回放本难度的 ' + pool.length + ' 个音符...';

    var marks = [], list = [];
    pool.forEach(function (off, i) {
      marks.push({ at: i * gap, off: off });
      list.push({ at: i * gap, midis: [fitRange(State.tonic + off)], dur: dur, vel: 95 });
    });

    var mi = 0, token = my, hiTimer = null;
    function clearPlaying() {
      document.querySelectorAll('#grid .deg').forEach(function (c) { c.classList.remove('playing'); });
    }
    function hi() {
      clearPlaying();
      if (mi < marks.length) {
        var cell = document.querySelector('#grid .deg[data-idx="' + marks[mi].off + '"]');
        if (cell) cell.classList.add('playing');
        mi++;
      }
    }
    (function schedule() {
      if (token !== playToken) { hiTimer = null; return; }
      hi();
      if (mi < marks.length) hiTimer = setTimeout(schedule, gap);
      else hiTimer = null;
    })();

    runTimeline(list, my, function () {
      if (token !== playToken) return;
      if (hiTimer) { clearTimeout(hiTimer); hiTimer = null; }
      clearPlaying();
      if (done) done();
    });
  }

  function startSession() {
    var begin = function () {
      State.started = true;
      State.running = true;
      State.finished = false;
      State.round = 0;
      State.firstTry = 0;
      State.wrongCount = 0;
      State.wrongThisRound = 0;
      State._streak = 0;
      State.interval = +$('interval').value;
      $('summary').classList.add('hidden');
      $('streakInfo').textContent = '';
      startRound();
    };
    if (Audio.ready) { begin(); return; }
    Audio.init().then(begin).catch(function (e) {
      $('status').className = 'status err';
      $('status').textContent = '初始化失败：' + e.message;
    });
  }

  function startRound() {
    State.round++;
    State.wrongThisRound = 0;
    State.answered = false;
    State.tonic = pickTonic();
    var pool = availableIndices();
    State.targetOffset = pool[Math.floor(Math.random() * pool.length)];
    clearMarks();
    $('keyInfo').textContent = keyInfoText();
    var fb = $('feedback');
    fb.className = 'feedback';
    fb.textContent = '第 ' + State.round + ' / ' + TOTAL_ROUNDS +
      ' 题。听一段和弦定下调子，再判断刚才那个音是第几级。';
    renderProgress();
    updatePlayBtn();
    playSequence();
  }

  function recordStat(idx, correct) {
    var all = loadStats();
    var k = statsKey();
    if (!all[k]) all[k] = {};
    if (!all[k][idx]) all[k][idx] = { correct: 0, total: 0 };
    all[k][idx].total++;
    if (correct) all[k][idx].correct++;
    saveStats(all);
  }

  // 点击答案按钮时试听对应的音（答对后的降序回放期间不打断）
  function previewNote(idx, tonicOverride) {
    if (!Audio.ready) return null;
    Audio.resume();
    var midi = fitRange((tonicOverride || State.tonic) + idx);
    var my = ++playToken;
    runTimeline([{ at: 0, midis: [midi], dur: 620 * State.tempo, vel: 90 }], my);
    return midi;
  }

  // 设置区试听条：点击发音用于听音练习，跟随调性/音阶/半音/难度/标签设置
  function previewTonic() {
    return State.fixedKey ? 60 + State.keyRoot : (State.tonic || 60);
  }
  function renderPreviewBar() {
    var bar = $('previewBar');
    if (!bar) return;
    bar.innerHTML = '';
    var ton = previewTonic();
    availableIndices().forEach(function (idx) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'pnote';
      d.dataset.idx = idx;
      var c = CHROMA[idx];
      var main = State.label === 'solfege' ? c.sf : (State.label === 'number' ? c.deg : labelFor(idx, ton));
      var meta = State.label === 'solfege' ? c.deg : (State.label === 'number' ? c.sf : '');
      d.innerHTML = '<span class="sf"></span>' + (meta ? '<span class="meta"></span>' : '');
      d.querySelector('.sf').textContent = main;
      if (meta) d.querySelector('.meta').textContent = meta;
      d.addEventListener('click', function () {
        var midi = previewNote(idx, ton);
        if (midi === null) return;
        d.classList.add('playing');
        setTimeout(function () { d.classList.remove('playing'); }, 620 * State.tempo);
      });
      bar.appendChild(d);
    });
  }

  function answer(idx, el) {
    if (!Audio.ready) { $('status').textContent = '声音还没准备好，请稍等一下。'; return; }
    if (!State.running) { $('status').textContent = '请先点击「开始训练」。'; return; }
    if (State.answered) return;

    var fb = $('feedback');

    if (idx === State.targetOffset) {
      State.answered = true;
      State.firstTry += (State.wrongThisRound === 0) ? 1 : 0;
      recordStat(idx, true);
      State._streak = (State._streak || 0) + 1;
      $('streakInfo').textContent = '连对 ' + State._streak;
      var cells = document.querySelectorAll('#grid .deg');
      cells.forEach(function (c) { c.classList.remove('wrong'); c.classList.remove('playing'); });
      el.classList.add('correct');
      fb.className = 'feedback good';
      playDescending(function () {
        if (State.round >= TOTAL_ROUNDS) finishSession();
        else setTimeout(startRound, 600);
      });
    } else {
      State.wrongCount++;
      State.wrongThisRound++;
      State._streak = 0;
      $('streakInfo').textContent = '连对 0';
      recordStat(idx, false);
      document.querySelectorAll('#grid .deg').forEach(function (c) { c.classList.remove('wrong'); });
      el.classList.add('wrong');
      fb.className = 'feedback bad';
      fb.textContent = '✗ 不对。再听一遍，继续选择（本题已错 ' + State.wrongThisRound + ' 次）。';
    }
    renderStats();
  }

  function finishSession() {
    State.running = false;
    State.finished = true;
    stopTimeline();
    var first = State.firstTry;
    var retry = TOTAL_ROUNDS - first;
    var pct = Math.round(100 * first / TOTAL_ROUNDS);
    $('pie').style.background =
      'conic-gradient(var(--good) 0% ' + pct + '%, var(--bad) ' + pct + '% 100%)';
    $('piePct').textContent = pct + '%';
    $('statFirst').textContent = first;
    $('statRetry').textContent = retry;
    $('statWrong').textContent = State.wrongCount;
    $('statPct').textContent = pct + '%';
    $('statDiff').textContent = '第 ' + State.difficulty + ' 档：' + poolNames();
    $('summary').classList.remove('hidden');
    var fb = $('feedback');
    fb.className = 'feedback';
    fb.textContent = '这组 ' + TOTAL_ROUNDS + ' 题练完了。' + first + ' 题一次答对，' + retry + ' 题重试后才答对。';
    renderProgress();
    updatePlayBtn();
  }

  // ============ Tab 2: 旋律听写 ============
  function renderDictGrid() {
    var grid = $('dictGrid');
    grid.innerHTML = '';
    availableIndices().forEach(function (idx) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'deg';
      d.dataset.idx = idx;
      var c = CHROMA[idx];
      var main = State.label === 'solfege' ? c.sf : (State.label === 'number' ? c.deg : labelFor(idx));
      var meta = State.label === 'solfege' ? c.deg : (State.label === 'number' ? c.sf : '');
      d.innerHTML = '<span class="sf"></span>' + (meta ? '<span class="meta"></span>' : '');
      d.querySelector('.sf').textContent = main;
      if (meta) d.querySelector('.meta').textContent = meta;
      d.addEventListener('click', function () { dictAnswer(idx, d); });
      grid.appendChild(d);
    });
  }

  function renderDictSlots() {
    var box = $('dictSlots');
    box.innerHTML = '';
    if (!Dict.melody.length) {
      var hint = document.createElement('div');
      hint.className = 'kv';
      hint.textContent = '按下「开始听写」，这里会显示每句有几个音。';
      box.appendChild(hint);
      return;
    }
    for (var i = 0; i < Dict.melody.length; i++) {
      var s = document.createElement('div');
      s.className = 'slot';
      if (i < Dict.pos) {
        var ok = Dict.melody[i] === Dict.entered[i];
        s.className += ' filled ' + (ok ? 'ok' : 'no');
      } else if (i === Dict.pos && Dict.running) {
        s.className += ' active';
      }
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = (i < Dict.pos && Dict.entered)
        ? (State.label === 'solfege' ? CHROMA[Dict.entered[i]].sf
          : (State.label === 'number' ? CHROMA[Dict.entered[i]].deg : labelFor(Dict.entered[i])))
        : (i === Dict.pos && Dict.listening ? '♪' : '·');
      var meta = document.createElement('span');
      meta.className = 'i';
      meta.textContent = '第' + (i + 1) + '个';
      s.appendChild(n); s.appendChild(meta);
      box.appendChild(s);
    }
  }

  function renderDictProgress() {
    var info = $('dictProgress');
    var dots = $('dictDots');
    dots.innerHTML = '';
    for (var i = 1; i <= Dict.total; i++) {
      var d = document.createElement('i');
      if (i < Dict.round || (Dict.finished && i <= Dict.round)) d.className = 'done';
      if (Dict.running && i === Dict.round) d.className = 'cur';
      dots.appendChild(d);
    }
    if (!Dict.started) info.textContent = '未开始';
    else if (Dict.finished) info.textContent = Dict.round + ' / ' + Dict.total + ' 已练完';
    else info.textContent = Dict.round + ' / ' + Dict.total;
  }

  function updateDictBtn() {
    var b = $('dictStart');
    if (Dict.running) { b.disabled = true; b.textContent = '听写中'; }
    else if (Dict.finished) { b.disabled = false; b.textContent = '再来一组'; }
    else if (Dict.started) { b.disabled = false; b.textContent = '重新开始'; }
    else { b.disabled = false; b.textContent = '开始听写'; }
    $('dictReplay').disabled = !Dict.running;
    $('dictHint').disabled = !Dict.running;
  }

  function genMelody() {
    // 允许相邻出现相同音符（真随机），音池至少 2 个音，长度必能填满
    var pool = availableIndices();
    var m = [];
    for (var k = 0; k < Dict.len; k++) {
      m.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return m;
  }

  function dictTimeline(T, unit) {
    var cad = cadenceTimeline(T, unit, unit * 1.25);
    var noteDur = 620 * State.tempo;
    // 和弦与旋律之间留足分隔，避免听感上把和弦尾音误数进旋律
    var startAt = cad.endAt + CADENCE_TO_TARGET_DELAY + 900;
    var list = cad.list.slice();
    var marks = [];
    Dict.melody.forEach(function (off, i) {
      var at = startAt + i * noteDur * 1.25;
      marks.push({ at: at, off: off });
      list.push({ at: at, midis: [fitRange(T + off)], dur: noteDur, vel: 92 });
    });
    return { list: list, marks: marks, endAt: startAt + (Dict.melody.length - 1) * noteDur * 1.25 + noteDur };
  }

  function playDictSequence(token) {
    if (!Audio.ready) return;
    Audio.resume();
    var T = State.tonic;
    var unit = 440 * State.tempo;
    var tl = dictTimeline(T, unit);
    var hiTimer = null;
    var lastHiIdx = -2;
    var cells = document.querySelectorAll('#dictSlots .slot');

    function clearHi() {
      cells.forEach(function (c) { c.classList.remove('playing'); });
    }
    // 高亮与发声共用同一条时间轴，按绝对时刻推进，杜绝累积漂移
    function hiSchedule() {
      if (token !== playToken) { hiTimer = null; return; }
      var now = nowMs() - tl.base;
      var idx = -1;
      for (var i = 0; i < tl.marks.length; i++) {
        if (tl.marks[i].at <= now) idx = i; else break;
      }
      clearHi();
      if (idx >= 0 && cells[idx]) cells[idx].classList.add('playing');
      if (idx < tl.marks.length - 1) {
        var nextAt = tl.marks[idx + 1].at;
        hiTimer = setTimeout(hiSchedule, Math.max(4, Math.min(nextAt - now, 120)));
      } else {
        hiTimer = null;
      }
      // 同步刷新槽位，使当前播放位置显示音符标记
      if (lastHiIdx !== idx) {
        lastHiIdx = idx;
        renderDictSlots();
        cells = document.querySelectorAll('#dictSlots .slot');
        if (idx >= 0 && cells[idx]) cells[idx].classList.add('playing');
      }
    }
    function done() {
      if (token !== playToken) return;
      if (hiTimer) { clearTimeout(hiTimer); hiTimer = null; }
      clearHi();
      renderDictSlots();
      var fb = $('dictFeedback');
      fb.className = 'feedback info';
      fb.textContent = '现在按顺序点出你听到的 ' + Dict.melody.length + ' 个音。';
      Dict.listening = false;
    }
    Dict.listening = true;
    var fb = $('dictFeedback');
    fb.className = 'feedback info';
    fb.textContent = '正在播放 ' + Dict.melody.length + ' 个音的旋律，听完再作答...';
    // 先启动发声时间轴以确定基准时刻，再让高亮复用同一基准
    runTimeline(tl.list, token, done);
    tl.base = timelineBase;
    hiSchedule();
  }

  function startDict() {
    var begin = function () {
      Dict.started = true;
      Dict.running = true;
      Dict.finished = false;
      Dict.round = 0;
      Dict.firstTryNotes = 0;
      Dict.totalNotes = 0;
      Dict.hintUsed = 0;
      Dict._streak = 0;
      Dict.len = +$('dictLen').value;
      Dict.total = +$('dictRounds').value;
      $('dictSummary').classList.add('hidden');
      $('dictStreak').textContent = '';
      nextDictRound();
    };
    if (Audio.ready) { begin(); return; }
    Audio.init().then(begin).catch(function (e) {
      $('status').className = 'status err';
      $('status').textContent = '初始化失败：' + e.message;
    });
  }

  function nextDictRound() {
    Dict.round++;
    Dict.pos = 0;
    Dict.entered = [];
    Dict.melody = genMelody();
    Dict.mistakesThisNote = 0;
    Dict.tonic = pickTonic();
    $('dictKeyInfo').textContent = keyInfoText();
    renderDictSlots();
    renderDictProgress();
    updateDictBtn();
    playDictSequence(++playToken);
  }

  function dictAnswer(idx, el) {
    if (!Dict.running) { $('status').textContent = '请先点击「开始听写」。'; return; }
    if (Dict.listening) return;
    if (Dict.pos >= Dict.melody.length) return;

    var want = Dict.melody[Dict.pos];
    var fb = $('dictFeedback');

    if (idx === want) {
      Dict.entered[Dict.pos] = idx;
      if (Dict.mistakesThisNote === 0) {
        Dict.firstTryNotes++;
        Dict._streak++;
        $('dictStreak').textContent = '连对 ' + Dict._streak;
      }
      Dict.totalNotes++;
      Dict.pos++;
      Dict.mistakesThisNote = 0;
      renderDictSlots();

      if (Dict.pos >= Dict.melody.length) {
        // 答对后不回放，稍作停顿直接进入下一句
        fb.className = 'feedback good';
        fb.textContent = '整句写对了。';
        setTimeout(function () {
          if (Dict.round >= Dict.total) finishDict();
          else nextDictRound();
        }, 400);
      } else {
        fb.className = 'feedback info';
        fb.textContent = '第 ' + Dict.pos + ' 个对了，继续。';
      }
    } else {
      Dict.mistakesThisNote++;
      Dict._streak = 0;
      $('dictStreak').textContent = '连对 0';
      el.classList.add('wrong');
      fb.className = 'feedback bad';
      fb.textContent = '✗ 这个不对，再听听看（第 ' + (Dict.pos + 1) + ' 个音）。';
      setTimeout(function () { el.classList.remove('wrong'); }, 400);
    }
  }

  function dictHint() {
    if (!Dict.running || Dict.listening) return;
    if (Dict.pos >= Dict.melody.length) return;
    var want = Dict.melody[Dict.pos];
    Dict.hintUsed++;
    if (Dict.mistakesThisNote === 0) Dict._streak = 0;
    Dict.entered[Dict.pos] = want;
    Dict.totalNotes++;
    Dict.pos++;
    Dict.mistakesThisNote = 0;
    renderDictSlots();
    var fb = $('dictFeedback');
    fb.className = 'feedback info';
    fb.textContent = '已填入第 ' + Dict.pos + ' 个音，继续。';
    if (Dict.pos >= Dict.melody.length) {
      setTimeout(function () {
        if (Dict.round >= Dict.total) finishDict();
        else nextDictRound();
      }, 700);
    }
  }

  function replayDict() {
    if (!Dict.running) return;
    Dict.pos = 0;
    Dict.entered = [];
    Dict.mistakesThisNote = 0;
    renderDictSlots();
    playDictSequence(++playToken);
  }

  function finishDict() {
    Dict.running = false;
    Dict.finished = true;
    stopTimeline();
    var pct = Dict.totalNotes ? Math.round(100 * Dict.firstTryNotes / Dict.totalNotes) : 0;
    $('dictPie').style.background =
      'conic-gradient(var(--good) 0% ' + pct + '%, var(--bad) ' + pct + '% 100%)';
    $('dictPiePct').textContent = pct + '%';
    $('dictStatNotes').textContent = Dict.firstTryNotes;
    $('dictStatTotal').textContent = Dict.totalNotes;
    $('dictStatHint').textContent = Dict.hintUsed;
    $('dictStatPct').textContent = pct + '%';
    $('dictStatCfg').textContent = Dict.total + ' 句 x ' + Dict.len + ' 音，第 ' + State.difficulty + ' 档';
    $('dictSummary').classList.remove('hidden');
    var fb = $('dictFeedback');
    fb.className = 'feedback';
    fb.textContent = '这组听写练完了。' + Dict.firstTryNotes + ' 个音一次听对，共 ' + Dict.totalNotes + ' 个。';
    renderDictProgress();
    updateDictBtn();
  }

  // ============ Tab 3: 聆听模式 ============
  function requestWakeLock() {
    if (!Lis.keepAwake || !navigator.wakeLock || !Lis.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (w) {
      Lis._wakeLock = w;
      w.addEventListener('release', function () { Lis._wakeLock = null; });
    }).catch(function () { Lis._wakeLock = null; });
  }
  function releaseWakeLock() {
    if (Lis._wakeLock) {
      try { Lis._wakeLock.release(); } catch (e) {}
      Lis._wakeLock = null;
    }
  }

  function lisUpdateCounters() {
    $('lisCount').textContent = Lis.count;
    $('lisRound').textContent = Lis.round;
    $('lisProgress').textContent = Lis.running ? ('第 ' + Lis.round + ' 轮') : (Lis.count ? ('已听 ' + Lis.count + ' 轮') : '未开始');
  }

  function lisSetStage(phase, note, meta, cls) {
    $('lisPhase').textContent = phase;
    var n = $('lisNote');
    n.textContent = note;
    n.className = 'note' + (cls ? ' ' + cls : '');
    $('lisMeta').textContent = meta;
  }

  function lisStop(silent) {
    Lis.running = false;
    if (Lis._timer) { clearTimeout(Lis._timer); Lis._timer = null; }
    stopTimeline();
    $('lisStart').disabled = false;
    $('lisStop').disabled = true;
    releaseWakeLock();
    if (!silent) {
      lisSetStage('已停止', '已停止', '一共听了 ' + Lis.count + ' 轮', 'dim');
      lisUpdateCounters();
    }
  }

  function lisRound() {
    if (!Lis.running) return;
    Lis.round++;
    var T = pickTonic();
    var pool = availableIndices();
    var target = pool[Math.floor(Math.random() * pool.length)];
    var unit = 440 * State.tempo;
    var dur = unit * 1.25;

    var cad = cadenceTimeline(T, unit, dur);
    var list = cad.list.slice();
    var noteDur = 700 * State.tempo;
    var startAt = cad.endAt + 500;
    var marks = [];
    for (var r = 0; r < Lis.repeat; r++) {
      var at = startAt + r * (noteDur + 380);
      marks.push(at);
      list.push({ at: at, midis: [fitRange(T + target)], dur: noteDur, vel: 95 });
    }
    var lastAt = marks[marks.length - 1] + noteDur;
    list.push({ at: lastAt + 400, midis: [fitRange(T + target)], dur: noteDur, vel: 80 });

    var my = ++playToken;
    lisSetStage('第 ' + Lis.round + ' 轮', '听调子', '先听和弦，记住这是哪个调', 'dim');

    runTimeline(list, my, function () {
      if (my !== playToken || !Lis.running) return;
      lisSetStage('第 ' + Lis.round + ' 轮 完成', CHROMA[target].sf,
        '这是第 ' + CHROMA[target].deg + ' 级 · ' + keyInfoText(), 'good');
      Lis.count++;
      lisUpdateCounters();
      Lis._timer = setTimeout(function () {
        if (!Lis.running) return;
        lisRound();
      }, Lis.gap);
    });
  }

  function lisStart() {
    var begin = function () {
      Lis.running = true;
      Lis.count = 0;
      Lis.round = 0;
      Lis.gap = +$('lisGap').value;
      Lis.repeat = +$('lisRepeat').value;
      $('lisStart').disabled = true;
      $('lisStop').disabled = false;
      lisUpdateCounters();
      requestWakeLock();
      lisRound();
    };
    if (Audio.ready) { begin(); return; }
    Audio.init().then(begin).catch(function (e) {
      $('status').className = 'status err';
      $('status').textContent = '初始化失败：' + e.message;
    });
  }

  // ============ 控件绑定 ============
  function bindSeg(id, cb) {
    var seg = $(id);
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        cb(b.dataset.v);
      });
    });
  }

  function buildDifficultyButtons() {
    var seg = $('difficultySeg');
    seg.innerHTML = '';
    for (var d = 1; d <= maxDifficulty(); d++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'D' + d;
      b.dataset.v = d;
      b.title = '第 ' + d + ' 档：' + activeOrder().slice(0, d + 1)
        .map(function (i) { return CHROMA[i].sf; }).join(' ');
      if (d === State.difficulty) b.classList.add('on');
      b.addEventListener('click', function () {
        if (+this.dataset.v === State.difficulty) return;
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        this.classList.add('on');
        State.difficulty = +this.dataset.v;
        renderGrid(); renderDictGrid(); renderStats(); updateDiffHint();
        onSettingsChanged();
      });
      seg.appendChild(b);
    }
    updateDiffHint();
  }

  function updateDiffHint() {
    $('diffHint').textContent = '这一档会考 ' + availableIndices().length + ' 个音：' + poolNames();
  }

  // 设置变化后重开三个模式
  function onSettingsChanged() {
    // 音级听辨
    stopTimeline();
    State.started = false; State.running = false; State.finished = false;
    State.round = 0; State.firstTry = 0; State.wrongCount = 0; State.answered = false;
    $('summary').classList.add('hidden');
    $('streakInfo').textContent = '';
    renderProgress(); updatePlayBtn(); clearMarks();

    // 旋律听写
    Dict.started = false; Dict.running = false; Dict.finished = false;
    Dict.round = 0; Dict.melody = []; Dict.pos = 0; Dict.entered = [];
    $('dictSummary').classList.add('hidden');
    $('dictStreak').textContent = '';
    renderDictSlots(); renderDictProgress(); updateDictBtn();

    // 聆听模式
    lisStop(true);
    Lis.count = 0; Lis.round = 0;
    lisSetStage('设置已变', '设置已变', '按「开始聆听」重新开始', 'dim');
    lisUpdateCounters();

    var fb = $('feedback');
    fb.className = 'feedback';
    fb.textContent = '设置已更改，各模式都已重置，点开始重新练习。';
  }

  function switchTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tabpanel').forEach(function (p) {
      p.classList.toggle('hidden', p.dataset.panel !== name);
    });
    // 切换时停掉正在发声的那个模式，避免串音
    if (name !== 'listener' && Lis.running) lisStop(true);
    if (name !== 'dictation' && Dict.running) {
      stopTimeline();
      Dict.running = false;
      updateDictBtn();
    }
    if (name !== 'ear' && State.running) {
      stopTimeline();
      State.running = false;
      updatePlayBtn();
    }
  }

  function initUI() {
    // Tab 切换
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    bindSeg('scaleSeg', function (v) {
      State.scale = v; renderGrid(); renderDictGrid(); renderStats();
      $('keyInfo').textContent = keyInfoText();
      $('dictKeyInfo').textContent = keyInfoText();
      $('lisKeyInfo').textContent = keyInfoText();
      onSettingsChanged();
    });
    bindSeg('labelSeg', function (v) { State.label = v; renderGrid(); renderDictGrid(); renderStats(); });
    bindSeg('keyModeSeg', function (v) {
      State.fixedKey = (v === 'fixed');
      $('keyRoot').classList.toggle('hidden', !State.fixedKey);
      $('keyInfo').textContent = keyInfoText();
      $('dictKeyInfo').textContent = keyInfoText();
      $('lisKeyInfo').textContent = keyInfoText();
      renderPreviewBar();
      onSettingsChanged();
    });

    var kr = $('keyRoot');
    NOTE_NAMES.forEach(function (n, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = n; kr.appendChild(o);
    });
    kr.value = State.keyRoot;
    kr.addEventListener('change', function () {
      State.keyRoot = +kr.value;
      $('keyInfo').textContent = keyInfoText();
      $('dictKeyInfo').textContent = keyInfoText();
      $('lisKeyInfo').textContent = keyInfoText();
      renderPreviewBar();
      onSettingsChanged();
    });

    var sw = $('chromSwitch');
    sw.addEventListener('click', function () {
      State.chromatics = !State.chromatics;
      sw.classList.toggle('on', State.chromatics);
      if (State.difficulty > maxDifficulty()) State.difficulty = maxDifficulty();
      $('keyInfo').textContent = keyInfoText();
      $('dictKeyInfo').textContent = keyInfoText();
      $('lisKeyInfo').textContent = keyInfoText();
      renderGrid(); renderDictGrid(); renderStats(); buildDifficultyButtons();
      onSettingsChanged();
    });

    $('tempo').addEventListener('change', function (e) { State.tempo = +e.target.value; });
    $('interval').addEventListener('change', function (e) { State.interval = +e.target.value; });

    $('playBtn').addEventListener('click', function () { if (!State.running) startSession(); });
    $('replayBtn').addEventListener('click', replayTarget);
    $('replayNoteBtn').addEventListener('click', replayNoteOnly);
    $('resetStats').addEventListener('click', function () {
      var all = loadStats();
      delete all[statsKey()];
      saveStats(all);
      renderStats();
    });

    $('dictStart').addEventListener('click', function () { if (!Dict.running) startDict(); });
    $('dictReplay').addEventListener('click', replayDict);
    $('dictHint').addEventListener('click', dictHint);
    // 改每句长度或句数会改变题目结构，立即停掉当前练习让新设置生效
    function onDictCfgChange() {
      if (!Dict.started && !Dict.running && !Dict.finished) return;
      stopTimeline();
      Dict.started = false; Dict.running = false; Dict.finished = false;
      Dict.round = 0; Dict.melody = []; Dict.pos = 0; Dict.entered = [];
      $('dictSummary').classList.add('hidden');
      $('dictStreak').textContent = '';
      var fb = $('dictFeedback');
      fb.className = 'feedback';
      fb.textContent = '设置已更改，点「开始听写」重新开始。';
      renderDictSlots(); renderDictProgress(); updateDictBtn();
    }
    $('dictLen').addEventListener('change', onDictCfgChange);
    $('dictRounds').addEventListener('change', onDictCfgChange);

    $('lisStart').addEventListener('click', lisStart);
    $('lisStop').addEventListener('click', function () { lisStop(); });
    var ka = $('lisKeepAwake');
    ka.addEventListener('click', function () {
      Lis.keepAwake = !Lis.keepAwake;
      ka.classList.toggle('on', Lis.keepAwake);
      if (Lis.keepAwake && Lis.running) requestWakeLock();
      else releaseWakeLock();
    });
    $('lisGap').addEventListener('change', function (e) { Lis.gap = +e.target.value; });
    $('lisRepeat').addEventListener('change', function (e) { Lis.repeat = +e.target.value; });

    buildDifficultyButtons();
    renderGrid(); renderDictGrid(); renderDictSlots();
    renderStats(); renderProgress(); updatePlayBtn();
    renderDictProgress(); updateDictBtn(); lisUpdateCounters();
  }

  // ---------- 启动 ----------
  window.addEventListener('DOMContentLoaded', function () {
    initUI();
    $('keyInfo').textContent = keyInfoText();
    $('dictKeyInfo').textContent = keyInfoText();
    $('lisKeyInfo').textContent = keyInfoText();
    // 进入网页即自动准备声音（遮罩显示加载进度），完成后遮罩自动消失
    Audio.init();
    // 注册 Service Worker：音色文件首次加载后永久缓存，刷新不再重新下载
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  });
})();
