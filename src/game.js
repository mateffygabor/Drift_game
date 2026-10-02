import * as THREE from '../lib/three.module.js';
import { Car } from './car.js';
import { inputState } from './input.js';
import { World, S, QUALITY } from './world.js';
import { buildCarModel, makeNameTag } from './carmodel.js';
import { createEffects } from './effects.js';
import { audio } from './audio.js';
import { BotDriver, BOT_LEVELS, computeRacingLine } from './ai.js';
import { Ghost } from './ghost.js';
import { formatTime, wouldQualify, addTime, getLastPlayerName } from './leaderboard.js';
import { t, getLocale } from './i18n.js';

// The race: loads a track, creates the racers, runs the frame loop (physics,
// laps, collisions, drift points), cameras, split screen and the HUD.

// Game settings chosen in the menu / garage (filled in by main.js).
export const gameSettings = {
  laps: 3,
  camera: 'near',     // 'near' | 'far' | 'top'
  swapSides: false,   // split screen: P1 on the right
  quality: 'high',
  botLevel: 'medium', // 'easy' | 'medium' | 'hard'
  ghost: 'off',       // 'off' | 'p1' | 'p2' - whose best lap the ghost car replays
};

const CAMERA_MODES = {
  near: { dist: 6.0, height: 2.2, look: 1.1, ahead: 5, fov: 64 },
  far: { dist: 9.8, height: 3.8, look: 1.2, ahead: 6, fov: 60 },
  top: { dist: 3.0, height: 24, look: 0, ahead: 7, fov: 55 },
};

const NO_INPUT = { gas: false, brake: false, left: false, right: false };

function idxCircularDist(a, b, n) {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function fmtPoints(n) {
  return Math.round(n).toLocaleString(getLocale());
}

function fmtDelta(ms) {
  const s = (ms / 1000).toFixed(2);
  return ms <= 0 ? `${s}` : `+${s}`;
}

// One racer: car (physics) + 3D model + (for players) camera and HUD.
class Racer {
  constructor(player, car, model) {
    this.player = player;      // { vehicle, color, name, bot?: true }
    this.isBot = !!player.bot;
    this.car = car;
    this.model = model;
    this.color = player.color;
    this.label = player.name;
    this.humanIndex = -1;      // 0 = P1, 1 = P2
    this.inputKey = null;
    this.lap = 0;
    this.expectedCheckpoint = 1;
    this.inCheckpointZone = false;
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.finished = false;
    this.finishTime = null;
    this.trackIdx = 0;
    this.roadH = 0;
    this.offTrack = false;
    this.wrongWayTime = 0;
    this.drift = { active: false, combo: 0, time: 0, idle: 0, mult: 1, total: 0 };
    this.emitAcc = 0;
    this.voice = null;
    this.rig = { yaw: car.angle, y: null, shake: 0 };
    this.position = 1;
    this.driver = null;        // BotDriver (for bots, or a finished player's cool-down lap)
  }
}

export class Game {
  constructor(canvas, viewsContainer) {
    this.canvas = canvas;
    this.viewsContainer = viewsContainer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.world = null;
    this.track = null;
    this.mode = 'practice';
    this.racers = [];
    this.humans = [];
    this.ghost = null;
    this.state = 'idle'; // idle | countdown | racing | paused | raceOver
    this.onRaceFinish = null;
    this.elapsed = 0;

    this._frame = this._frame.bind(this);
    window.addEventListener('resize', () => this._resize());
    this.countdownEl = document.getElementById('countdown');
    this.dividerEl = document.getElementById('split-divider');
  }

  // players: [{ vehicle, color, name }] (1 or 2 players)
  // bots: [{ vehicle, color, name }] computer opponents (race mode only)
  loadTrack(track, mode, players, bots = []) {
    this.stop();
    if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
    if (this.world) this.world.dispose();
    this.track = track;
    this.mode = mode;
    this.laps = gameSettings.laps;
    this.raceResultsSent = false;
    const q = QUALITY[gameSettings.quality] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadow > 0;

    this.world = new World(track, gameSettings.quality);
    this.scene = this.world.scene;
    this.effects = createEffects(this.scene);
    const night = !!this.world.theme.night;
    this.renderer.toneMappingExposure = night ? 1.25 : 1.0;
    this.racingLine = computeRacingLine(track);

    // starting grid: bots in front, players at the back
    const entries = [...bots.map((b) => ({ ...b, bot: true })), ...players];
    this.racers = entries.map((pl, slot) => {
      const g = track.gridSlot(slot, entries.length);
      const car = new Car(pl.vehicle, g.x, g.y, g.angle);
      const model = buildCarModel(pl.vehicle, pl.color, { night, headlight: !pl.bot });
      this.scene.add(model.root);
      const racer = new Racer(pl, car, model);
      racer.trackIdx = track.nearestIndex(car.x, car.y);
      if (racer.isBot) {
        const lvl = BOT_LEVELS[gameSettings.botLevel] || BOT_LEVELS.medium;
        car.powerMult = lvl.power;
        car.driftAssistOverride = 0.25;
        racer.driver = new BotDriver(racer, track, this.racingLine, gameSettings.botLevel, (slot * 0.37) % 1);
      }
      return racer;
    });

    this.humans = this.racers.filter((r) => !r.isBot);
    this.humans.forEach((r, i) => {
      r.humanIndex = i;
      r.inputKey = i === 0 ? 'p1' : 'p2';
      r.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 3000);
      r.camera.layers.enable(0);
      if (this.racers.length > 1) {
        const tag = makeNameTag(this.humans.length > 1 ? `P${i + 1}` : t('hud.you'), r.color);
        tag.position.set(0, (r.model.dims.W > 1.5 ? 2.5 : 2.0), 0);
        tag.layers.set(i + 1);
        r.model.root.add(tag);
      }
    });
    // each player sees the OTHER player's tag, not their own
    for (const r of this.humans) {
      for (const o of this.humans) if (o !== r) r.camera.layers.enable(o.humanIndex + 1);
    }

    // ghost car
    const ghostOwner = gameSettings.ghost === 'p1' ? this.humans[0] : gameSettings.ghost === 'p2' ? this.humans[1] : null;
    if (ghostOwner) this.ghost = new Ghost(this.scene, track, ghostOwner);

    this.dividerEl.classList.toggle('hidden', this.humans.length < 2);
    this._buildViews();
    this._resize();
    for (const r of this.racers) this._updateRacerVisual(r, 0);
    this._updatePositions();
    this._snapCameras();
    this._render();
  }

  // --------------------------- HUD views ---------------------------
  _buildViews() {
    this.viewsContainer.innerHTML = '';
    const isRace = this.mode === 'race';
    const total = this.racers.length;
    for (const r of this.humans) {
      const el = document.createElement('div');
      el.className = 'view';
      el.style.setProperty('--pc', r.color);
      el.innerHTML = `
        <div class="v-panel v-topleft">
          ${isRace ? `<div class="v-pos"><span class="v-pos-n">1</span><small>/${total}</small></div>` : ''}
          <div class="v-lines">
            <div class="v-name">${escapeHtml(r.label)} · ${escapeHtml(r.player.vehicle.name)}</div>
            <div class="v-lap">${t('hud.lap')} <b class="v-lap-n">1</b>${isRace ? `/${this.laps}` : ''}</div>
            <div class="v-time">0:00.000</div>
            <div class="v-sub">${t('hud.best')}: <b class="v-best">--</b> · ${t('hud.last')}: <b class="v-last">--</b></div>
            ${this.ghost && this.ghost.owner === r ? `<div class="v-sub v-ghost">${t('hud.ghost')}: <b class="v-ghost-t">--</b></div>` : ''}
          </div>
        </div>
        ${isRace && total > 2 ? '<div class="v-panel v-standings"></div>' : ''}
        <canvas class="v-minimap"></canvas>
        <div class="v-speedo">
          <canvas class="v-gauge"></canvas>
          <div class="v-speed">0</div>
          <div class="v-unit">km/h</div>
          <div class="v-gear">1</div>
        </div>
        <div class="v-drift-total">DRIFT <b>0</b></div>
        <div class="v-drift"></div>
        <div class="v-msg"></div>
        <div class="v-wrongway hidden">${t('hud.wrongWay')}</div>
        <div class="v-progress"><div class="v-progress-fill"></div></div>
      `;
      this.viewsContainer.appendChild(el);
      const q = (s) => el.querySelector(s);
      r.hud = {
        root: el,
        posN: q('.v-pos-n'),
        lapN: q('.v-lap-n'),
        time: q('.v-time'),
        best: q('.v-best'),
        last: q('.v-last'),
        ghostT: q('.v-ghost-t'),
        standings: q('.v-standings'),
        minimap: q('.v-minimap'),
        gauge: q('.v-gauge'),
        speed: q('.v-speed'),
        gear: q('.v-gear'),
        driftTotal: q('.v-drift-total b'),
        drift: q('.v-drift'),
        msg: q('.v-msg'),
        wrongway: q('.v-wrongway'),
        progress: q('.v-progress-fill'),
        _cache: {},
      };
    }
  }

  _layoutViews() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = this.humans.length;
    this.viewRects = [];
    this.humans.forEach((r, i) => {
      let slot = i;
      if (n === 2 && gameSettings.swapSides) slot = 1 - i;
      const w = n === 2 ? W / 2 : W;
      const rect = { x: slot * w, y: 0, w, h: H };
      this.viewRects[i] = rect;
      Object.assign(r.hud.root.style, { left: `${rect.x}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      r.hud.root.classList.toggle('compact', n === 2);
      r.pan = n === 2 ? (slot === 0 ? -0.65 : 0.65) : 0;
      this._prepareMinimap(r);
      this._prepareGauge(r);
    });
  }

  _prepareMinimap(r) {
    const c = r.hud.minimap;
    const size = Math.round(Math.min(200, Math.max(120, window.innerHeight * 0.22)));
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    c.width = size * dpr;
    c.height = size * dpr;
    const b = this.track.bounds;
    const pad = 10 * dpr;
    const scale = Math.min((c.width - pad * 2) / b.width, (c.height - pad * 2) / b.height);
    const ox = (c.width - b.width * scale) / 2 - b.minX * scale;
    const oy = (c.height - b.height * scale) / 2 - b.minY * scale;
    r.mm = { scale, ox, oy, dpr };
    const bg = document.createElement('canvas');
    bg.width = c.width; bg.height = c.height;
    const ctx = bg.getContext('2d');
    const pts = this.track.centerline;
    ctx.lineJoin = 'round';
    const path = new Path2D();
    pts.forEach((p, i) => {
      const x = p.x * scale + ox, y = p.y * scale + oy;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    path.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 9 * dpr;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(235,240,250,0.9)';
    ctx.lineWidth = 4.5 * dpr;
    ctx.stroke(path);
    if (this.track.def.bridgeHeight != null) {
      ctx.strokeStyle = 'rgba(255,200,90,0.95)';
      ctx.lineWidth = 4.5 * dpr;
      ctx.beginPath();
      let on = false;
      pts.forEach((p) => {
        const x = p.x * scale + ox, y = p.y * scale + oy;
        if (p.bridge) { if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); } else on = false;
      });
      ctx.stroke();
    }
    const p0 = pts[0];
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo((p0.x - p0.nx * 90) * scale + ox, (p0.y - p0.ny * 90) * scale + oy);
    ctx.lineTo((p0.x + p0.nx * 90) * scale + ox, (p0.y + p0.ny * 90) * scale + oy);
    ctx.stroke();
    r.mmBg = bg;
  }

  _prepareGauge(r) {
    const c = r.hud.gauge;
    const size = r.hud.root.classList.contains('compact') ? 130 : 160;
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    c.width = size * dpr;
    c.height = size * dpr;
    r.gaugeSize = size * dpr;
    r._gaugeKey = null;
  }

  // --------------------------- control ---------------------------
  start() {
    audio.unlock();
    for (const r of this.racers) {
      if (r.voice) r.voice.stop();
      r.voice = audio.createCarVoice(r.player.vehicle, r.isBot ? 0 : (r.pan || 0), r.isBot);
      if (r.voice && r.isBot) r.voice.setLevel(0);
    }
    this.state = 'countdown';
    this.countdownT = 0;
    this._lastCount = null;
    this.world.setStartLights(0);
    this._lastTs = performance.now();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._frame);
  }

  pause() {
    if (this.state !== 'racing' && this.state !== 'countdown' && this.state !== 'raceOver') return;
    this._stateBeforePause = this.state;
    this.state = 'paused';
    this._pauseStartedAt = performance.now();
    audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    const pausedFor = performance.now() - this._pauseStartedAt;
    for (const r of this.racers) r.lapStartTime += pausedFor;
    if (this.raceStartTime != null) this.raceStartTime += pausedFor;
    this.state = this._stateBeforePause || 'racing';
    this._lastTs = performance.now();
    audio.resume();
  }

  stop() {
    this.state = 'idle';
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    for (const r of this.racers) { if (r.voice) { r.voice.stop(); r.voice = null; } }
    audio.resume();
    if (this.countdownEl) this.countdownEl.textContent = '';
  }

  // Put a stuck / misplaced car back in the middle of the track.
  _resetRacer(r, lateral = 0) {
    const p = this.track.centerline[r.trackIdx];
    r.car.reset(p.x + p.nx * lateral, p.y + p.ny * lateral, Math.atan2(p.ty, p.tx));
    r.trackIdx = this.track.nearestIndex(r.car.x, r.car.y, r.trackIdx);
    r.rig.yaw = r.car.angle;
  }

  resetCarsToTrack() {
    for (const r of this.humans) this._resetRacer(r, this.humans.length > 1 ? (r.humanIndex === 0 ? -25 : 25) : 0);
  }

  // --------------------------- main loop ---------------------------
  _frame(ts) {
    this._rafId = requestAnimationFrame(this._frame);
    const rawDt = Math.max(0, (ts - this._lastTs) / 1000);
    this._lastTs = ts;
    const dt = Math.min(rawDt, 0.05);
    if (this.state === 'paused') { this._render(); return; }

    this.elapsed += dt;
    if (this.state === 'countdown') this._updateCountdown(Math.min(rawDt, 0.5));
    if (this.state === 'racing' || this.state === 'raceOver') this._updatePhysics(dt, ts);
    if (this.ghost) this.ghost.update(ts, this.state === 'racing' || this.state === 'raceOver');

    for (const r of this.racers) this._updateRacerVisual(r, dt);
    this.effects.smoke.update(dt);
    this.effects.sparks.update(dt);
    this.world.update(dt, this.elapsed);
    for (const r of this.humans) this._updateCamera(r, dt);
    this._updateBotAudio();
    this._render();
    this._updateHud(ts);
  }

  _updateCountdown(dt) {
    this.countdownT += dt;
    const ct = this.countdownT;
    const count = 3 - Math.floor(ct);
    this.world.setStartLights(Math.min(5, Math.floor(ct / 0.6) + 1));
    // engines can already be revved before the start
    for (const r of this.racers) {
      if (!r.voice) continue;
      const gas = r.isBot ? ct > 1.5 && Math.sin(ct * 7 + r.car.x) > 0 : inputState[r.inputKey].gas;
      r.car.throttle += ((gas ? 1 : 0) - r.car.throttle) * (1 - Math.exp(-dt * 8));
      r.car.rpm += ((0.12 + r.car.throttle * 0.55) - r.car.rpm) * (1 - Math.exp(-dt * 6));
      r.voice.update({ rpm: r.car.rpm, speedRatio: 0, throttle: r.car.throttle, drift: 0, offTrack: false, speed: 0 });
    }
    if (count > 0) {
      if (this._lastCount !== count) {
        this._lastCount = count;
        this.countdownEl.textContent = String(count);
        this.countdownEl.classList.remove('pop'); void this.countdownEl.offsetWidth; this.countdownEl.classList.add('pop');
        audio.countdownBeep();
      }
      return;
    }
    const goText = t('hud.go');
    this.countdownEl.textContent = goText;
    this.countdownEl.classList.remove('pop'); void this.countdownEl.offsetWidth; this.countdownEl.classList.add('pop');
    audio.goBeep();
    this.world.setStartLights(5, true);
    setTimeout(() => { if (this.countdownEl.textContent === goText) this.countdownEl.textContent = ''; }, 800);
    setTimeout(() => this.world && this.world.setStartLights(0), 4000);
    this.state = 'racing';
    const now = performance.now();
    this.raceStartTime = now;
    for (const r of this.racers) r.lapStartTime = now;
    if (this.ghost) this.ghost.lapStarted();
  }

  _updatePhysics(dt, ts) {
    const track = this.track;
    const pts = track.centerline;
    const n = pts.length;
    for (const r of this.racers) {
      const car = r.car;
      let input;
      if (r.driver) input = r.driver.update(dt, this.racers);
      else input = this.state === 'racing' ? inputState[r.inputKey] : NO_INPUT;

      const p = pts[r.trackIdx];
      const pn = pts[(r.trackIdx + 1) % n];
      const headingDot = Math.cos(car.angle) * p.tx + Math.sin(car.angle) * p.ty;
      const slope = ((pn.h - p.h) / track.step) * headingDot;
      const before = track.closestPointOnTrack(car.x, car.y, r.trackIdx);
      const offTrack = Math.sqrt(before.dist2) > track.roadWidth / 2 + 4;
      car.update(dt, input, offTrack, slope);

      let idx = track.nearestIndex(car.x, car.y, r.trackIdx);
      const cpt = track.closestPointOnTrack(car.x, car.y, idx);
      if (cpt.dist2 > (track.wallBoundary * 2) ** 2) idx = track.nearestIndex(car.x, car.y); // safety fallback
      r.trackIdx = idx;

      const impact = this._enforceWall(r, idx);
      if (impact > 50) this._onImpact(r, impact, 'wall');

      const after = track.closestPointOnTrack(car.x, car.y, idx);
      r.roadH = after.h;
      r.offTrack = Math.sqrt(after.dist2) > track.roadWidth / 2 + 4;

      // stuck bot: put it back on the track
      if (r.driver && r.driver.stuckTime > 2.5) { this._resetRacer(r); r.driver.stuckTime = 0; }

      this._checkCheckpoint(r, idx, ts);
      if (!r.isBot) {
        this._updateDrift(r, dt);
        const tp = pts[idx];
        const hd = Math.cos(car.angle) * tp.tx + Math.sin(car.angle) * tp.ty;
        const vd = car.vx * tp.tx + car.vy * tp.ty;
        if (hd < -0.35 && vd < -30) r.wrongWayTime += dt; else r.wrongWayTime = Math.max(0, r.wrongWayTime - dt * 2);
      }

      if (r.voice) {
        r.voice.update({
          rpm: car.rpm,
          speedRatio: Math.abs(car.forwardSpeed) / car.maxSpeed,
          throttle: car.throttle,
          drift: car.driftAmount,
          offTrack: r.offTrack,
          speed: car.speed,
        });
      }
      this._emitParticles(r, dt);
    }

    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) this._resolveCarCollision(this.racers[i], this.racers[j]);
    }
    this._updatePositions();
  }

  _progress(r) {
    const n = this.track.centerline.length;
    let idx = r.trackIdx;
    if (r.lap === 0 && r.expectedCheckpoint <= 1 && idx > n / 2) idx -= n;
    return r.lap * n + idx;
  }

  _updatePositions() {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return this._progress(b) - this._progress(a);
    });
    sorted.forEach((r, i) => { r.position = i + 1; });
    this.standings = sorted;
  }

  // bot engine sounds fade with the distance to the nearest player; only the
  // 3 nearest are audible at a time (the rest are muted) to keep it clean
  _updateBotAudio() {
    const bots = [];
    for (const r of this.racers) {
      if (!r.isBot || !r.voice) continue;
      let best = Infinity, pan = 0;
      for (const h of this.humans) {
        const d = Math.hypot(h.car.x - r.car.x, h.car.y - r.car.y);
        if (d < best) { best = d; pan = h.pan || 0; }
      }
      bots.push({ r, best, pan });
    }
    bots.sort((a, b) => a.best - b.best);
    bots.forEach(({ r, best, pan }, i) => {
      const level = i < 3 ? Math.max(0, 1 - best / 800) ** 2 * 0.4 : 0;
      r.voice.setLevel(level, pan);
    });
  }

  // Solid wall at the edge of the run-off area. Returns the impact strength.
  _enforceWall(r, nearIdx) {
    const car = r.car;
    const wallDist = this.track.wallBoundary - car.width * 0.5;
    const closest = this.track.closestPointOnTrack(car.x, car.y, nearIdx);
    const dx = car.x - closest.x, dy = car.y - closest.y;
    const dist = Math.sqrt(closest.dist2);
    if (dist <= wallDist || dist < 1e-6) return 0;
    const nx = dx / dist, ny = dy / dist;
    car.x = closest.x + nx * wallDist;
    car.y = closest.y + ny * wallDist;
    const outward = car.vx * nx + car.vy * ny;
    if (outward > 0) {
      car.vx -= outward * nx * 1.25;
      car.vy -= outward * ny * 1.25;
      car.vx *= 0.97; car.vy *= 0.97;
      r.lastWallNormal = { nx, ny };
      return outward;
    }
    return 0;
  }

  _nearestHumanDist(r) {
    let best = Infinity;
    for (const h of this.humans) best = Math.min(best, Math.hypot(h.car.x - r.car.x, h.car.y - r.car.y));
    return best;
  }

  _onImpact(r, strength, kind, otherPoint = null) {
    const k = Math.min(1, strength / 380);
    // scraping along a wall would trigger an "impact" every frame - sound only every 0.3 s
    const nowMs = performance.now();
    const quiet = nowMs - (r._lastImpact || 0) < 300;
    if (!quiet) r._lastImpact = nowMs;
    if (quiet) {
      if (Math.random() < 0.3) this.effects.sparks.emit(r.car.x * S, r.roadH * S + 0.5, r.car.y * S, { vy: 3, life: 0.3, size0: 0.3, size1: 0.1, alpha: 1, color: 0xffc070 });
      return;
    }
    if (r.isBot) {
      const near = Math.max(0, 1 - this._nearestHumanDist(r) / 700);
      if (near > 0.05) audio.crash(k * near, 0);
    } else {
      audio.crash(k, r.pan || 0);
      r.rig.shake = Math.max(r.rig.shake, 0.15 + k * 0.5);
      if (r.drift.active && r.drift.combo > 30) this._flashDrift(r, t('msg.driftLost'), true);
      r.drift.active = false; r.drift.combo = 0; r.drift.time = 0;
    }
    const car = r.car;
    let sx = car.x, sy = car.y;
    if (kind === 'wall' && r.lastWallNormal) {
      sx += r.lastWallNormal.nx * car.width * 0.5;
      sy += r.lastWallNormal.ny * car.width * 0.5;
    } else if (otherPoint) { sx = otherPoint.x; sy = otherPoint.y; }
    const count = 6 + Math.round(k * 16);
    for (let i = 0; i < count; i++) {
      this.effects.sparks.emit(sx * S, r.roadH * S + 0.5, sy * S, {
        vx: (Math.random() - 0.5) * 10 + car.vx * S * 0.4, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 10 + car.vy * S * 0.4,
        life: 0.3 + Math.random() * 0.4, size0: 0.35, size1: 0.1, alpha: 1, color: 0xffc070,
      });
    }
  }

  _resolveCarCollision(ra, rb) {
    const a = ra.car, b = rb.car;
    if (Math.abs(ra.roadH - rb.roadH) > 30) return; // one under, one over the bridge
    const dx = b.x - a.x, dy = b.y - a.y;
    const minDist = a.collisionRadius + b.collisionRadius;
    if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) return;
    const dist = Math.hypot(dx, dy) || 0.0001;
    if (dist >= minDist) return;
    const nx = dx / dist, ny = dy / dist;
    const overlap = minDist - dist;
    const ma = a.mass, mb = b.mass;
    a.x -= nx * overlap * (mb / (ma + mb));
    a.y -= ny * overlap * (mb / (ma + mb));
    b.x += nx * overlap * (ma / (ma + mb));
    b.y += ny * overlap * (ma / (ma + mb));
    const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rel <= 0) return;
    const e = 0.45;
    const j = ((1 + e) * rel) / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
    if (rel > 40) {
      const pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const now = performance.now();
      const key = `${this.racers.indexOf(ra)}-${this.racers.indexOf(rb)}`;
      this._carHits = this._carHits || {};
      if (!this._carHits[key] || now - this._carHits[key] > 150) {
        this._carHits[key] = now;
        const human = !ra.isBot ? ra : !rb.isBot ? rb : ra;
        const other = human === ra ? rb : ra;
        this._onImpact(human, rel * 0.8, 'car', pt);
        if (!other.isBot) other.rig.shake = Math.max(other.rig.shake, 0.15 + Math.min(1, rel / 380) * 0.5);
      }
    }
  }

  // Checkpoint: counts when ENTERING its zone. A lap only counts when every
  // checkpoint was passed in order, so shortcuts and reversing don't work.
  _checkCheckpoint(r, nearIdx, ts) {
    const n = this.track.centerline.length;
    const targetIdx = this.track.checkpointIndices[r.expectedCheckpoint];
    const tol = Math.max(2, Math.floor(n / this.track.checkpointCount / 2));
    const inZone = idxCircularDist(nearIdx, targetIdx, n) <= tol;
    if (inZone && !r.inCheckpointZone) {
      if (r.expectedCheckpoint === 0) this._finishLap(r, ts);
      r.expectedCheckpoint = (r.expectedCheckpoint + 1) % this.track.checkpointCount;
      r.inCheckpointZone = false;
    } else {
      r.inCheckpointZone = inZone;
    }
  }

  _finishLap(r, ts) {
    if (r.finished) return;
    const lapTime = ts - r.lapStartTime;
    r.lapTimes.push(lapTime);
    r.lastLapTime = lapTime;
    const isNewBest = r.bestLapTime == null || lapTime < r.bestLapTime;
    if (isNewBest) r.bestLapTime = lapTime;
    r.lap += 1;
    r.lapStartTime = ts;
    if (r.isBot) {
      if (this.mode === 'race' && r.lap >= this.laps) this._finishRacer(r, ts);
      return;
    }

    let ghostText = '';
    if (this.ghost && this.ghost.owner === r) {
      const delta = this.ghost.lapFinished(lapTime);
      if (delta != null) ghostText = ` (${fmtDelta(delta)} s)`;
    }

    if (this.mode === 'practice') {
      if (wouldQualify(this.track.id, lapTime)) {
        addTime(this.track.id, getLastPlayerName() || t('player.default'), lapTime, r.player.vehicle.id);
        this._message(r, `${t('msg.record', { time: formatTime(lapTime) })}${ghostText}`, 'good');
        audio.record();
      } else {
        this._message(r, `${t('msg.lap', { time: formatTime(lapTime) })}${isNewBest ? t('msg.lapBest') : ''}${ghostText}`);
        audio.lap(r.pan || 0);
      }
      return;
    }

    if (r.lap >= this.laps) {
      this._finishRacer(r, ts);
      return;
    }
    if (r.lap === this.laps - 1) {
      this._message(r, `${t('msg.finalLap')}${ghostText}`, 'warn');
      audio.finalLap(r.pan || 0);
    } else {
      this._message(r, `${t('msg.lap', { time: formatTime(lapTime) })}${ghostText}`);
      audio.lap(r.pan || 0);
    }
  }

  // A racer finished. The race ends when every PLAYER has finished.
  _finishRacer(r, ts) {
    r.finished = true;
    r.finishTime = ts - this.raceStartTime;
    this._updatePositions();
    if (r.isBot) {
      r.driver.cruise = true;
      return;
    }
    // cool-down lap: the AI drives the car on
    r.driver = new BotDriver(r, this.track, this.racingLine, 'easy', 0.5);
    r.driver.cruise = true;
    const pos = r.position;
    this._message(r, pos === 1 ? t('msg.win') : t('msg.place', { pos }), pos === 1 ? 'good' : '');
    if (pos === 1) audio.win(); else audio.lap(r.pan || 0);
    if (this.humans.every((h) => h.finished) && !this.raceResultsSent) {
      this.raceResultsSent = true;
      this.state = 'raceOver';
      this.countdownEl.textContent = '';
      setTimeout(() => {
        if (this.onRaceFinish && this.state === 'raceOver') {
          this._updatePositions();
          this.onRaceFinish({ winner: this.standings[0], racers: this.standings, track: this.track });
        }
      }, 2200);
    }
  }

  _updateDrift(r, dt) {
    const car = r.car;
    const d = r.drift;
    const drifting = car.driftAmount > 0.35 && car.speed > 110 && !r.offTrack;
    if (drifting) {
      d.active = true;
      d.idle = 0;
      d.time += dt;
      d.mult = 1 + Math.min(4, Math.floor(d.time / 1.5));
      d.combo += car.driftAmount * car.speed * dt * 0.6;
    } else if (d.active) {
      if (r.offTrack) {
        if (d.combo > 30) this._flashDrift(r, t('msg.driftLost'), true);
        d.active = false; d.combo = 0; d.time = 0;
        return;
      }
      d.idle += dt;
      if (d.idle > 0.7) {
        const pts = Math.round(d.combo * d.mult);
        if (pts >= 20) {
          d.total += pts;
          this._flashDrift(r, `+${fmtPoints(pts)}`);
          audio.driftBank(r.pan || 0);
        }
        d.active = false; d.combo = 0; d.time = 0;
      }
    }
  }

  _emitParticles(r, dt) {
    const car = r.car;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    const rx = -fy, ry = fx;
    const drift = car.driftAmount > 0.4 && car.speed > 70;
    const lockBrake = car.braking && car.forwardSpeed > 220 && car.brakeHeld > 0.4;
    const dusty = r.offTrack && car.speed > 60;
    const rear = r.model.wheels.filter((w) => !w.front);
    const y = r.roadH * S + 0.045;
    for (const w of rear) {
      const wx = car.x * S + fx * w.x + rx * w.pivot.position.z;
      const wz = car.y * S + fy * w.x + ry * w.pivot.position.z;
      this.effects.skid.track(`${this.racers.indexOf(r)}-${w.side}`, (drift || lockBrake) && !r.offTrack, wx, y, wz, rx, ry, 0.14);
    }
    if (!(drift || dusty)) { r.emitAcc = 0; return; }
    r.emitAcc += dt;
    const interval = (dusty ? 0.025 : 0.035) * (r.isBot ? 2 : 1);
    while (r.emitAcc > interval) {
      r.emitAcc -= interval;
      for (const w of rear) {
        const wx = car.x * S + fx * w.x + rx * w.pivot.position.z;
        const wz = car.y * S + fy * w.x + ry * w.pivot.position.z;
        if (dusty) {
          this.effects.smoke.emit(wx, y + 0.3, wz, {
            vx: -car.vx * S * 0.15 + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(), vz: -car.vy * S * 0.15 + (Math.random() - 0.5) * 2,
            life: 1.0 + Math.random() * 0.6, size0: 1.0, size1: 4.5, alpha: 0.5, color: this.world.theme.dust,
          });
        } else {
          this.effects.smoke.emit(wx, y + 0.25, wz, {
            vx: (Math.random() - 0.5) * 1.5, vy: 0.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.5,
            life: 1.3 + Math.random() * 0.7, size0: 0.8, size1: 4.0 + car.driftAmount * 2, alpha: 0.28 + car.driftAmount * 0.25, color: 0xe6e6e6,
          });
        }
      }
    }
  }

  // --------------------------- rendering ---------------------------
  _updateRacerVisual(r, dt) {
    const car = r.car;
    const m = r.model;
    const track = this.track;
    if (dt === 0) {
      const cp = track.closestPointOnTrack(car.x, car.y, r.trackIdx);
      r.roadH = cp.h;
    }
    const pts = track.centerline;
    const n = pts.length;
    const p = pts[r.trackIdx], pn = pts[(r.trackIdx + 1) % n];
    const headingDot = Math.cos(car.angle) * p.tx + Math.sin(car.angle) * p.ty;
    const slopeAngle = Math.atan(((pn.h - p.h) / track.step) * headingDot);
    m.root.position.set(car.x * S, r.roadH * S, car.y * S);
    m.root.rotation.set(0, -car.angle, slopeAngle);
    const roll = THREE.MathUtils.clamp(-car.accelLat * 0.00012, -0.08, 0.08);
    const pitch = THREE.MathUtils.clamp(car.accelLong * 0.00007, -0.05, 0.05);
    m.body.rotation.x = roll;
    m.body.rotation.z = pitch;
    for (const w of m.wheels) {
      if (w.front) w.pivot.rotation.y = -car.steerVisual * 0.42;
      w.spinner.rotation.z = -car.wheelSpin;
    }
    const night = this.world.theme.night;
    m.tailMat.emissiveIntensity = car.braking ? 4 : (night ? 1.2 : 0.5);
  }

  _snapCameras() {
    for (const r of this.humans) {
      r.rig.yaw = r.car.angle;
      r.rig.y = null;
      this._updateCamera(r, 0, true);
    }
  }

  _updateCamera(r, dt, snap = false) {
    const car = r.car;
    const cam = r.camera;
    const mode = CAMERA_MODES[gameSettings.camera] || CAMERA_MODES.near;
    const speed = car.speed;
    const speedRatio = Math.min(1.2, speed / 500);
    let targetYaw = car.angle;
    if (speed > 40 && car.forwardSpeed > 0) {
      const velAngle = Math.atan2(car.vy, car.vx);
      targetYaw = car.angle + angleDiff(velAngle, car.angle) * 0.45;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 4.2);
    r.rig.yaw += angleDiff(targetYaw, r.rig.yaw) * k;

    let intro = 0;
    if (this.state === 'countdown') intro = Math.max(0, 1 - this.countdownT / 2.6);
    else if (this.state === 'idle') intro = 1;
    const ease = intro * intro * (3 - 2 * intro);
    const yaw = r.rig.yaw + ease * 1.3;
    const dist = mode.dist + speedRatio * 1.3 + ease * 14;
    const height = mode.height + ease * 7;

    const cx = car.x * S - Math.cos(yaw) * dist;
    const cz = car.y * S - Math.sin(yaw) * dist;
    let cy = r.roadH * S + height;
    const ground = this.world.heightAt(cx / S, cz / S) * S + 0.8;
    if (cy < ground) cy = ground;
    if (r.rig.y == null || snap) r.rig.y = cy;
    r.rig.y += (cy - r.rig.y) * (1 - Math.exp(-dt * 7));

    let sx = 0, sy = 0, sz = 0;
    if (r.rig.shake > 0) {
      const a = r.rig.shake;
      sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; sz = (Math.random() - 0.5) * a;
      r.rig.shake = Math.max(0, r.rig.shake - dt * 1.6);
    }
    cam.position.set(cx + sx, r.rig.y + sy, cz + sz);
    const fwdX = Math.cos(r.rig.yaw), fwdZ = Math.sin(r.rig.yaw);
    cam.lookAt(car.x * S + fwdX * mode.ahead * (1 - ease), r.roadH * S + mode.look, car.y * S + fwdZ * mode.ahead * (1 - ease));
    const fov = mode.fov + speedRatio * 12;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  _render() {
    if (!this.world || !this.viewRects) return;
    const R = this.renderer;
    const H = window.innerHeight;
    R.setScissorTest(true);
    this.humans.forEach((r, i) => {
      const rect = this.viewRects[i];
      const aspect = rect.w / rect.h;
      if (Math.abs(r.camera.aspect - aspect) > 1e-4) { r.camera.aspect = aspect; r.camera.updateProjectionMatrix(); }
      this.world.prepareView(r.camera);
      R.setViewport(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      R.setScissor(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      R.render(this.scene, r.camera);
    });
    R.setScissorTest(false);
  }

  _resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H, false);
    if (this.humans.length) this._layoutViews();
  }

  // --------------------------- HUD ---------------------------
  _setText(r, key, el, value) {
    if (!el) return;
    if (r.hud._cache[key] !== value) { r.hud._cache[key] = value; el.textContent = value; }
  }

  _message(r, text, kind = '') {
    const el = r.hud.msg;
    el.textContent = text;
    el.className = `v-msg ${kind}`;
    void el.offsetWidth;
    el.classList.add('show');
  }

  _flashDrift(r, text, bad = false) {
    const el = r.hud.drift;
    el.textContent = text;
    el.className = `v-drift flash ${bad ? 'bad' : 'good'}`;
    r.driftFlashUntil = performance.now() + 1100;
  }

  _updateHud(ts) {
    const n = this.track.centerline.length;
    const running = this.state === 'racing' || this.state === 'raceOver';
    for (const r of this.humans) {
      const h = r.hud;
      const car = r.car;
      const kmh = Math.round((car.speed * S) * 3.6);
      this._setText(r, 'speed', h.speed, String(kmh));
      this._setText(r, 'gear', h.gear, car.displayGear);
      this._drawGauge(r, car.rpm, car.shifting);

      const lapShown = Math.min(r.lap + 1, this.mode === 'race' ? this.laps : Infinity);
      this._setText(r, 'lap', h.lapN, String(lapShown));
      let lapElapsed = 0;
      if (running && !r.finished) lapElapsed = ts - r.lapStartTime;
      else if (r.finished) lapElapsed = r.finishTime || 0;
      this._setText(r, 'time', h.time, formatTime(lapElapsed));
      this._setText(r, 'best', h.best, r.bestLapTime ? formatTime(r.bestLapTime) : '--');
      this._setText(r, 'last', h.last, r.lastLapTime ? formatTime(r.lastLapTime) : '--');
      if (h.ghostT) this._setText(r, 'ghost', h.ghostT, this.ghost.bestTime ? formatTime(this.ghost.bestTime) : t('hud.ghostNone'));
      if (h.posN) this._setText(r, 'pos', h.posN, String(r.position));
      this._setText(r, 'dtot', h.driftTotal, fmtPoints(r.drift.total));
      if (h.standings && this.standings) {
        const html = this.standings.map((o) => `<div class="st-row${o === r ? ' me' : ''}" style="--c:${o.color}"><span>${o.position}.</span><i></i>${escapeHtml(o.label)}${o.finished ? ' 🏁' : ''}</div>`).join('');
        if (h._cache.standings !== html) { h._cache.standings = html; h.standings.innerHTML = html; }
      }

      let idx = r.trackIdx;
      if (r.lap === 0 && r.expectedCheckpoint <= 1 && idx > n / 2) idx = 0;
      h.progress.style.width = `${((idx / n) * 100).toFixed(1)}%`;

      if (r.drift.active && r.drift.combo > 5) {
        this._setText(r, 'drift', h.drift, `DRIFT ${fmtPoints(r.drift.combo)}  ×${r.drift.mult}`);
        if (!h.drift.classList.contains('live')) h.drift.className = 'v-drift live';
      } else if (!r.driftFlashUntil || performance.now() > r.driftFlashUntil) {
        if (h.drift.className !== 'v-drift') { h.drift.className = 'v-drift'; r.hud._cache.drift = null; }
      } else {
        r.hud._cache.drift = null;
      }

      h.wrongway.classList.toggle('hidden', !(r.wrongWayTime > 0.8));
      this._drawMinimap(r);
    }
  }

  // Rev counter: the arc shows the engine rpm, with a red zone.
  _drawGauge(r, rpm, shifting) {
    const c = r.hud.gauge;
    const ctx = c.getContext('2d');
    const s = r.gaugeSize;
    const q = Math.round(Math.min(1.02, rpm) * 60);
    const key = `${q}|${shifting}`;
    if (r._gaugeKey === key) return;
    r._gaugeKey = key;
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2, rad = s * 0.42;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const red = 0.88;
    ctx.lineCap = 'butt';
    ctx.lineWidth = s * 0.07;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a0 + (a1 - a0) * red); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,60,50,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0 + (a1 - a0) * red, a1); ctx.stroke();
    const frac = Math.max(0, Math.min(1, q / 60));
    const grad = ctx.createLinearGradient(0, s, s, 0);
    grad.addColorStop(0, r.color);
    grad.addColorStop(1, '#ffffff');
    ctx.strokeStyle = shifting ? '#ffc53d' : frac > red ? '#ff4b3a' : grad;
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a0 + (a1 - a0) * frac + 0.0001); ctx.stroke();
    ctx.lineWidth = s * 0.012;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i <= 8; i++) {
      const a = a0 + ((a1 - a0) * i) / 8;
      const r1 = rad - s * 0.07, r2 = rad - s * (i % 2 === 0 ? 0.13 : 0.1);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
  }

  _drawMinimap(r) {
    const c = r.hud.minimap;
    const ctx = c.getContext('2d');
    const { scale, ox, oy, dpr } = r.mm;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(r.mmBg, 0, 0);
    const drawCar = (x, y, angle, color, sz, stroke = '#000') => {
      ctx.save();
      ctx.translate(x * scale + ox, y * scale + oy);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.8, sz * 0.7); ctx.lineTo(-sz * 0.8, -sz * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    if (this.ghost && this.ghost.model && this.ghost.model.root.visible) {
      const g = this.ghost.model.root;
      drawCar(g.position.x / S, g.position.z / S, -g.rotation.y, 'rgba(200,215,240,0.6)', 5 * dpr, 'rgba(0,0,0,0.3)');
    }
    for (const o of this.racers) {
      if (o === r) continue;
      drawCar(o.car.x, o.car.y, o.car.angle, o.color, (o.isBot ? 4.5 : 5.5) * dpr);
    }
    drawCar(r.car.x, r.car.y, r.car.angle, r.color, 7 * dpr, '#fff');
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
