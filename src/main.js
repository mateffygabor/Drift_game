// Entry point: menu, garage (vehicle selection with a 3D preview), settings,
// race overlays (pause / results), controller connection UI and the language
// switch. The race itself runs in game.js.

import * as THREE from '../lib/three.module.js';
import { TRACKS, getTrackById } from './tracks.js';
import { initInput, inputState, serialController, wifiController } from './input.js';
import { Game, gameSettings } from './game.js';
import { carSettings } from './car.js';
import { VEHICLES, CAR_COLORS, statBars } from './vehicles.js';
import { THEMES } from './world.js';
import { buildCarModel } from './carmodel.js';
import { audio } from './audio.js';
import { botNames } from './ai.js';
import { getTimes, entryVehicleName, getLastPlayerName, setLastPlayerName, formatTime } from './leaderboard.js';
import { t, getLanguage, getLocale, setLanguage, applyTranslations, onLanguageChange } from './i18n.js';

applyTranslations();
initInput();

const screens = {
  menu: document.getElementById('screen-menu'),
  garage: document.getElementById('screen-garage'),
  race: document.getElementById('screen-race'),
};
let currentScreen = 'menu';
function showScreen(name) {
  currentScreen = name;
  for (const key in screens) screens[key].classList.toggle('active', key === name);
  if (name === 'garage') startGarageLoop(); else stopGarageLoop();
}

// browsers only allow audio after a user interaction
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) audio.click();
});

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

let selectedTrackId = null;
let selectedMode = 'practice'; // 'practice' | 'solo' (1 player + bots) | 'duo' (2 players + bots)

const game = new Game(document.getElementById('game-canvas'), document.getElementById('views'));

// ---------------- MENU: language ----------------
const langSeg = document.getElementById('setting-lang');
function refreshLangSeg() {
  langSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === getLanguage()));
}
langSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.v)));
refreshLangSeg();

// ---------------- MENU: game mode ----------------
const modeButtons = { practice: 'mode-practice', solo: 'mode-solo', duo: 'mode-duo' };
function setMode(mode) {
  if (!modeButtons[mode]) mode = 'practice';
  selectedMode = mode;
  for (const [m, id] of Object.entries(modeButtons)) document.getElementById(id).classList.toggle('active', m === mode);
  document.getElementById('mode-hint').textContent = t(`mode.hint.${mode}`);
  saveJSON('driftgame2_mode', mode);
}
for (const [m, id] of Object.entries(modeButtons)) document.getElementById(id).addEventListener('click', () => setMode(m));
setMode(loadJSON('driftgame2_mode', 'practice'));

// ---------------- MENU: track list (with a small map) ----------------
function drawTrackThumb(canvas, track, theme) {
  const dpr = window.devicePixelRatio || 1;
  const w = 150, h = 96;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, theme.sky.top); g.addColorStop(1, theme.ground.low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const b = track.bounds;
  const pad = 8 * dpr;
  const s = Math.min((canvas.width - pad * 2) / b.width, (canvas.height - pad * 2) / b.height);
  const ox = (canvas.width - b.width * s) / 2 - b.minX * s;
  const oy = (canvas.height - b.height * s) / 2 - b.minY * s;
  const path = new Path2D();
  track.centerline.forEach((p, i) => (i ? path.lineTo(p.x * s + ox, p.y * s + oy) : path.moveTo(p.x * s + ox, p.y * s + oy)));
  path.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 7 * dpr; ctx.stroke(path);
  ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 3.5 * dpr; ctx.stroke(path);
  const p0 = track.centerline[0];
  ctx.fillStyle = '#ff5c39';
  ctx.beginPath(); ctx.arc(p0.x * s + ox, p0.y * s + oy, 4 * dpr, 0, Math.PI * 2); ctx.fill();
}

// Small helper: element with a class and (plain) text.
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function renderTrackList() {
  const container = document.getElementById('track-list');
  container.textContent = '';
  for (const track of TRACKS) {
    const best = getTimes(track.id)[0];
    const card = el('button', 'track-card');
    const km = (track.length / 10 / 1000).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const thumb = el('canvas', 'track-thumb');
    const info = el('div', 'track-info');
    info.append(el('div', 'track-name', track.name));
    const meta = el('div', 'track-meta');
    meta.append(el('span', `diff diff-${track.difficulty}`, track.difficultyLabel), ` · ${t(`theme.${track.theme}`)} · ${km} km`);
    info.append(meta, el('div', 'track-desc', track.description));
    card.append(thumb, info, el('div', 'track-best', best ? `🏆 ${formatTime(best.timeMs)}` : t('menu.noTime')));
    drawTrackThumb(thumb, track, THEMES[track.theme]);
    card.addEventListener('click', () => openGarage(track.id));
    container.appendChild(card);
  }
}

// ---------------- NAME ----------------
const playerNameInput = document.getElementById('player-name');
playerNameInput.value = getLastPlayerName();
playerNameInput.addEventListener('input', () => setLastPlayerName((playerNameInput.value || '').trim().slice(0, 12)));

// ---------------- SETTINGS ----------------
// Values read back from localStorage are validated: a corrupted or hand-edited
// entry must not produce NaN physics or a race that never ends.
function setupSlider(sliderId, valueId, storageKey, fallback, apply) {
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);
  const min = Number(slider.min), max = Number(slider.max);
  let initial = Number(loadJSON(storageKey, fallback));
  if (!Number.isFinite(initial)) initial = fallback;
  initial = Math.max(min, Math.min(max, Math.round(initial)));
  slider.value = String(initial);
  valueEl.textContent = `${initial}%`;
  apply(initial);
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    valueEl.textContent = `${v}%`;
    apply(v);
    saveJSON(storageKey, v);
  });
}
setupSlider('setting-speed', 'setting-speed-value', 'driftgame2_speed', 100, (v) => { carSettings.speedMult = v / 100; });
// 100% is the maximum (it equals the old 90%), 80% by default
setupSlider('setting-sensitivity', 'setting-sensitivity-value', 'driftgame2_sens2', 80, (v) => { carSettings.sensitivityMult = v / 100; });
setupSlider('setting-drift', 'setting-drift-value', 'driftgame2_drift', 60, (v) => { carSettings.driftAssist = v / 100; });
setupSlider('setting-volume', 'setting-volume-value', 'driftgame2_vol', Math.round(audio.volume * 100), (v) => audio.setVolume(v / 100));

// Segmented button group. Only values that exist as buttons are accepted.
function setupSeg(id, storageKey, fallback, apply) {
  const box = document.getElementById(id);
  const buttons = [...box.querySelectorAll('button')];
  const valid = new Set(buttons.map((b) => b.dataset.v));
  const set = (v) => {
    v = String(v);
    if (!valid.has(v)) v = fallback;
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    apply(v);
    saveJSON(storageKey, v);
  };
  buttons.forEach((b) => b.addEventListener('click', () => set(b.dataset.v)));
  set(loadJSON(storageKey, fallback));
  return set;
}
const setCamera = setupSeg('setting-camera', 'driftgame2_camera', 'near', (v) => { gameSettings.camera = v; });
setupSeg('setting-quality', 'driftgame2_quality', 'high', (v) => { gameSettings.quality = v; });
setupSeg('setting-swap', 'driftgame2_swap', '0', (v) => { gameSettings.swapSides = v === '1'; });
setupSeg('setting-laps', 'driftgame2_laps', '3', (v) => { gameSettings.laps = parseInt(v, 10); });
setupSeg('setting-botlevel', 'driftgame2_botlevel', 'medium', (v) => { gameSettings.botLevel = v; });

// the number of bots and the ghost choice are remembered per mode
const BOT_LIMITS = { solo: [1, 5], duo: [0, 4] };
const botCounts = { solo: 5, duo: 4 };
const savedBots = loadJSON('driftgame2_botcounts', null);
if (isPlainObject(savedBots)) {
  for (const m of Object.keys(BOT_LIMITS)) if (Number.isInteger(savedBots[m])) botCounts[m] = savedBots[m];
}
const botSeg = document.getElementById('setting-bots');
function refreshBotSeg() {
  const [min, max] = BOT_LIMITS[selectedMode] || [0, 0];
  const cur = Math.max(min, Math.min(max, botCounts[selectedMode] ?? max));
  if (BOT_LIMITS[selectedMode]) botCounts[selectedMode] = cur;
  botSeg.querySelectorAll('button').forEach((b) => {
    const v = parseInt(b.dataset.v, 10);
    b.classList.toggle('hidden', v > max || v < min);
    b.classList.toggle('active', v === cur);
  });
}
botSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  botCounts[selectedMode] = parseInt(b.dataset.v, 10);
  saveJSON('driftgame2_botcounts', botCounts);
  refreshBotSeg();
}));

const GHOST_VALUES = ['off', 'p1', 'p2'];
const ghostSeg = document.getElementById('setting-ghost');
const ghostChoice = { practice: 'p1', solo: 'off', duo: 'off' };
const savedGhost = loadJSON('driftgame2_ghostchoice', null);
if (isPlainObject(savedGhost)) {
  for (const m of Object.keys(ghostChoice)) if (GHOST_VALUES.includes(savedGhost[m])) ghostChoice[m] = savedGhost[m];
}
function refreshGhostSeg() {
  if (selectedMode !== 'duo' && ghostChoice[selectedMode] === 'p2') ghostChoice[selectedMode] = 'p1';
  const cur = ghostChoice[selectedMode] || 'off';
  gameSettings.ghost = cur;
  ghostSeg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('hidden', b.dataset.v === 'p2' && selectedMode !== 'duo');
    b.classList.toggle('active', b.dataset.v === cur);
  });
  ghostSeg.querySelector('[data-v="p1"]').textContent = selectedMode === 'duo' ? t('ghost.p1') : t('ghost.mine');
}
ghostSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  ghostChoice[selectedMode] = b.dataset.v;
  saveJSON('driftgame2_ghostchoice', ghostChoice);
  refreshGhostSeg();
}));

// ---------------- GARAGE: 3D preview ----------------
class CarPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x303038, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.4);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.6, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.6, metalness: 0.3 }));
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 3.62, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5c39 }));
    ring.position.y = 0.01;
    this.ring = ring;
    this.scene.add(ring);
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
    this.camera.position.set(5.6, 2.3, 5.6);
    this.camera.lookAt(0, 0.55, 0);
    this.model = null;
    this.angle = 0.8;
  }

  setCar(vehicle, color) {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    }
    this.model = buildCarModel(vehicle, color);
    const scale = vehicle.model === 'kart' ? 1.6 : 1;
    this.model.root.scale.setScalar(scale);
    this.scene.add(this.model.root);
    this.ring.material.color.set(color);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    this.angle += dt * 0.5;
    if (this.model) {
      this.model.root.rotation.y = this.angle;
      for (const w of this.model.wheels) if (w.front) w.pivot.rotation.y = Math.sin(this.angle * 1.3) * 0.35;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------- GARAGE: players ----------------
const defaultSel = [{ vehicle: 'street', color: 0 }, { vehicle: 'drift', color: 1 }];
function cleanSelection(sel, i) {
  const d = defaultSel[i];
  if (!isPlainObject(sel)) return { ...d };
  return {
    vehicle: VEHICLES.some((v) => v.id === sel.vehicle) ? sel.vehicle : d.vehicle,
    color: Number.isInteger(sel.color) && sel.color >= 0 && sel.color < CAR_COLORS.length ? sel.color : d.color,
  };
}
const savedSel = loadJSON('driftgame2_selections', null);
const selections = [0, 1].map((i) => cleanSelection(Array.isArray(savedSel) ? savedSel[i] : null, i));
const previews = [];
// ONE preview (WebGL context) per player slot, reused - creating new ones on
// every garage visit made the browser drop the oldest context (the game's
// main 3D view!) after a few races.
const previewPool = [];
let garagePlayers = [];

function playerCount() { return selectedMode === 'duo' ? 2 : 1; }
function isRaceMode() { return selectedMode !== 'practice'; }

function updateGarageHeader() {
  const track = getTrackById(selectedTrackId);
  if (!track) return;
  document.getElementById('garage-title').textContent = track.name;
  document.getElementById('garage-sub').textContent =
    `${track.difficultyLabel} · ${t(`theme.${track.theme}`)} · ${t(`mode.label.${selectedMode}`)}`;
}

function openGarage(trackId) {
  const track = getTrackById(trackId);
  if (!track) return;
  selectedTrackId = trackId;
  updateGarageHeader();
  document.getElementById('race-options').classList.toggle('hidden', !isRaceMode());
  document.getElementById('leaderboard-box').classList.toggle('hidden', isRaceMode());
  refreshBotSeg();
  refreshGhostSeg();
  renderLeaderboard(trackId);
  buildGaragePlayers();
  showScreen('garage');
}

function renderLeaderboard(trackId) {
  const list = document.getElementById('leaderboard-list');
  const times = getTimes(trackId);
  list.textContent = '';
  if (!times.length) {
    list.append(el('li', 'empty', t('garage.lbEmpty')));
    return;
  }
  times.forEach((e, i) => {
    const li = document.createElement('li');
    const name = el('span', 'lb-name', e.name || t('player.default'));
    name.append(el('small', null, entryVehicleName(e)));
    li.append(el('span', 'rank', `${i + 1}.`), name, el('span', 'lb-time', formatTime(e.timeMs)));
    list.appendChild(li);
  });
}

function buildGaragePlayers() {
  const container = document.getElementById('garage-players');
  container.textContent = '';
  previews.length = 0;
  garagePlayers = [];
  const n = playerCount();
  container.classList.toggle('two', n === 2);
  for (let i = 0; i < n; i++) {
    const sel = selections[i];
    const card = document.createElement('div');
    card.className = 'player-card';
    // static markup only - every dynamic text is set with textContent below
    card.innerHTML = `
      <div class="pc-head">
        <span class="pc-badge">P${i + 1}</span>
        <span class="pc-keys"></span>
        <span class="pc-ready-tag"></span>
      </div>
      <div class="pc-preview">
        <canvas></canvas>
        <button class="pc-arrow left">‹</button>
        <button class="pc-arrow right">›</button>
        <div class="pc-index"></div>
      </div>
      <div class="pc-name"></div>
      <div class="pc-desc"></div>
      <div class="pc-stats"></div>
      <div class="pc-colors"></div>
      <button class="btn pc-ready-btn"></button>
    `;
    container.appendChild(card);
    const state = {
      i,
      card,
      vehicleIdx: Math.max(0, VEHICLES.findIndex((v) => v.id === sel.vehicle)),
      colorIdx: sel.color,
      ready: false,
      preview: previewPool[i] || (previewPool[i] = new CarPreview(document.createElement('canvas'))),
      prevInput: { ...inputState[i === 0 ? 'p1' : 'p2'] },
    };
    card.querySelector('.pc-preview canvas').replaceWith(state.preview.canvas);
    previews.push(state.preview);
    garagePlayers.push(state);
    card.querySelector('.pc-arrow.left').addEventListener('click', () => changeVehicle(state, -1));
    card.querySelector('.pc-arrow.right').addEventListener('click', () => changeVehicle(state, 1));
    card.querySelector('.pc-ready-btn').addEventListener('click', () => setReady(state, !state.ready));
    const colors = card.querySelector('.pc-colors');
    CAR_COLORS.forEach((c, ci) => {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = c.hex;
      sw.addEventListener('click', () => { state.colorIdx = ci; updatePlayerCard(state); });
      colors.appendChild(sw);
    });
    translatePlayerCard(state);
    updatePlayerCard(state);
  }
  requestAnimationFrame(() => previews.forEach((p) => p.resize()));
}

// texts of a player card that depend only on the language
function translatePlayerCard(state) {
  const card = state.card;
  card.querySelector('.pc-keys').textContent = t(state.i === 0 ? 'garage.keysP1' : 'garage.keysP2');
  card.querySelector('.pc-ready-tag').textContent = t('garage.readyTag');
  card.querySelector('.pc-arrow.left').title = t('garage.prev');
  card.querySelector('.pc-arrow.right').title = t('garage.next');
  card.querySelector('.pc-ready-btn').textContent = state.ready ? t('garage.cancel') : t('garage.ready');
  card.querySelectorAll('.swatch').forEach((sw, ci) => { sw.title = CAR_COLORS[ci].name; });
}

function changeVehicle(state, dir) {
  state.vehicleIdx = (state.vehicleIdx + dir + VEHICLES.length) % VEHICLES.length;
  if (state.ready) setReady(state, false);
  audio.select();
  updatePlayerCard(state);
}

function setReady(state, ready) {
  state.ready = ready;
  state.card.classList.toggle('ready', ready);
  state.card.querySelector('.pc-ready-btn').textContent = ready ? t('garage.cancel') : t('garage.ready');
  if (ready) audio.select();
  if (garagePlayers.length && garagePlayers.every((p) => p.ready)) {
    setTimeout(() => { if (currentScreen === 'garage' && garagePlayers.every((p) => p.ready)) startRace(); }, 500);
  }
}

function updatePlayerCard(state) {
  const v = VEHICLES[state.vehicleIdx];
  const color = CAR_COLORS[state.colorIdx % CAR_COLORS.length].hex;
  const card = state.card;
  card.style.setProperty('--pc', color);
  card.querySelector('.pc-name').textContent = v.name;
  card.querySelector('.pc-desc').textContent = v.desc;
  card.querySelector('.pc-index').textContent = `${state.vehicleIdx + 1} / ${VEHICLES.length}`;
  const stats = card.querySelector('.pc-stats');
  stats.textContent = '';
  for (const [label, val] of statBars(v)) {
    const row = el('div', 'stat');
    const bar = el('div', 'bar');
    const fill = document.createElement('div');
    fill.style.width = `${Math.round(val * 100)}%`;
    bar.append(fill);
    row.append(el('span', null, label), bar);
    stats.append(row);
  }
  card.querySelectorAll('.swatch').forEach((sw, i) => sw.classList.toggle('active', i === state.colorIdx));
  state.preview.setCar(v, color);
  selections[state.i] = { vehicle: v.id, color: state.colorIdx };
  saveJSON('driftgame2_selections', selections);
}

// Controller / keyboard in the garage: left/right = vehicle, gas = ready, brake = cancel
let garageRaf = null;
let garageLast = 0;
function garageLoop(ts) {
  garageRaf = requestAnimationFrame(garageLoop);
  const dt = Math.min(0.05, (ts - garageLast) / 1000 || 0);
  garageLast = ts;
  for (const st of garagePlayers) {
    const inp = inputState[st.i === 0 ? 'p1' : 'p2'];
    const prev = st.prevInput;
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (!typing) {
      if (inp.left && !prev.left) changeVehicle(st, -1);
      if (inp.right && !prev.right) changeVehicle(st, 1);
      if (inp.gas && !prev.gas && !st.ready) setReady(st, true);
      if (inp.brake && !prev.brake && st.ready) setReady(st, false);
    }
    Object.assign(prev, inp);
    st.preview.render(dt);
  }
}
function startGarageLoop() {
  if (!garageRaf) { garageLast = performance.now(); garageRaf = requestAnimationFrame(garageLoop); }
}
function stopGarageLoop() {
  if (garageRaf) cancelAnimationFrame(garageRaf);
  garageRaf = null;
}
window.addEventListener('resize', () => previews.forEach((p) => p.resize()));

document.getElementById('btn-garage-back').addEventListener('click', () => { renderTrackList(); showScreen('menu'); });
document.getElementById('btn-garage-start').addEventListener('click', () => startRace());

// ---------------- RACE ----------------
const loadingOverlay = document.getElementById('loading-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const winnerOverlay = document.getElementById('winner-overlay');

function currentPlayers() {
  const name = getLastPlayerName() || t('player.default');
  const n = playerCount();
  const out = [];
  for (let i = 0; i < n; i++) {
    const sel = selections[i];
    const vehicle = VEHICLES.find((v) => v.id === sel.vehicle) || VEHICLES[0];
    out.push({
      vehicle,
      color: CAR_COLORS[sel.color % CAR_COLORS.length].hex,
      name: n === 1 ? name : `P${i + 1}`,
    });
  }
  return out;
}

// Bots: random vehicle and colour (a colour the players don't use).
function makeBots(players) {
  const count = isRaceMode() ? (botCounts[selectedMode] ?? 0) : 0;
  const used = new Set(players.map((p) => p.color));
  const colors = CAR_COLORS.map((c) => c.hex).filter((c) => !used.has(c));
  const names = shuffle(botNames());
  const bots = [];
  for (let i = 0; i < count; i++) {
    bots.push({
      vehicle: VEHICLES[Math.floor(Math.random() * VEHICLES.length)],
      color: colors[i % colors.length],
      name: names[i % names.length],
    });
  }
  return bots;
}

// Fisher-Yates (sort() with a random comparator is biased)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let raceStartPending = false;
function startRace() {
  if (raceStartPending) return; // e.g. START clicked while the "everyone ready" timer is running
  const track = getTrackById(selectedTrackId);
  if (!track) return;
  raceStartPending = true;
  audio.unlock();
  showScreen('race');
  pauseOverlay.classList.add('hidden');
  winnerOverlay.classList.add('hidden');
  loadingOverlay.classList.remove('hidden');
  // building the track takes a moment - paint the "loading" text first
  setTimeout(() => {
    try {
      const players = currentPlayers();
      game.loadTrack(track, isRaceMode() ? 'race' : 'practice', players, makeBots(players));
      game.start();
    } catch (err) {
      console.error('Could not start the race:', err);
      game.stop();
      renderTrackList();
      showScreen('menu');
    } finally {
      loadingOverlay.classList.add('hidden');
      raceStartPending = false;
    }
  }, 30);
}

const pauseInfo = document.getElementById('pause-info');
let pausedByConnection = false;
function pauseGame() {
  if (currentScreen !== 'race' || !winnerOverlay.classList.contains('hidden')) return;
  if (game.state !== 'racing' && game.state !== 'countdown') return;
  game.pause();
  pausedByConnection = false;
  pauseInfo.textContent = controllerHint();
  pauseOverlay.classList.remove('hidden');
}
function togglePause() {
  if (currentScreen !== 'race' || !winnerOverlay.classList.contains('hidden')) return;
  if (game.state === 'racing' || game.state === 'countdown') {
    pauseGame();
  } else if (game.state === 'paused') {
    game.resume();
    pausedByConnection = false;
    pauseOverlay.classList.add('hidden');
  }
}
function controllerHint() {
  return wifiController.wanted || serialController.connected ? t('pause.resumeHint') : '';
}
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-reset-car').addEventListener('click', () => { game.resetCarsToTrack(); togglePause(); });
document.getElementById('btn-restart').addEventListener('click', () => { pauseOverlay.classList.add('hidden'); startRace(); });
document.getElementById('btn-quit').addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  game.stop();
  renderTrackList();
  showScreen('menu');
});

// Switching tabs / minimising stops requestAnimationFrame but the lap clock
// keeps running - pause instead of counting the time away from the game.
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

window.addEventListener('keydown', (e) => {
  if (currentScreen !== 'race') return;
  if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); e.preventDefault(); }
  if (e.code === 'KeyC' && !e.repeat) {
    const order = ['near', 'far', 'top'];
    setCamera(order[(order.indexOf(gameSettings.camera) + 1) % order.length]);
  }
});

// ---------------- RACE OVER ----------------
game.onRaceFinish = ({ winner, racers }) => {
  const title = document.getElementById('winner-title');
  title.textContent = t(winner.isBot ? 'win.winnerBot' : 'win.winner', { name: winner.label });
  title.style.color = winner.color;
  const table = document.getElementById('winner-table');
  table.textContent = '';
  for (const r of [...racers].sort((a, b) => a.position - b.position)) {
    const tr = el('tr', r.isBot ? 'bot' : 'human');
    tr.style.setProperty('--pc', r.color);
    const who = document.createElement('td');
    who.append(el('b', null, r.label));
    if (r.isBot) who.append(' ', el('em', null, t('win.bot')));
    who.append(el('small', null, r.player.vehicle.name));
    const best = el('td', null, t('win.bestLap'));
    best.append(document.createElement('br'), el('b', null, r.bestLapTime ? formatTime(r.bestLapTime) : '--'));
    const drift = document.createElement('td');
    if (!r.isBot) drift.append(t('win.drift'), document.createElement('br'), el('b', null, Math.round(r.drift.total).toLocaleString(getLocale())));
    tr.append(
      el('td', 'wpos', `${r.position}.`),
      who,
      el('td', null, r.finished ? formatTime(r.finishTime) : t('win.lapsDone', { lap: r.lap, laps: game.laps })),
      best,
      drift,
    );
    table.append(tr);
  }
  winnerOverlay.classList.remove('hidden');
};
document.getElementById('btn-winner-retry').addEventListener('click', () => { winnerOverlay.classList.add('hidden'); startRace(); });
document.getElementById('btn-winner-garage').addEventListener('click', () => {
  winnerOverlay.classList.add('hidden');
  game.stop();
  openGarage(selectedTrackId);
});
document.getElementById('btn-winner-menu').addEventListener('click', () => {
  winnerOverlay.classList.add('hidden');
  game.stop();
  renderTrackList();
  showScreen('menu');
});

// The results screen works with the controller too: gas = again, brake = menu.
// While paused: gas = resume (only if the controller link is OK and gas was
// released first - so a stuck / just-returning signal can't restart the race).
const overlayPrev = { gas: true, brake: true };
let resumeArmed = false;
setInterval(() => {
  const inp = inputState.p1;
  if (currentScreen === 'race' && !winnerOverlay.classList.contains('hidden')) {
    if (inp.gas && !overlayPrev.gas) document.getElementById('btn-winner-retry').click();
    else if (inp.brake && !overlayPrev.brake) document.getElementById('btn-winner-menu').click();
  }
  if (currentScreen === 'race' && game.state === 'paused' && !pauseOverlay.classList.contains('hidden')) {
    const linkOk = (!wifiController.wanted || wifiController.state === 'connected') &&
      (!serialController.wanted || serialController.state === 'connected');
    if (!inp.gas) resumeArmed = linkOk;
    else if (resumeArmed && linkOk && !overlayPrev.gas) togglePause();
  } else {
    resumeArmed = false;
  }
  overlayPrev.gas = inp.gas;
  overlayPrev.brake = inp.brake;
}, 50);

// ---------------- CONTROLLER (ESP32 / USB Web Serial) ----------------
const controllerStatus = document.getElementById('controller-status');
const SERIAL_TEXT_KEYS = {
  idle: 'ctl.state.idle',
  connecting: 'usb.state.connecting',
  waiting: 'usb.state.waiting',
  connected: 'ctl.state.connected',
  stalled: 'ctl.state.stalled',
  nodata: 'usb.state.nodata',
  busy: 'usb.state.busy',
  unplugged: 'usb.state.unplugged',
  error: 'usb.state.error',
};
function renderSerialStatus() {
  const s = serialController.state;
  if (!serialController.supported) { controllerStatus.textContent = t('usb.unsupported'); return; }
  controllerStatus.textContent = SERIAL_TEXT_KEYS[s] ? t(SERIAL_TEXT_KEYS[s]) : s;
  controllerStatus.classList.toggle('status-on', s === 'connected');
  controllerStatus.classList.toggle('status-warn', ['connecting', 'waiting', 'stalled', 'unplugged'].includes(s));
  controllerStatus.classList.toggle('status-off', ['idle', 'nodata', 'busy', 'error'].includes(s));
}
serialController.onStateChange = (s) => {
  renderSerialStatus();
  onControllerLinkChange('usb', s);
};
document.getElementById('btn-controller').addEventListener('click', () => serialController.connect());
renderSerialStatus();
if (serialController.supported) serialController.autoReconnect();

// ---------------- CONTROLLER (ESP32 / WiFi) ----------------
const wifiStatus = document.getElementById('wifi-status');
const wifiHostInput = document.getElementById('wifi-host');
wifiHostInput.value = wifiController.lastHost || '192.168.4.1';
const WIFI_TEXT_KEYS = {
  idle: 'ctl.state.idle',
  connecting: 'wifi.state.connecting',
  waiting: 'wifi.state.waiting',
  connected: 'ctl.state.connected',
  stalled: 'ctl.state.stalled',
  reconnecting: 'wifi.state.reconnecting',
  badhost: 'wifi.state.badhost',
  insecure: 'wifi.state.insecure',
};
function renderWifiStatus() {
  const s = wifiController.state;
  wifiStatus.textContent = WIFI_TEXT_KEYS[s] ? t(WIFI_TEXT_KEYS[s]) : s;
  const off = ['idle', 'badhost', 'insecure'].includes(s);
  wifiStatus.classList.toggle('status-on', s === 'connected');
  wifiStatus.classList.toggle('status-warn', s !== 'connected' && !off);
  wifiStatus.classList.toggle('status-off', off);
}
const connIndicator = document.getElementById('conn-indicator');
let connOkTimer = null;
function showConnIndicator(text, kind) {
  clearTimeout(connOkTimer);
  connIndicator.textContent = text;
  connIndicator.className = `conn-indicator ${kind}`;
}
wifiController.onStateChange = (s) => {
  renderWifiStatus();
  onControllerLinkChange('wifi', s);
};
renderWifiStatus();

// Shared handling of both controllers (WiFi / USB) during a race:
// indicator at the top of the screen + automatic pause when the link is lost.
function onControllerLinkChange(kind, s) {
  const ctl = kind === 'wifi' ? wifiController : serialController;
  const name = t(kind === 'wifi' ? 'conn.wifi' : 'conn.usb');
  const lost = kind === 'wifi' ? s === 'reconnecting' : s === 'unplugged';
  if (s === 'connected') {
    if (!connIndicator.classList.contains('hidden')) {
      showConnIndicator(t('conn.back'), 'ok');
      connOkTimer = setTimeout(() => connIndicator.classList.add('hidden'), 2000);
    }
  } else if (s === 'idle') {
    connIndicator.classList.add('hidden');
  } else if (ctl.wanted && (s === 'stalled' || lost)) {
    const key = s === 'stalled' ? 'conn.stalled' : kind === 'wifi' ? 'conn.reconnecting' : 'conn.unplugged';
    showConnIndicator(t(key, { name }), 'bad');
  }

  if (lost && currentScreen === 'race' && winnerOverlay.classList.contains('hidden') &&
      (game.state === 'racing' || game.state === 'countdown')) {
    game.pause();
    pausedByConnection = true;
    pauseOverlay.classList.remove('hidden');
  }
  if (pausedByConnection && game.state === 'paused') {
    pauseInfo.textContent = s === 'connected'
      ? t('pause.backHint')
      : t(kind === 'wifi' ? 'pause.wifiLost' : 'pause.usbLost');
  }
}
document.getElementById('btn-wifi').addEventListener('click', () => {
  if (wifiController.connect(wifiHostInput.value)) wifiHostInput.value = wifiController.host;
});
wifiHostInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-wifi').click(); });

// ---------------- LANGUAGE CHANGE ----------------
// Static texts are handled by applyTranslations(); these parts are built in code.
onLanguageChange(() => {
  refreshLangSeg();
  setMode(selectedMode);
  renderTrackList();
  refreshGhostSeg();
  renderSerialStatus();
  renderWifiStatus();
  if (selectedTrackId) {
    updateGarageHeader();
    renderLeaderboard(selectedTrackId);
    for (const st of garagePlayers) { translatePlayerCard(st); updatePlayerCard(st); }
  }
});

// ---------------- STARTUP ----------------
renderTrackList();
showScreen('menu');

// developer handle (for the console / automated tests)
window.__drift = { game, openGarage, startRace, setMode, setLanguage, TRACKS };
