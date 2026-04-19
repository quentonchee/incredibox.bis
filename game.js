/**
 * game.js — Incredibox Clone: UI, characters, drag & drop, visualizer
 */

(function () {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────────────

  const NUM_CHARACTERS   = 7;
  const MAX_SOUNDS_PER_CHAR = 2;

  const CHAR_CONFIGS = [
    { name: 'Alpha',   skinTone: '#f4a460', outfit: '#c0392b' },
    { name: 'Bravo',   skinTone: '#8d5524', outfit: '#784ba0' },
    { name: 'Charlie', skinTone: '#f1c27d', outfit: '#2b86c5' },
    { name: 'Delta',   skinTone: '#e8b89a', outfit: '#27ae60' },
    { name: 'Echo',    skinTone: '#c68642', outfit: '#e91e8c' },
    { name: 'Foxtrot', skinTone: '#f7c99e', outfit: '#f39c12' },
    { name: 'Golf',    skinTone: '#d4956f', outfit: '#00bcd4' },
  ];

  const TYPE_META = {
    beats:  { color: '#ff3cac', bg: 'rgba(255,60,172,0.12)',  border: 'rgba(255,60,172,0.35)' },
    bass:   { color: '#a06bff', bg: 'rgba(160,107,255,0.12)', border: 'rgba(160,107,255,0.35)' },
    melody: { color: '#2b86c5', bg: 'rgba(43,134,197,0.12)',  border: 'rgba(43,134,197,0.35)' },
    fx:     { color: '#00d2ff', bg: 'rgba(0,210,255,0.12)',   border: 'rgba(0,210,255,0.35)' },
    chorus: { color: '#ffce00', bg: 'rgba(255,206,0,0.12)',   border: 'rgba(255,206,0,0.35)' },
  };

  // ─── STATE ───────────────────────────────────────────────────────────────────

  const state = {
    activeTab: 'beats',
    characters: [],
    dragSound: null,
    dragGhost: null,
    isRecording: false,
    bpm: 110,
    animT: 0,
    animId: null,
  };

  // ─── DOM ─────────────────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  // ─── INIT ────────────────────────────────────────────────────────────────────

  function init() {
    buildIntroParticles();
    $('start-btn').addEventListener('click', onStartClicked);
  }

  function onStartClicked() {
    // Show loading overlay
    const btn = $('start-btn');
    btn.textContent = '⏳ Chargement…';
    btn.disabled    = true;
    btn.style.opacity = '0.7';

    // Init audio (async, pre-renders all sounds)
    AudioEngine.init(() => {
      // Transition to game
      const introEl = $('intro-screen');
      introEl.style.transition = 'opacity 0.6s, transform 0.6s';
      introEl.style.opacity    = '0';
      introEl.style.transform  = 'scale(1.05)';
      setTimeout(() => {
        introEl.classList.add('hidden');
        $('game-screen').classList.remove('hidden');
        buildCharacters();
        buildIcons('beats');
        setupTabs();
        setupControls();
        startVisualizer();
        startCharacterAnimations();
      }, 620);
    });
  }

  // ─── CHARACTERS ─────────────────────────────────────────────────────────────

  function buildCharacters() {
    const row = $('characters-row');
    row.innerHTML = '';
    state.characters = [];

    CHAR_CONFIGS.forEach((cfg, i) => {
      const wrap = document.createElement('div');
      wrap.className     = 'character';
      wrap.dataset.idx   = i;
      wrap.innerHTML     = buildCharHTML(cfg, i);

      wrap.addEventListener('dragover',  onCharDragOver);
      wrap.addEventListener('dragleave', onCharDragLeave);
      wrap.addEventListener('drop',      onCharDrop);
      wrap.addEventListener('click',     onCharClick);

      row.appendChild(wrap);
      state.characters.push({ el: wrap, cfg, sounds: [] });
    });
  }

  function buildCharHTML(cfg, idx) {
    const skin   = cfg.skinTone;
    const outfit = cfg.outfit;
    const shadow = outfit + '55';

    return `
      <div class="char-slots" id="char-slots-${idx}">
        <div class="char-slot-dot" id="slot-${idx}-0"></div>
        <div class="char-slot-dot" id="slot-${idx}-1"></div>
      </div>
      <div class="character-body">
        <svg class="char-svg layer-body" viewBox="0 0 110 200"
             xmlns="http://www.w3.org/2000/svg" id="charsvg-${idx}">

          <!-- Shadow -->
          <ellipse cx="55" cy="197" rx="34" ry="5" fill="${shadow}" opacity="0.5"/>

          <!-- Legs -->
          <rect x="33" y="146" width="16" height="48" rx="8" fill="${outfit}"/>
          <rect x="61" y="146" width="16" height="48" rx="8" fill="${outfit}"/>
          <!-- Shoes -->
          <ellipse cx="41" cy="195" rx="14" ry="6" fill="#1a1a2e"/>
          <ellipse cx="69" cy="195" rx="14" ry="6" fill="#1a1a2e"/>

          <!-- Torso -->
          <rect x="24" y="90" width="62" height="60" rx="12" fill="${outfit}"/>

          <!-- Belt -->
          <rect x="24" y="130" width="62" height="8" rx="4" fill="rgba(0,0,0,0.25)"/>
          <rect x="47" y="131" width="16" height="6" rx="3" fill="#f5c518"/>

          <!-- Arm left -->
          <g id="arm-left-${idx}" style="transform-origin:24px 100px">
            <rect x="4"  y="92" width="20" height="46" rx="10" fill="${outfit}"/>
            <circle cx="14" cy="140" r="9" fill="${skin}"/>
          </g>

          <!-- Arm right -->
          <g id="arm-right-${idx}" style="transform-origin:86px 100px">
            <rect x="86" y="92" width="20" height="46" rx="10" fill="${outfit}"/>
            <circle cx="96" cy="140" r="9" fill="${skin}"/>
          </g>

          <!-- Neck -->
          <rect x="47" y="79" width="16" height="16" rx="4" fill="${skin}"/>

          <!-- Head -->
          <ellipse cx="55" cy="62" rx="30" ry="32" fill="${skin}"/>

          <!-- Eyes whites -->
          <ellipse cx="44" cy="58" rx="7" ry="8" fill="white"/>
          <ellipse cx="66" cy="58" rx="7" ry="8" fill="white"/>
          <!-- Irises -->
          <ellipse cx="45" cy="59" rx="4" ry="5" fill="#1a1a2e"/>
          <ellipse cx="67" cy="59" rx="4" ry="5" fill="#1a1a2e"/>
          <!-- Pupils shine -->
          <circle cx="46.5" cy="57" r="1.2" fill="white"/>
          <circle cx="68.5" cy="57" r="1.2" fill="white"/>

          <!-- Eyebrows -->
          <path d="M37,50 Q44,45 51,50" stroke="#5a3a1a" stroke-width="2.5"
                fill="none" stroke-linecap="round"/>
          <path d="M59,50 Q66,45 73,50" stroke="#5a3a1a" stroke-width="2.5"
                fill="none" stroke-linecap="round"/>

          <!-- Ears -->
          <ellipse cx="26" cy="62" rx="5" ry="8" fill="${skin}"/>
          <ellipse cx="84" cy="62" rx="5" ry="8" fill="${skin}"/>

          <!-- Mouth -->
          <path id="mouth-${idx}" d="M47,73 Q55,78 63,73"
                stroke="#8B5E3C" stroke-width="2.2" fill="none" stroke-linecap="round"/>

          <!-- Number badge -->
          <text x="55" y="118" text-anchor="middle" font-size="18"
                fill="rgba(255,255,255,0.22)" font-weight="bold">${idx + 1}</text>

          <!-- Slots for hat / fx overlay -->
          <g id="hat-slot-${idx}"></g>
          <g id="fx-slot-${idx}" opacity="0.9"></g>
        </svg>
      </div>
      <div class="char-label" id="char-label-${idx}">${cfg.name}</div>
    `;
  }

  function updateCharAppearance(idx) {
    const char   = state.characters[idx];
    const sounds = char.sounds; // array of labels

    // Slot dots
    for (let s = 0; s < MAX_SOUNDS_PER_CHAR; s++) {
      const dot   = $(`slot-${idx}-${s}`);
      const label = sounds[s];
      if (label) {
        const meta   = TYPE_META[getSoundType(label)];
        dot.classList.add('filled');
        dot.style.color      = meta.color;
        dot.style.background = meta.color;
        dot.style.boxShadow  = `0 0 8px ${meta.color}`;
      } else {
        dot.classList.remove('filled');
        dot.style.cssText = '';
      }
    }

    // Mouth
    const mouth = $(`mouth-${idx}`);
    if (mouth) {
      if (sounds.length > 0) {
        mouth.setAttribute('d', 'M47,71 Q55,82 63,71');
        mouth.setAttribute('fill', '#8B5E3C88');
      } else {
        mouth.setAttribute('d', 'M47,73 Q55,78 63,73');
        mouth.setAttribute('fill', 'none');
      }
    }

    // Hat & FX overlay based on active sound types
    const hatSlot = $(`hat-slot-${idx}`);
    const fxSlot  = $(`fx-slot-${idx}`);
    if (hatSlot) {
      const types = sounds.map(l => getSoundType(l));
      hatSlot.innerHTML = '';
      if (fxSlot) fxSlot.innerHTML = '';

      if (types.includes('beats')) {
        hatSlot.innerHTML = `
          <path d="M25,38 Q55,16 85,38 L87,32 Q55,8 23,32 Z" fill="#ff3cac"/>
          <rect x="19" y="32" width="72" height="10" rx="5" fill="#cc1a7a"/>
          <rect x="10" y="38" width="22" height="6" rx="3" fill="#cc1a7a"/>
        `;
      } else if (types.includes('chorus')) {
        hatSlot.innerHTML = `
          <polygon points="55,10 61,28 80,28 66,38 72,55 55,43 38,55 44,38 30,28 49,28"
                   fill="#ffce00" stroke="#b8860b" stroke-width="1.2"/>
        `;
      } else if (types.includes('melody')) {
        hatSlot.innerHTML = `
          <rect x="27" y="31" width="56" height="9" rx="4.5" fill="#2b86c5"/>
          <text x="55" y="29" text-anchor="middle" font-size="18" fill="#2b86c5">♪</text>
          <text x="39" y="29" text-anchor="middle" font-size="13" fill="#2b86c555">♫</text>
          <text x="72" y="29" text-anchor="middle" font-size="13" fill="#2b86c555">♩</text>
        `;
      } else if (types.includes('bass')) {
        hatSlot.innerHTML = `
          <ellipse cx="55" cy="26" rx="29" ry="16" fill="#784ba0"/>
          <rect x="26" y="37" width="58" height="7" rx="3.5" fill="#5a3280"/>
        `;
      } else if (types.includes('fx')) {
        if (fxSlot) fxSlot.innerHTML = `
          <rect x="27" y="54" width="22" height="14" rx="7" fill="none"
                stroke="#00d2ff" stroke-width="2.5"/>
          <rect x="61" y="54" width="22" height="14" rx="7" fill="none"
                stroke="#00d2ff" stroke-width="2.5"/>
          <line x1="49" y1="61" x2="61" y2="61" stroke="#00d2ff" stroke-width="2"/>
          <line x1="18" y1="61" x2="27" y2="61" stroke="#00d2ff" stroke-width="2"/>
          <line x1="83" y1="61" x2="92" y2="61" stroke="#00d2ff" stroke-width="2"/>
          <rect x="29" y="56" width="18" height="10" rx="5"
                fill="rgba(0,210,255,0.18)"/>
          <rect x="63" y="56" width="18" height="10" rx="5"
                fill="rgba(0,210,255,0.18)"/>
        `;
      }
    }

    // Label glow
    const lbl = $(`char-label-${idx}`);
    if (lbl) lbl.style.color = sounds.length > 0 ? '#fff' : '';

    // Dance
    char.el.classList.toggle('active-anim', sounds.length > 0);

    // Stage glow
    const anyPlaying = state.characters.some(c => c.sounds.length > 0);
    const g = $('stage-glow');
    if (g) g.classList.toggle('active', anyPlaying);
  }

  // ─── ANIMATIONS ──────────────────────────────────────────────────────────────

  function startCharacterAnimations() {
    function frame() {
      state.animT += 0.038;
      state.characters.forEach((char, idx) => {
        if (char.sounds.length === 0) return;
        const aL = $(`arm-left-${idx}`);
        const aR = $(`arm-right-${idx}`);
        if (aL && aR) {
          const angle = Math.sin(state.animT * 3 + idx * 0.9) * 20;
          aL.style.transform = `rotate(${-angle}deg)`;
          aR.style.transform = `rotate(${angle}deg)`;
        }
      });
      state.animId = requestAnimationFrame(frame);
    }
    frame();
  }

  // ─── ICONS ───────────────────────────────────────────────────────────────────

  function buildIcons(tab) {
    state.activeTab = tab;
    const grid = $('icons-grid');
    grid.innerHTML = '';

    const sounds = AudioEngine.getSounds();
    Object.values(sounds)
      .filter(s => s.type === tab)
      .forEach(sound => {
        const icon           = document.createElement('div');
        icon.className       = 'sound-icon';
        icon.dataset.type    = tab;
        icon.dataset.sound   = sound.label;  // label is the identifier
        icon.draggable       = true;
        icon.title           = sound.label;
        icon.innerHTML       = `
          <span class="icon-emoji">${sound.emoji}</span>
          <span class="icon-label">${sound.label}</span>
        `;

        const inUse = state.characters.some(c => c.sounds.includes(sound.label));
        if (inUse) icon.classList.add('in-use');

        icon.addEventListener('dragstart', onIconDragStart);
        icon.addEventListener('dragend',   onIconDragEnd);
        icon.addEventListener('click',     () => {
          AudioEngine.resume();
          AudioEngine.previewSound(sound.label);
          spawnRippleOn(icon);
        });
        icon.addEventListener('touchstart', onIconTouchStart, { passive: false });
        icon.addEventListener('mouseenter', e => showTip(e,
          `${sound.emoji} <b>${sound.label}</b> — clic pour écouter, glisser sur un perso`));
        icon.addEventListener('mouseleave', hideTip);

        grid.appendChild(icon);
      });
  }

  function refreshInUse() {
    $$('.sound-icon').forEach(icon => {
      const inUse = state.characters.some(c => c.sounds.includes(icon.dataset.sound));
      icon.classList.toggle('in-use', inUse);
    });
  }

  // ─── TABS ────────────────────────────────────────────────────────────────────

  function setupTabs() {
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        buildIcons(btn.dataset.tab);
      });
    });
  }

  // ─── DRAG & DROP (mouse) ─────────────────────────────────────────────────────

  function onIconDragStart(e) {
    AudioEngine.resume();
    const icon = e.currentTarget;
    state.dragSound = icon.dataset.sound;
    icon.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', icon.dataset.sound);

    // Invisible native ghost
    const phantom = document.createElement('div');
    phantom.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;top:-10px;left:-10px;';
    document.body.appendChild(phantom);
    e.dataTransfer.setDragImage(phantom, 0, 0);
    setTimeout(() => phantom.remove(), 100);

    // Custom visual ghost
    const ghost          = document.createElement('div');
    ghost.className      = 'drag-ghost';
    ghost.dataset.type   = icon.dataset.type;
    ghost.style.background = TYPE_META[icon.dataset.type].bg;
    ghost.style.border     = `2px solid ${TYPE_META[icon.dataset.type].border}`;
    ghost.textContent      = icon.querySelector('.icon-emoji').textContent;
    ghost.style.left       = '-200px';
    document.body.appendChild(ghost);
    state.dragGhost = ghost;

    document.addEventListener('dragover', moveGhost, { passive: true });
  }

  function moveGhost(e) {
    if (!state.dragGhost) return;
    state.dragGhost.style.left = e.clientX + 'px';
    state.dragGhost.style.top  = e.clientY + 'px';
  }

  function onIconDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    cleanupDrag();
  }

  function cleanupDrag() {
    if (state.dragGhost) { state.dragGhost.remove(); state.dragGhost = null; }
    document.removeEventListener('dragover', moveGhost);
    $$('.character').forEach(c => c.classList.remove('drop-hover'));
    state.dragSound = null;
  }

  function onCharDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    $$('.character').forEach(c => c.classList.remove('drop-hover'));
    e.currentTarget.classList.add('drop-hover');
  }

  function onCharDragLeave(e) {
    // Only remove if we really left (not just entered a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drop-hover');
    }
  }

  function onCharDrop(e) {
    e.preventDefault();
    const charIdx   = parseInt(e.currentTarget.dataset.idx);
    const soundLabel = e.dataTransfer.getData('text/plain') || state.dragSound;
    if (soundLabel) addSoundToChar(charIdx, soundLabel);
    cleanupDrag();
  }

  // ─── CLICK ON CHARACTER (remove last sound) ──────────────────────────────────

  function onCharClick(e) {
    if (state.dragSound) return;
    const idx   = parseInt(e.currentTarget.dataset.idx);
    const char  = state.characters[idx];
    if (char.sounds.length === 0) return;

    const removed = char.sounds.pop();
    AudioEngine.stopLoop(removed);
    updateCharAppearance(idx);
    refreshInUse();
    updateMixerSlots();
    spawnNote(e.currentTarget, '✖', '#ff6b6b');
    showNotif(`🔕 ${removed} retiré`);
  }

  // ─── SOUND MANAGEMENT ────────────────────────────────────────────────────────

  function addSoundToChar(charIdx, soundLabel) {
    const char = state.characters[charIdx];

    // Toggle off if already on this char
    if (char.sounds.includes(soundLabel)) {
      char.sounds = char.sounds.filter(s => s !== soundLabel);
      AudioEngine.stopLoop(soundLabel);
      updateCharAppearance(charIdx);
      refreshInUse();
      updateMixerSlots();
      showNotif(`🔕 ${soundLabel} retiré`);
      return;
    }

    // Max slots: evict oldest
    if (char.sounds.length >= MAX_SOUNDS_PER_CHAR) {
      const old = char.sounds.shift();
      AudioEngine.stopLoop(old);
      showNotif(`↩ ${old} remplacé`);
    }

    // If already on another char, move it
    state.characters.forEach((c, i) => {
      if (i !== charIdx && c.sounds.includes(soundLabel)) {
        c.sounds = c.sounds.filter(s => s !== soundLabel);
        updateCharAppearance(i);
      }
    });

    char.sounds.push(soundLabel);
    AudioEngine.startLoop(soundLabel);
    updateCharAppearance(charIdx);
    refreshInUse();
    updateMixerSlots();
    spawnNote(char.el, getEmoji(soundLabel), TYPE_META[getSoundType(soundLabel)].color);
    showNotif(`🎵 ${soundLabel} ajouté !`);
  }

  function getSoundType(label) {
    const s = Object.values(AudioEngine.getSounds()).find(s => s.label === label);
    return s ? s.type : 'beats';
  }

  function getEmoji(label) {
    const s = Object.values(AudioEngine.getSounds()).find(s => s.label === label);
    return s ? s.emoji : '🎵';
  }

  // ─── TOUCH DRAG ──────────────────────────────────────────────────────────────

  function onIconTouchStart(e) {
    e.preventDefault();
    AudioEngine.resume();
    const icon       = e.currentTarget;
    const soundLabel = icon.dataset.sound;
    const touch      = e.touches[0];

    const ghost          = document.createElement('div');
    ghost.className      = 'drag-ghost';
    ghost.dataset.type   = icon.dataset.type;
    ghost.style.background = TYPE_META[icon.dataset.type].bg;
    ghost.style.border     = `2px solid ${TYPE_META[icon.dataset.type].border}`;
    ghost.textContent      = icon.querySelector('.icon-emoji').textContent;
    ghost.style.left       = touch.clientX + 'px';
    ghost.style.top        = touch.clientY + 'px';
    document.body.appendChild(ghost);

    const onMove = ev => {
      const t = ev.touches[0];
      ghost.style.left = t.clientX + 'px';
      ghost.style.top  = t.clientY + 'px';
      $$('.character').forEach(c => c.classList.remove('drop-hover'));
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const ch = el && el.closest('.character');
      if (ch) ch.classList.add('drop-hover');
    };

    const onEnd = ev => {
      ghost.remove();
      $$('.character').forEach(c => c.classList.remove('drop-hover'));
      const t  = ev.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const ch = el && el.closest('.character');
      if (ch) addSoundToChar(parseInt(ch.dataset.idx), soundLabel);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  // ─── MIXER SLOTS ─────────────────────────────────────────────────────────────

  function updateMixerSlots() {
    const container = $('mixer-slots');
    container.innerHTML = '';

    state.characters.forEach((char, ci) => {
      char.sounds.forEach(label => {
        const type  = getSoundType(label);
        const meta  = TYPE_META[type];
        const emoji = getEmoji(label);
        const slot  = document.createElement('div');
        slot.className   = 'mixer-slot';
        slot.style.background = meta.bg;
        slot.style.border     = `1px solid ${meta.border}`;
        slot.style.color      = meta.color;
        slot.innerHTML        = `${emoji} <span>${label}</span>`;
        slot.title            = `Cliquer pour retirer`;
        slot.addEventListener('click', () => {
          char.sounds = char.sounds.filter(s => s !== label);
          AudioEngine.stopLoop(label);
          updateCharAppearance(ci);
          refreshInUse();
          updateMixerSlots();
          showNotif(`🔕 ${label} retiré`);
        });
        container.appendChild(slot);
      });
    });
  }

  // ─── VISUALIZER ──────────────────────────────────────────────────────────────

  function startVisualizer() {
    const canvas  = $('viz-canvas');
    const ctx2d   = canvas.getContext('2d');
    const analyser = AudioEngine.getAnalyser();
    const dataArr  = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      requestAnimationFrame(draw);
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      analyser.getByteFrequencyData(dataArr);
      ctx2d.clearRect(0, 0, W, H);
      const bins = Math.min(dataArr.length, 96);
      const bW   = W / bins;
      for (let i = 0; i < bins; i++) {
        const v   = dataArr[i] / 255;
        const bH  = v * H;
        const hue = (i / bins) * 280 + 300;
        ctx2d.fillStyle = `hsla(${hue},90%,65%,${0.55 + v * 0.45})`;
        ctx2d.beginPath();
        ctx2d.roundRect(i * bW + 1, H - bH, bW - 2, bH, 2);
        ctx2d.fill();
      }
    }
    draw();
  }

  // ─── CONTROLS ────────────────────────────────────────────────────────────────

  function setupControls() {
    const slider = $('bpm-slider');
    slider.value = 110;
    $('bpm-display').textContent = 110;

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      AudioEngine.setBpm(val);
      $('bpm-display').textContent = val;
    });

    $('reset-btn').addEventListener('click', () => {
      AudioEngine.stopAll();
      state.characters.forEach((c, i) => { c.sounds = []; updateCharAppearance(i); });
      refreshInUse();
      updateMixerSlots();
      showNotif('🔄 Tout effacé !');
    });

    $('record-btn').addEventListener('click', () => {
      state.isRecording = !state.isRecording;
      $('rec-indicator').classList.toggle('hidden', !state.isRecording);
      $('record-btn').classList.toggle('recording', state.isRecording);
      $('record-btn').textContent = state.isRecording ? '⏹ STOP' : '⏺ REC';
      showNotif(state.isRecording ? '⏺ Enregistrement...' : '⏹ Enregistrement terminé !');
    });

    $('screenshot-btn').addEventListener('click', () => showNotif('📷 Capture !'));
  }

  // ─── FX HELPERS ──────────────────────────────────────────────────────────────

  function spawnNote(el, text, color) {
    const rect = el.getBoundingClientRect();
    const note = document.createElement('div');
    note.className = 'music-note';
    note.textContent = text;
    note.style.color    = color;
    note.style.position = 'fixed';
    note.style.left     = (rect.left + rect.width / 2) + 'px';
    note.style.top      = (rect.top  + rect.height / 3) + 'px';
    note.style.setProperty('--nx', ((Math.random() - 0.5) * 80) + 'px');
    note.style.setProperty('--ny', (-55 - Math.random() * 40) + 'px');
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 1300);
  }

  function spawnRippleOn(icon) {
    const r = document.createElement('div');
    r.style.cssText = `position:absolute;top:50%;left:50%;
      width:10px;height:10px;border-radius:50%;
      background:rgba(255,255,255,0.5);
      transform:translate(-50%,-50%) scale(0);
      animation:ripple 0.5s ease-out forwards;pointer-events:none;`;
    icon.style.position = 'relative';
    icon.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  let notifTimer;
  function showNotif(msg) {
    let el = document.querySelector('.notif');
    if (!el) {
      el = document.createElement('div');
      el.className = 'notification notif';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ─── TOOLTIP ─────────────────────────────────────────────────────────────────

  function showTip(e, html) {
    const tip = $('tooltip');
    tip.innerHTML = html;
    tip.classList.add('visible');
    document.addEventListener('mousemove', moveTip);
    moveTip(e);
  }
  function moveTip(e) {
    const tip = $('tooltip');
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 10) + 'px';
  }
  function hideTip() {
    $('tooltip').classList.remove('visible');
    document.removeEventListener('mousemove', moveTip);
  }

  // ─── INTRO PARTICLES ─────────────────────────────────────────────────────────

  function buildIntroParticles() {
    const container = $('intro-particles');
    const colors    = ['#ff3cac','#784ba0','#2b86c5','#00d2ff','#ffce00'];
    for (let i = 0; i < 40; i++) {
      const p    = document.createElement('div');
      p.className = 'particle';
      const size  = 3 + Math.random() * 8;
      p.style.cssText = `
        left:${Math.random() * 100}%;bottom:-20px;
        width:${size}px;height:${size}px;
        background:${colors[i % colors.length]};
        animation-duration:${4 + Math.random() * 6}s;
        animation-delay:${Math.random() * 6}s;
        filter:blur(${Math.random() * 2}px);
      `;
      container.appendChild(p);
    }
  }

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1 && n <= 7) {
      const char = state.characters[n - 1];
      if (char && char.sounds.length) spawnNote(char.el, '✨', '#fff');
    }
  });

  // ─── BOOT ────────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);

})();
