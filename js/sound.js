'use strict';

/* =========================================================
   Звук — всё синтезируется через Web Audio, без внешних файлов
   ========================================================= */
const SFX = (() => {
  let ac = null, master = null, nb = null;
  let enabled = localStorage.getItem('bk_sound') !== '0';
  let roll = null;

  function init() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.34;
    master.connect(ac.destination);
    // буфер белого шума на 2 секунды
    const len = ac.sampleRate * 2;
    nb = ac.createBuffer(1, len, ac.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function resume() { init(); if (ac && ac.state === 'suspended') ac.resume(); }
  const t = () => ac.currentTime;

  /* тон с огибающей и опциональным глиссандо */
  function tone(o = {}) {
    if (!enabled) return;
    init(); if (!ac) return;
    const {
      f = 440, to = null, dur = 0.25, type = 'sine',
      vol = 0.3, at = 0.008, dl = 0, detune = 0
    } = o;
    const t0 = t() + dl;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /* шумовой всплеск через фильтр */
  function noise(o = {}) {
    if (!enabled) return;
    init(); if (!ac) return;
    const { dur = 0.3, vol = 0.3, f = 1200, to = null, type = 'lowpass', dl = 0, q = 1 } = o;
    const t0 = t() + dl;
    const src = ac.createBufferSource(); src.buffer = nb;
    const flt = ac.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t0);
    if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  function chord(freqs, o = {}) { freqs.forEach((f, i) => tone({ f, dl: (o.stagger || 0) * i, ...o })); }

  const API = {
    get on() { return enabled; },
    toggle() {
      enabled = !enabled;
      localStorage.setItem('bk_sound', enabled ? '1' : '0');
      if (enabled) { resume(); API.click(); } else API.rollStop();
      return enabled;
    },
    resume,

    click()  { tone({ f: 620, to: 880, dur: 0.06, type: 'square', vol: 0.10 }); },
    hover()  { tone({ f: 900, dur: 0.03, type: 'sine', vol: 0.05 }); },
    select() { tone({ f: 520, to: 1040, dur: 0.14, type: 'triangle', vol: 0.16 }); },
    deny()   { tone({ f: 220, to: 120, dur: 0.18, type: 'sawtooth', vol: 0.14 }); },

    lock()   { tone({ f: 1200, dur: 0.05, type: 'square', vol: 0.12 });
               tone({ f: 1800, dur: 0.05, type: 'square', vol: 0.08, dl: 0.05 }); },

    place()  { noise({ dur: 0.16, vol: 0.3, f: 2600, to: 300 });
               tone({ f: 180, to: 90, dur: 0.2, type: 'sine', vol: 0.22 }); },

    throwBall() {
      noise({ dur: 0.35, vol: 0.28, f: 400, to: 3000, type: 'bandpass', q: 2 });
      tone({ f: 160, to: 520, dur: 0.3, type: 'sawtooth', vol: 0.16 });
    },

    rollStart() {
      if (!enabled) return;
      init(); if (!ac || roll) return;
      const src = ac.createBufferSource(); src.buffer = nb; src.loop = true;
      const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 700;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(master);
      src.start();
      roll = { src, g, flt };
    },
    rollSet(v) { if (roll) { roll.g.gain.value = Math.min(0.18, v * 0.02); roll.flt.frequency.value = 300 + v * 90; } },
    rollStop() {
      if (!roll) return;
      try { roll.g.gain.setTargetAtTime(0, ac.currentTime, 0.03); roll.src.stop(ac.currentTime + 0.2); } catch (e) {}
      roll = null;
    },

    bounce() { tone({ f: 300, to: 140, dur: 0.09, type: 'triangle', vol: 0.12 });
               noise({ dur: 0.06, vol: 0.12, f: 1800, to: 500 }); },

    open()   { chord([523, 784, 1046], { dur: 0.5, type: 'triangle', vol: 0.16, stagger: 0.06 });
               noise({ dur: 0.45, vol: 0.16, f: 600, to: 4500, type: 'bandpass', q: 1.5 }); },

    miss()   { tone({ f: 420, to: 130, dur: 0.5, type: 'sawtooth', vol: 0.16 });
               noise({ dur: 0.3, vol: 0.12, f: 900, to: 200 }); },

    battle() {
      tone({ f: 110, to: 55, dur: 1.0, type: 'sawtooth', vol: 0.26 });
      chord([146.8, 220, 293.7], { dur: 0.7, type: 'square', vol: 0.09 });
      noise({ dur: 0.7, vol: 0.22, f: 200, to: 60 });
    },

    ability() {
      tone({ f: 880, to: 1760, dur: 0.22, type: 'triangle', vol: 0.2 });
      tone({ f: 1320, to: 2640, dur: 0.22, type: 'sine', vol: 0.1, dl: 0.05 });
      noise({ dur: 0.3, vol: 0.12, f: 3000, to: 800, type: 'bandpass', q: 3 });
    },

    charge() { tone({ f: 120, to: 900, dur: 0.85, type: 'sawtooth', vol: 0.14 }); },

    clash() {
      noise({ dur: 0.9, vol: 0.42, f: 5000, to: 60 });
      tone({ f: 90, to: 35, dur: 0.9, type: 'sine', vol: 0.32 });
      tone({ f: 240, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.18 });
      chord([392, 523, 659], { dur: 0.35, type: 'square', vol: 0.08, dl: 0.03 });
    },

    /* --- бой --- */
    lunge()  { noise({ dur: 0.45, vol: 0.3, f: 300, to: 2600, type: 'bandpass', q: 1.6 });
               tone({ f: 90, to: 300, dur: 0.4, type: 'sawtooth', vol: 0.16 }); },
    slash()  { noise({ dur: 0.22, vol: 0.34, f: 6000, to: 900, type: 'bandpass', q: 0.9 });
               tone({ f: 1600, to: 400, dur: 0.18, type: 'square', vol: 0.12 }); },
    guard()  { chord([880, 1320, 1760], { dur: 0.5, type: 'triangle', vol: 0.13, stagger: 0.015 });
               noise({ dur: 0.3, vol: 0.16, f: 3200, to: 1200, type: 'bandpass', q: 4 }); },
    shatter(){ noise({ dur: 0.6, vol: 0.34, f: 7000, to: 500, type: 'highpass' });
               [1400, 1100, 900, 700].forEach((f, i) =>
                 tone({ f, to: f * 0.6, dur: 0.25, type: 'triangle', vol: 0.1, dl: i * 0.045 })); },
    counter(){ tone({ f: 200, to: 900, dur: 0.35, type: 'sawtooth', vol: 0.2 });
               noise({ dur: 0.3, vol: 0.2, f: 800, to: 4000, type: 'bandpass', q: 2 }); },
    thud()   { tone({ f: 120, to: 40, dur: 0.5, type: 'sine', vol: 0.3 });
               noise({ dur: 0.35, vol: 0.24, f: 1200, to: 90 }); },
    search() { tone({ f: 660, to: 880, dur: 0.12, type: 'sine', vol: 0.1 });
               tone({ f: 880, dur: 0.1, type: 'sine', vol: 0.07, dl: 0.14 }); },
    found()  { [523, 784, 1046, 1318].forEach((f, i) =>
                 tone({ f, dur: 0.45, type: 'triangle', vol: 0.2, dl: i * 0.09 })); },

    tick()   { tone({ f: 1400, dur: 0.035, type: 'square', vol: 0.06 }); },
    count()  { tone({ f: 700, dur: 0.04, type: 'sine', vol: 0.05 }); },

    win()    { [523, 659, 784, 1046].forEach((f, i) =>
                 tone({ f, dur: 0.5, type: 'triangle', vol: 0.22, dl: i * 0.11 })); },
    lose()   { [392, 349, 294, 233].forEach((f, i) =>
                 tone({ f, dur: 0.55, type: 'sawtooth', vol: 0.16, dl: i * 0.14 })); },

    victory() { [523, 659, 784, 1046, 1318].forEach((f, i) =>
                  tone({ f, dur: 0.8, type: 'triangle', vol: 0.24, dl: i * 0.13 }));
                noise({ dur: 1.2, vol: 0.12, f: 400, to: 6000, type: 'bandpass', q: 1, dl: 0.5 }); },
    defeat()  { [330, 294, 262, 196].forEach((f, i) =>
                  tone({ f, dur: 1.0, type: 'sawtooth', vol: 0.2, dl: i * 0.22 })); }
  };

  // разблокировка звука по первому действию пользователя
  ['pointerdown', 'keydown'].forEach(ev =>
    window.addEventListener(ev, () => resume(), { once: true }));

  return API;
})();
