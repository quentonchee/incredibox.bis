/**
 * audio.js v3 — Incredibox Clone Audio Engine
 * ─────────────────────────────────────────────
 * • All drum hits pre-rendered via OfflineAudioContext (no real-time jitter)
 * • Melodic content pre-rendered as full 2-bar loops → perfect looping
 * • 16-step sequencer for drums (per-step accuracy)
 * • All loops quantized to bar boundaries
 * • Key: A natural minor | BPM: 110 default
 */

window.AudioEngine = (function () {
  'use strict';

  // ─── Context & routing ────────────────────────────────────────────────────────
  let ctx        = null;
  let masterGain = null;
  let analyser   = null;

  // ─── Tempo ────────────────────────────────────────────────────────────────────
  let BPM          = 110;
  let ORIGIN_BPM   = 110;          // BPM used during pre-render
  const STEPS      = 16;           // 16th-note steps per bar (1 bar)

  function beatLen()  { return 60 / BPM; }
  function stepLen()  { return beatLen() / 4; }
  function barLen()   { return beatLen() * 4; }
  function loopLen()  { return barLen() * 2; }   // 2-bar pre-rendered loops

  // ─── Pre-rendered buffers ─────────────────────────────────────────────────────
  const BUF = {};           // { id: AudioBuffer }
  let   buffersReady = false;

  // ─── Active state ─────────────────────────────────────────────────────────────
  // drums  → activeLoops[id] = true
  // loops  → activeLoops[id] = { src, gain }
  const activeLoops = {};

  // ─── Step scheduler ───────────────────────────────────────────────────────────
  let schedulerTimer = null;
  let nextStepTime   = 0;
  let currentStep    = 0;

  // ─── Musical note table (Hz) ──────────────────────────────────────────────────
  const N = {
    E1:41.20, A1:55.00, C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98.00,
    A2:110,   B2:123.47,C3:130.81,D3:146.83,E3:164.81,F3:174.61,G3:196,
    A3:220,   B3:246.94,C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392,
    A4:440,   B4:493.88,C5:523.25,D5:587.33,E5:659.25,G5:783.99,A5:880
  };

  // ─── Sound catalogue ──────────────────────────────────────────────────────────
  // mode: 'drum'  → scheduled per 16th-note pattern (1 bar = 16 steps)
  // mode: 'loop'  → looping AudioBufferSourceNode (2 bars)
  // label used everywhere in game.js as the identifier

  const SOUNDS = {
    // ── BEATS ──────────────────────────────────────────────────────────────────
    kick: {
      id:'kick', type:'beats', label:'Kick', emoji:'🥁', mode:'drum',
      // Hip-hop kick: downbeat + syncopated ghost
      pattern:[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0]
    },
    snare: {
      id:'snare', type:'beats', label:'Snare', emoji:'🪘', mode:'drum',
      pattern:[0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]
    },
    hihat: {
      id:'hihat', type:'beats', label:'Hi-Hat', emoji:'〰️', mode:'drum',
      pattern:[1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1]
    },
    clap: {
      id:'clap', type:'beats', label:'Clap', emoji:'👏', mode:'drum',
      pattern:[0,0,1,0, 1,0,0,1, 0,0,1,0, 1,0,0,0]
    },

    // ── BASS ───────────────────────────────────────────────────────────────────
    bassGroove: {
      id:'bassGroove', type:'bass', label:'Bass Groove', emoji:'🎸', mode:'loop',
      gain: 0.9
    },
    sub808: {
      id:'sub808', type:'bass', label:'808 Sub', emoji:'🔉', mode:'loop',
      gain: 1.0
    },
    bassLead: {
      id:'bassLead', type:'bass', label:'Bass Lead', emoji:'🎚️', mode:'loop',
      gain: 0.85
    },

    // ── MELODY ─────────────────────────────────────────────────────────────────
    lead: {
      id:'lead', type:'melody', label:'Lead', emoji:'🎹', mode:'loop',
      gain: 0.75
    },
    arp: {
      id:'arp', type:'melody', label:'Arpège', emoji:'✨', mode:'loop',
      gain: 0.7
    },
    bells: {
      id:'bells', type:'melody', label:'Bells', emoji:'🔔', mode:'loop',
      gain: 0.65
    },

    // ── FX ─────────────────────────────────────────────────────────────────────
    scratch: {
      id:'scratch', type:'fx', label:'Scratch', emoji:'💿', mode:'loop',
      gain: 0.7
    },
    glitch: {
      id:'glitch', type:'fx', label:'Glitch', emoji:'⚡', mode:'loop',
      gain: 0.6
    },
    riser: {
      id:'riser', type:'fx', label:'Riser', emoji:'🌊', mode:'loop',
      gain: 0.55
    },

    // ── CHORUS ─────────────────────────────────────────────────────────────────
    beatbox: {
      id:'beatbox', type:'chorus', label:'Beatbox', emoji:'🎤', mode:'loop',
      gain: 0.8
    },
    choir: {
      id:'choir', type:'chorus', label:'Choir', emoji:'🎶', mode:'loop',
      gain: 0.7
    },
    hum: {
      id:'hum', type:'chorus', label:'Hum', emoji:'🎼', mode:'loop',
      gain: 0.72
    }
  };

  // ─── Public init ──────────────────────────────────────────────────────────────
  async function init(readyCb) {
    if (ctx) { if (readyCb) readyCb(); return; }

    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });

    // Routing: master → compressor → analyser → out
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.75;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value      = 10;
    comp.ratio.value     = 5;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.18;

    analyser = ctx.createAnalyser();
    analyser.fftSize              = 512;
    analyser.smoothingTimeConstant = 0.82;

    masterGain.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    // Pre-render everything
    await preRenderAll();
    buffersReady = true;

    schedulerStart();
    if (readyCb) readyCb();
  }

  // ─── Pre-rendering ─────────────────────────────────────────────────────────────
  async function preRenderAll() {
    const SR  = 44100;
    const dur = loopLen(); // 2 bars in seconds (at current BPM)

    // Drum one-shots
    BUF.kick  = await mkKick(SR);
    BUF.snare = await mkSnare(SR);
    BUF.hihat = await mkHihat(SR);
    BUF.clap  = await mkClap(SR);

    // Musical loops (alphabetical to avoid dependency issues)
    BUF.arp        = await mkArp(SR, dur);
    BUF.bassGroove = await mkBassGroove(SR, dur);
    BUF.bassLead   = await mkBassLead(SR, dur);
    BUF.beatbox    = await mkBeatbox(SR, dur);
    BUF.bells      = await mkBells(SR, dur);
    BUF.choir      = await mkChoir(SR, dur);
    BUF.glitch     = await mkGlitch(SR, dur);
    BUF.hum        = await mkHum(SR, dur);
    BUF.lead       = await mkLead(SR, dur);
    BUF.riser      = await mkRiser(SR, dur);
    BUF.scratch    = await mkScratch(SR, dur);
    BUF.sub808     = await mkSub808(SR, dur);
  }

  // ─── Drum synthesis ────────────────────────────────────────────────────────────

  async function mkKick(SR) {
    const dur = 0.65;
    const off = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);

    // Body: sine sweep 160 → 42 Hz
    const osc = off.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, 0);
    osc.frequency.exponentialRampToValueAtTime(42, 0.45);

    // Distortion waveshaper for punch
    const ws = off.createWaveShaper();
    const n  = 256;
    const cv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (2 * i / n) - 1;
      cv[i] = (Math.PI + 180) * x / (Math.PI + 180 * Math.abs(x));
    }
    ws.curve = cv;

    const bodyGain = off.createGain();
    bodyGain.gain.setValueAtTime(1.4, 0);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, 0.62);

    // Click transient (short noise burst)
    const cLen = Math.ceil(SR * 0.007);
    const cBuf = off.createBuffer(1, cLen, SR);
    const cDat = cBuf.getChannelData(0);
    for (let i = 0; i < cLen; i++) cDat[i] = (1 - i / cLen) * (Math.random() * 2 - 1);
    const click     = off.createBufferSource();
    click.buffer    = cBuf;
    const clickGain = off.createGain();
    clickGain.gain.value = 0.85;
    const clickHp   = off.createBiquadFilter();
    clickHp.type    = 'highpass';
    clickHp.frequency.value = 900;

    osc.connect(ws); ws.connect(bodyGain); bodyGain.connect(off.destination);
    click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(off.destination);

    osc.start(0); osc.stop(dur);
    click.start(0); click.stop(0.008);

    return off.startRendering();
  }

  async function mkSnare(SR) {
    const dur = 0.24;
    const off = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);

    // Noise body
    const nBuf = off.createBuffer(1, Math.ceil(SR * dur), SR);
    const nDat = nBuf.getChannelData(0);
    for (let i = 0; i < nDat.length; i++) nDat[i] = Math.random() * 2 - 1;
    const noise = off.createBufferSource();
    noise.buffer = nBuf;
    const nbp    = off.createBiquadFilter();
    nbp.type     = 'bandpass';
    nbp.frequency.value = 5500;
    nbp.Q.value  = 0.7;
    const nGain  = off.createGain();
    nGain.gain.setValueAtTime(1.1, 0);
    nGain.gain.exponentialRampToValueAtTime(0.001, 0.18);

    // Tone 1
    const t1 = off.createOscillator(); t1.type = 'sine'; t1.frequency.value = 193;
    const g1 = off.createGain();
    g1.gain.setValueAtTime(0.9, 0); g1.gain.exponentialRampToValueAtTime(0.001, 0.10);

    // Tone 2
    const t2 = off.createOscillator(); t2.type = 'sine'; t2.frequency.value = 318;
    const g2 = off.createGain();
    g2.gain.setValueAtTime(0.55, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.07);

    noise.connect(nbp); nbp.connect(nGain); nGain.connect(off.destination);
    t1.connect(g1); g1.connect(off.destination);
    t2.connect(g2); g2.connect(off.destination);

    noise.start(0); noise.stop(dur);
    t1.start(0); t1.stop(0.12);
    t2.start(0); t2.stop(0.09);

    return off.startRendering();
  }

  async function mkHihat(SR) {
    const dur = 0.056;
    const off = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);

    // 6 detuned square oscs → metallic ring (Chowning cymbal technique)
    const ratios = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21];
    const mix    = off.createGain(); mix.gain.value = 0.035;
    ratios.forEach(r => {
      const o = off.createOscillator(); o.type = 'square'; o.frequency.value = 40 * r;
      o.connect(mix); o.start(0); o.stop(dur);
    });

    const hp  = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const env = off.createGain();
    env.gain.setValueAtTime(1.0, 0);
    env.gain.exponentialRampToValueAtTime(0.001, 0.054);

    mix.connect(hp); hp.connect(env); env.connect(off.destination);
    return off.startRendering();
  }

  async function mkClap(SR) {
    const dur  = 0.22;
    const off  = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
    const bursts = 4;

    for (let b = 0; b < bursts; b++) {
      const t   = b * 0.013;
      const bDur = 0.045;
      const buf  = off.createBuffer(1, Math.ceil(SR * bDur), SR);
      const dat  = buf.getChannelData(0);
      for (let i = 0; i < dat.length; i++) dat[i] = Math.random() * 2 - 1;
      const src = off.createBufferSource(); src.buffer = buf;
      const bp  = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
      const g   = off.createGain();
      const amp = b === 0 ? 1.0 : 0.7 - b * 0.12;
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.connect(bp); bp.connect(g); g.connect(off.destination);
      src.start(t); src.stop(t + bDur);
    }
    return off.startRendering();
  }

  // ─── Loop synthesis helpers ───────────────────────────────────────────────────

  function mkOff(SR, dur) {
    return new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
  }

  function addNote(off, type, freq, t, d, filterFreq, filterQ, amp) {
    if (t >= off.length / off.sampleRate) return;
    const osc  = off.createOscillator();
    osc.type   = type;
    osc.frequency.value = freq;

    const f    = off.createBiquadFilter();
    f.type     = 'lowpass';
    f.frequency.setValueAtTime(filterFreq * 1.8, t);
    f.frequency.exponentialRampToValueAtTime(filterFreq * 0.4, t + d);
    f.Q.value  = filterQ;

    const g    = off.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.006);
    g.gain.setValueAtTime(amp * 0.85, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.02);

    osc.connect(f); f.connect(g); g.connect(off.destination);
    osc.start(t); osc.stop(t + d + 0.05);
  }

  // ─── Bass loops ───────────────────────────────────────────────────────────────

  async function mkBassGroove(SR, dur) {
    const off = mkOff(SR, dur);
    const s   = stepLen(); // 16th note

    // Funky Am groove (2 bars × 16 steps)
    const seq = [
      // Bar 1
      [0,  N.A2, 1.4],  [2,  N.A2, 0.8],  [3.5,N.C3, 1.0],
      [5,  N.D3, 0.8],  [6,  N.E3, 1.6],  [8,  N.G2, 1.4],
      [9.5,N.A2, 0.8],  [11, N.C3, 0.9],  [12, N.D3, 0.8],
      [13, N.E3, 0.8],  [14, N.D3, 0.6],
      // Bar 2
      [16, N.A2, 1.4],  [18, N.A2, 0.8],  [19, N.E3, 1.2],
      [21, N.D3, 0.8],  [22, N.C3, 1.6],  [24, N.A2, 1.2],
      [25.5,N.G2,0.8],  [27, N.E2, 1.0],  [28, N.A2, 0.8],
      [29, N.C3, 0.9],  [30, N.D3, 0.8],  [31, N.E3, 0.5],
    ];
    seq.forEach(([step, freq, beatLen_]) => addNote(off, 'sawtooth', freq, step*s, beatLen_*s*0.9, 700, 3.5, 0.75));
    return off.startRendering();
  }

  async function mkSub808(SR, dur) {
    const off = mkOff(SR, dur);
    const b   = beatLen();

    // Sustained 808 notes — Am pedal with movement
    const seq = [
      [0,   N.A1, b*1.8],  [b*2,  N.G2, b*0.9],  [b*3,  N.E2, b*0.9],
      [b*4, N.A1, b*1.8],  [b*6,  N.C2||N.C3, b*0.9], [b*7, N.E2, b*0.9],
    ];
    seq.forEach(([t, freq, d]) => {
      if (t >= dur) return;
      const osc = off.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 1.04, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.025);
      const g = off.createGain();
      g.gain.setValueAtTime(1.1, t);
      g.gain.setValueAtTime(0.9, t + d - 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.connect(g); g.connect(off.destination);
      osc.start(t); osc.stop(t + d + 0.05);
    });
    return off.startRendering();
  }

  async function mkBassLead(SR, dur) {
    const off = mkOff(SR, dur);
    const s   = stepLen();

    // Lead bass: triangle + filter
    const seq = [
      [0,  N.A2,1.8], [2,  N.A2,0.8], [3,  N.C3,1.2], [5,  N.D3,0.8],
      [6,  N.E3,2.0], [9,  N.D3,0.9], [10, N.C3,0.9], [11, N.A2,1.5],
      [13, N.G2,0.9], [14, N.A2,1.8],
      [16, N.A2,1.8], [18, N.A2,0.8], [20, N.E3,0.9], [21, N.D3,0.9],
      [22, N.C3,2.0], [25, N.A2,0.9], [26, N.G2,0.9], [27, N.E2,2.0],
      [30, N.A2,1.8],
    ];
    seq.forEach(([step, freq, bl]) => addNote(off, 'triangle', freq, step*s, bl*s*0.9, 1100, 2.5, 0.82));
    return off.startRendering();
  }

  // ─── Melody loops ─────────────────────────────────────────────────────────────

  async function mkLead(SR, dur) {
    const off = mkOff(SR, dur);
    const s   = stepLen();

    // Supersaw lead — Am pentatonic melody over 2 bars
    const mel = [
      [0,  N.E4, 2],  [2,  N.D4, 1],  [3,  N.C4, 1],  [4,  N.A3, 3],
      [8,  N.C4, 1],  [9,  N.D4, 1],  [10, N.E4, 1],  [11, N.G4, 4],
      [16, N.A4, 2],  [18, N.G4, 1],  [19, N.E4, 1],  [20, N.D4, 3],
      [24, N.C4, 2],  [26, N.A3, 2],  [29, N.E4, 3],
    ];

    mel.forEach(([step, freq, len]) => {
      const t = step * s;
      const d = len  * s * 0.92;
      if (t >= dur) return;
      // 3 detuned saws (supersaw approximation)
      [0.997, 1.0, 1.003].forEach((detune, i) => {
        const osc  = off.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = freq * detune;
        const f    = off.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(2800, t);
        f.frequency.exponentialRampToValueAtTime(900, t + d);
        f.Q.value  = 1.5;
        const g    = off.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.015);
        g.gain.setValueAtTime(0.12, t + d - 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.06);
        osc.connect(f); f.connect(g); g.connect(off.destination);
        osc.start(t); osc.stop(t + d + 0.1);
      });
    });
    return off.startRendering();
  }

  async function mkArp(SR, dur) {
    const off = mkOff(SR, dur);
    const s   = stepLen();

    // Am → G → F → E arpeggio pattern (up and down)
    const chords = [
      [N.A3, N.C4, N.E4, N.A4],   // Am
      [N.G3, N.B3, N.D4, N.G4],   // G
      [N.F3, N.A3, N.C4, N.F4],   // F
      [N.E3, N.G3, N.B3, N.E4],   // E
    ];
    for (let bar = 0; bar < 2; bar++) {
      for (let c = 0; c < chords.length; c++) {
        const notes    = chords[c];
        // 4 up + 4 down per chord = 8 notes → but chord fits in 4 steps
        for (let ni = 0; ni < 4; ni++) {
          const step = bar * 16 + c * 4 + ni;
          const t    = step * s;
          if (t >= dur) break;
          const freq = notes[ni];
          // sine + triangle
          [[1, 0.22], [2, 0.06]].forEach(([mult, amp]) => {
            const osc = off.createOscillator();
            osc.type  = mult === 1 ? 'sine' : 'triangle';
            osc.frequency.value = freq * mult;
            const g   = off.createGain();
            g.gain.setValueAtTime(amp, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + s * 1.75);
            osc.connect(g); g.connect(off.destination);
            osc.start(t); osc.stop(t + s * 2);
          });
        }
      }
    }
    return off.startRendering();
  }

  async function mkBells(SR, dur) {
    const off  = mkOff(SR, dur);
    const s    = stepLen();

    const notes = [
      [0,  N.A4, 0.9],  [3,  N.E5, 0.7],  [5,  N.D5, 0.6],
      [7,  N.C5, 0.8],  [10, N.A4, 0.7],  [12, N.G4, 0.6],
      [14, N.E4, 1.0],  [16, N.A4, 0.6],  [18, N.C5, 1.0],
      [21, N.E5, 0.7],  [23, N.D5, 0.6],  [25, N.C5, 0.8],
      [28, N.A4, 1.1],
    ];

    notes.forEach(([step, freq, amp]) => {
      const t = step * s;
      if (t >= dur) return;
      // Inharmonic bell partials
      [[1.0, amp * 0.5], [2.1, amp * 0.25], [3.7, amp * 0.12]].forEach(([ratio, a]) => {
        const osc = off.createOscillator(); osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        const g   = off.createGain();
        g.gain.setValueAtTime(a, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        osc.connect(g); g.connect(off.destination);
        osc.start(t); osc.stop(t + 1.4);
      });
    });
    return off.startRendering();
  }

  // ─── FX loops ─────────────────────────────────────────────────────────────────

  async function mkScratch(SR, dur) {
    const off = mkOff(SR, dur);
    const b   = beatLen();

    // Vinyl scratch: rhythmic noise bursts + pitch modulation
    const hits = [0, b, b*2, b*2.5, b*4, b*5, b*6, b*6.5];
    hits.forEach((t, i) => {
      if (t >= dur) return;
      const d   = 0.06 + (i % 3) * 0.02;
      const buf = off.createBuffer(1, Math.ceil(SR * d), SR);
      const dat = buf.getChannelData(0);
      for (let j = 0; j < dat.length; j++) dat[j] = (Math.random() * 2 - 1) * (1 - j/dat.length);
      const src  = off.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = i % 2 === 0 ? 1.8 : 0.6;
      const f   = off.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = 2200 + (i % 3) * 700; f.Q.value = 1.2;
      const g   = off.createGain();
      g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      src.connect(f); f.connect(g); g.connect(off.destination);
      src.start(t); src.stop(t + d);
    });
    return off.startRendering();
  }

  async function mkGlitch(SR, dur) {
    const off  = mkOff(SR, dur);
    const s    = stepLen();
    // Micro-stutter pattern
    const pat  = [0,1,0,1,0,0,1,1, 0,1,0,0,1,0,1,0, 0,0,1,0,0,1,0,1, 1,0,0,1,0,0,1,0];
    pat.forEach((hit, i) => {
      if (!hit) return;
      const t    = i * s;
      if (t >= dur) return;
      const freq = 60 + Math.abs(Math.sin(i * 1.618)) * 500;
      const osc  = off.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const g    = off.createGain();
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
      osc.connect(g); g.connect(off.destination);
      osc.start(t); osc.stop(t + 0.028);
    });
    return off.startRendering();
  }

  async function mkRiser(SR, dur) {
    const off  = mkOff(SR, dur);

    // Filtered noise sweep
    const buf  = off.createBuffer(1, Math.ceil(SR * dur), SR);
    const dat  = buf.getChannelData(0);
    for (let i = 0; i < dat.length; i++) dat[i] = (Math.random() * 2 - 1) * 0.25;
    const src  = off.createBufferSource(); src.buffer = buf;
    const f    = off.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(180, 0);
    f.frequency.exponentialRampToValueAtTime(9000, dur * 0.85);
    f.Q.setValueAtTime(2, 0); f.Q.linearRampToValueAtTime(8, dur);
    const g    = off.createGain();
    g.gain.setValueAtTime(0.04, 0); g.gain.linearRampToValueAtTime(0.55, dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.001, dur);

    // Pitch sweep oscillator
    const osc  = off.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, 0);
    osc.frequency.exponentialRampToValueAtTime(1760, dur * 0.82);
    const og   = off.createGain();
    og.gain.setValueAtTime(0.015, 0); og.gain.linearRampToValueAtTime(0.08, dur * 0.6);
    og.gain.exponentialRampToValueAtTime(0.001, dur);

    src.connect(f); f.connect(g); g.connect(off.destination);
    osc.connect(og); og.connect(off.destination);
    src.start(0); src.stop(dur); osc.start(0); osc.stop(dur);
    return off.startRendering();
  }

  // ─── Vocal loops ─────────────────────────────────────────────────────────────

  async function mkBeatbox(SR, dur) {
    const off  = mkOff(SR, dur);
    const s    = stepLen();

    // "Boots 'n' cats" — kick-like on 1/3, snare-like on 2/4
    // Boots on steps: 0,6,8,14,16,22,24,30
    const boots  = [0,6,8,14, 16,22,24,30];
    // Cats on steps: 4,4+2,12,12+2, ...
    const cats   = [4,5,12,13, 20,21,28,29];

    // Boot voice (low, voiced)
    boots.forEach(step => {
      const t = step * s;
      if (t >= dur) return;
      [400,1200].forEach((formant, fi) => {
        const osc = off.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 105;
        const bp  = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = formant; bp.Q.value = 9;
        const g   = off.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime([0.45, 0.2][fi], t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.connect(bp); bp.connect(g); g.connect(off.destination);
        osc.start(t); osc.stop(t + 0.1);
      });
    });

    // Cat voice (noise, unvoiced)
    cats.forEach(step => {
      const t   = step * s;
      if (t >= dur) return;
      const bDur = 0.065;
      const buf  = off.createBuffer(1, Math.ceil(SR * bDur), SR);
      const dat  = buf.getChannelData(0);
      for (let j = 0; j < dat.length; j++) dat[j] = Math.random() * 2 - 1;
      const src  = off.createBufferSource(); src.buffer = buf;
      const bp   = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 1.2;
      const g    = off.createGain();
      g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + bDur);
      src.connect(bp); bp.connect(g); g.connect(off.destination);
      src.start(t); src.stop(t + bDur);
    });

    return off.startRendering();
  }

  async function mkChoir(SR, dur) {
    const off  = mkOff(SR, dur);

    // 4-voice Am chord "Ahh", smooth fade in/out for seamless loop
    const voices = [
      { f: N.A2 },
      { f: N.A3 },
      { f: N.C4 },
      { f: N.E4 },
    ];

    voices.forEach(({ f }) => {
      const osc  = off.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;

      // Vibrato
      const vib  = off.createOscillator(); vib.frequency.value = 5.2;
      const vg   = off.createGain(); vg.gain.value = f * 0.004;
      vib.connect(vg); vg.connect(osc.frequency);

      // "Ahh" formants: F1=800, F2=1150, F3=2900
      [800, 1150, 2900].forEach((fq, fi) => {
        const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = 10;
        const g  = off.createGain();
        const a  = [0.20, 0.14, 0.07][fi];
        g.gain.setValueAtTime(0, 0);
        g.gain.linearRampToValueAtTime(a, 0.35);
        g.gain.setValueAtTime(a, dur - 0.35);
        g.gain.linearRampToValueAtTime(0, dur);
        osc.connect(bp); bp.connect(g); g.connect(off.destination);
      });

      osc.start(0); vib.start(0); osc.stop(dur); vib.stop(dur);
    });

    return off.startRendering();
  }

  async function mkHum(SR, dur) {
    const off  = mkOff(SR, dur);
    const b    = beatLen();

    // Melodic hum in A minor
    const melody = [
      { t:0,       f:N.A3, d:b*1.4 },
      { t:b*1.4,   f:N.C4, d:b*0.9 },
      { t:b*2.3,   f:N.D4, d:b*0.9 },
      { t:b*3.2,   f:N.E4, d:b*0.6 },
      { t:b*4,     f:N.D4, d:b*1.4 },
      { t:b*5.4,   f:N.C4, d:b*0.9 },
      { t:b*6.3,   f:N.A3, d:b*1.5 },
    ];

    melody.forEach(({ t, f, d }) => {
      if (t >= dur) return;
      const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
      const vib = off.createOscillator(); vib.frequency.value = 5.5;
      const vg  = off.createGain(); vg.gain.value = f * 0.003;
      vib.connect(vg); vg.connect(osc.frequency);
      // Nasal bandpass
      const bp  = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2.5;
      const g   = off.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.42, t + 0.04);
      g.gain.setValueAtTime(0.38, t + d - 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.02);
      osc.connect(bp); bp.connect(g); g.connect(off.destination);
      osc.start(t); vib.start(t); osc.stop(t + d + 0.05); vib.stop(t + d + 0.05);
    });
    return off.startRendering();
  }

  // ─── Scheduler ────────────────────────────────────────────────────────────────

  function schedulerStart() {
    if (schedulerTimer) return;
    nextStepTime = ctx.currentTime + 0.05;
    currentStep  = 0;

    function tick() {
      const lookahead = 0.085;
      while (nextStepTime < ctx.currentTime + lookahead) {
        fireStep(currentStep, nextStepTime);
        nextStepTime += stepLen();
        currentStep   = (currentStep + 1) % STEPS;
      }
      schedulerTimer = setTimeout(tick, 22);
    }
    tick();
  }

  function fireStep(step, time) {
    Object.entries(SOUNDS).forEach(([id, sound]) => {
      if (sound.mode !== 'drum') return;
      if (!activeLoops[id]) return;
      if (!sound.pattern[step]) return;
      const buf = BUF[id];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g   = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(masterGain);
      src.start(time);
    });
  }

  // ─── Loop control ─────────────────────────────────────────────────────────────

  function startLoop(label) {
    const [id, sound] = soundByLabel(label);
    if (!id || activeLoops[id]) return;
    if (sound.mode === 'drum') { activeLoops[id] = true; return; }

    const buf = BUF[id];
    if (!buf) return;

    // Quantize start to next bar boundary
    const barDuration = barLen();
    const elapsed     = ctx.currentTime - (nextStepTime - currentStep * stepLen());
    const startAfter  = barDuration - (elapsed % barDuration);
    const startTime   = ctx.currentTime + Math.max(0.01, startAfter > barDuration - 0.05 ? 0.01 : startAfter);

    const src = ctx.createBufferSource();
    src.buffer   = buf;
    src.loop     = true;
    src.loopEnd  = buf.duration;

    // Apply BPM stretch via playbackRate
    src.playbackRate.value = BPM / ORIGIN_BPM;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(sound.gain || 0.8, startTime + 0.12);

    src.connect(g); g.connect(masterGain);
    src.start(startTime);

    activeLoops[id] = { src, gain: g };
  }

  function stopLoop(label) {
    const [id, sound] = soundByLabel(label);
    if (!id) return;
    const loop = activeLoops[id];
    if (!loop) return;

    if (loop === true) { delete activeLoops[id]; return; }

    const { src, gain } = loop;
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    try { src.stop(ctx.currentTime + 0.15); } catch(e) {}
    delete activeLoops[id];
  }

  function stopAll() {
    Object.keys(activeLoops).forEach(id => {
      const sound = SOUNDS[id];
      if (sound) stopLoop(sound.label);
    });
  }

  function isActive(label) {
    const [id] = soundByLabel(label);
    return !!activeLoops[id];
  }

  function previewSound(label) {
    if (!ctx || !buffersReady) return;
    ctx.resume();
    const [id, sound] = soundByLabel(label);
    if (!id || !BUF[id]) return;
    const src  = ctx.createBufferSource();
    src.buffer = BUF[id];
    src.loop   = false;
    const g    = ctx.createGain(); g.gain.value = 0.75;
    src.connect(g); g.connect(masterGain);
    const when = ctx.currentTime + 0.02;
    src.start(when);
    if (sound.mode !== 'drum') src.stop(when + Math.min(2.5, BUF[id].duration));
  }

  function setBpm(val) {
    BPM = Math.max(60, Math.min(160, val));
    // Adjust playback rate of running loops
    Object.entries(activeLoops).forEach(([id, loop]) => {
      if (loop && loop !== true && loop.src) {
        loop.src.playbackRate.setValueAtTime(BPM / ORIGIN_BPM, ctx.currentTime);
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function soundByLabel(label) {
    const entry = Object.entries(SOUNDS).find(([, s]) => s.label === label);
    return entry ? [entry[0], entry[1]] : [null, null];
  }

  function getSounds()  { return SOUNDS; }
  function getAnalyser(){ return analyser; }
  function isReady()    { return buffersReady; }
  function resume()     { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  // ─── Public API ───────────────────────────────────────────────────────────────
  return { init, resume, isReady, getAnalyser, getSounds, setBpm, startLoop, stopLoop, isActive, stopAll, previewSound };

})();
