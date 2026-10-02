import { S } from './world.js';
import { buildCarModel, makeNameTag } from './carmodel.js';
import { getVehicleById } from './vehicles.js';
import { t } from './i18n.js';

// Ghost car: replays the chosen player's (P1 or P2) best lap as a
// see-through car. The best ghost lap of each track is saved in the browser,
// so there is someone to race against in a new session too.
// It can't be hit; it only shows the pace to beat.

const KEY = (trackId) => `driftgame2_ghost_${trackId}`;
const SAMPLE_MS = 50;
const FIELDS = 5; // samples are flat: [t, x, y, angle, trackIdx, t, x, ...]

// Validates a saved ghost so a corrupted / hand-edited entry can't produce
// NaN positions or crash the replay.
function isValidGhost(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.samples)) return false;
  const s = g.samples;
  if (s.length < FIELDS * 3 || s.length % FIELDS !== 0) return false;
  if (!Number.isFinite(g.timeMs) || g.timeMs <= 0) return false;
  let prevT = -Infinity;
  for (let i = 0; i < s.length; i++) {
    if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return false;
    if (i % FIELDS === 0) {
      if (s[i] < prevT) return false;
      prevT = s[i];
    }
  }
  return true;
}

export function loadGhost(trackId, centerlineLength) {
  try {
    const g = JSON.parse(localStorage.getItem(KEY(trackId)));
    if (isValidGhost(g)) {
      // the track index must exist (the track geometry may have changed since)
      for (let i = 4; i < g.samples.length; i += FIELDS) {
        const idx = g.samples[i];
        if (!Number.isInteger(idx) || idx < 0 || idx >= centerlineLength) return null;
      }
      return g;
    }
  } catch { /* ignore */ }
  return null;
}

function saveGhost(trackId, ghost) {
  try { localStorage.setItem(KEY(trackId), JSON.stringify(ghost)); } catch { /* ignore */ }
}

export class Ghost {
  // owner: the racer (P1 or P2) whose laps are recorded
  constructor(scene, track, owner) {
    this.scene = scene;
    this.track = track;
    this.owner = owner;
    this.recording = [];
    this.lastSampleT = -Infinity;
    this.best = loadGhost(track.id, track.centerline.length); // { timeMs, vehicleId, color, name, samples }
    this.model = null;
    this.hint = null;
    this._buildModel();
  }

  _buildModel() {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.model = null;
    }
    if (!this.best) return;
    const vehicle = getVehicleById(this.best.vehicleId);
    const color = typeof this.best.color === 'string' && /^#[0-9a-f]{6}$/i.test(this.best.color) ? this.best.color : '#9fd8ff';
    const m = buildCarModel(vehicle, color);
    m.root.traverse((o) => {
      if (!o.material) return;
      o.castShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity, 0.38);
        mat.depthWrite = false;
      }
    });
    const tag = makeNameTag(t('hud.ghostTag'), '#6a7a99');
    tag.scale.set(2.2, 0.8, 1);
    tag.position.set(0, 2.2, 0);
    m.root.add(tag);
    m.root.visible = false;
    this.scene.add(m.root);
    this.model = m;
  }

  get bestTime() { return this.best ? this.best.timeMs : null; }

  // every frame: record + replay
  update(ts, running) {
    const r = this.owner;
    const t = ts - r.lapStartTime;
    if (running && !r.finished && t - this.lastSampleT >= SAMPLE_MS) {
      this.lastSampleT = t;
      this.recording.push(Math.round(t), Math.round(r.car.x * 10) / 10, Math.round(r.car.y * 10) / 10,
        Math.round(r.car.angle * 1000) / 1000, r.trackIdx);
    }
    if (!this.model) return;
    const s = this.best.samples;
    const count = s.length / FIELDS;
    const lastT = s[(count - 1) * 5];
    if (!running || t < 0 || t > lastT) { this.model.root.visible = false; return; }
    // binary search in the samples
    let lo = 0, hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid * 5] <= t) lo = mid; else hi = mid;
    }
    const a = lo * 5, b = hi * 5;
    const span = s[b] - s[a] || 1;
    const f = Math.max(0, Math.min(1, (t - s[a]) / span));
    const x = s[a + 1] + (s[b + 1] - s[a + 1]) * f;
    const y = s[a + 2] + (s[b + 2] - s[a + 2]) * f;
    let da = s[b + 3] - s[a + 3];
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const ang = s[a + 3] + da * f;
    const idx = s[a + 4];
    const h = this.track.closestPointOnTrack(x, y, idx).h;
    const root = this.model.root;
    root.visible = true;
    root.position.set(x * S, h * S, y * S);
    root.rotation.set(0, -ang, 0);
    const spin = (x - (this._px ?? x)) + (y - (this._py ?? y));
    this._px = x; this._py = y;
    for (const w of this.model.wheels) w.spinner.rotation.z -= Math.abs(spin) * 0.3;
  }

  // the owner starts a new lap
  lapStarted() {
    this.recording = [];
    this.lastSampleT = -Infinity;
  }

  // the owner finished a lap; returns the difference to the ghost (ms) or null
  lapFinished(lapTimeMs) {
    const r = this.owner;
    const prevBest = this.best ? this.best.timeMs : null;
    const delta = prevBest != null ? lapTimeMs - prevBest : null;
    // close the recording with a sample at the exact lap time
    this.recording.push(Math.round(lapTimeMs), Math.round(r.car.x * 10) / 10, Math.round(r.car.y * 10) / 10,
      Math.round(r.car.angle * 1000) / 1000, r.trackIdx);
    if (prevBest == null || lapTimeMs < prevBest) {
      this.best = {
        timeMs: lapTimeMs,
        vehicleId: r.player.vehicle.id,
        color: r.color,
        name: r.label,
        samples: this.recording,
      };
      saveGhost(this.track.id, this.best);
      this._buildModel();
    }
    this.lapStarted();
    return delta;
  }

  dispose() {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
}

