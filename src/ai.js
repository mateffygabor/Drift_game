import { t } from './i18n.js';

// Bots. They press the same 4 digital "buttons" (gas / brake / left / right)
// as the players and are moved by the same physics - no cheating; the
// difficulty level only sets their cornering speed and engine power.

export const BOT_LEVELS = {
  easy: { corner: 0.82, power: 0.9, look: 1.0 },
  medium: { corner: 0.93, power: 0.96, look: 1.0 },
  hard: { corner: 1.03, power: 1.0, look: 1.05 },
};

// Bot names in the current language.
export function botNames() {
  return t('bot.names').split('|');
}

// Racing line: outside before a corner, inside at the apex. Computed from the
// track's signed curvature, smoothed so the bot "prepares" for the corner early.
export function computeRacingLine(track) {
  const pts = track.centerline;
  const n = pts.length;
  const k = 4;
  const curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[(i + k) % n];
    const cross = a.tx * b.ty - a.ty * b.tx; // + = right-hand corner
    curv[i] = cross / (2 * k * track.step);
  }
  // smoothing (forwards and backwards) so the line is continuous
  let sm = curv;
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -6; j <= 6; j++) s += sm[(i + j + n) % n];
      next[i] = s / 13;
    }
    sm = next;
  }
  const maxOff = track.roadWidth * 0.3;
  const offsets = new Float32Array(n);
  for (let i = 0; i < n; i++) offsets[i] = Math.max(-maxOff, Math.min(maxOff, sm[i] * 150 * maxOff));
  return { curv, offsets };
}

export class BotDriver {
  constructor(racer, track, line, level = 'medium', laneSeed = 0) {
    this.racer = racer;
    this.track = track;
    this.line = line;
    this.level = BOT_LEVELS[level] || BOT_LEVELS.medium;
    this.lane = (laneSeed - 0.5) * track.roadWidth * 0.25;
    this.input = { gas: false, brake: false, left: false, right: false };
    this.stuckTime = 0;
    this.avoid = 0;
    this.cruise = false; // cool-down lap after finishing
  }

  update(dt, racers) {
    const r = this.racer;
    const car = r.car;
    const track = this.track;
    const pts = track.centerline;
    const n = pts.length;
    const speed = Math.max(0, car.forwardSpeed);
    const inp = this.input;

    // --- avoidance: if someone is right ahead, move to the side ---
    let avoidTarget = 0;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    for (const o of racers) {
      if (o === r) continue;
      const dx = o.car.x - car.x, dy = o.car.y - car.y;
      const ahead = dx * fx + dy * fy;
      const side = -dx * fy + dy * fx;
      if (ahead > 0 && ahead < 140 && Math.abs(side) < 38 && Math.abs(o.roadH - r.roadH) < 30) {
        avoidTarget = side > 0 ? -45 : 45;
      }
    }
    this.avoid += (avoidTarget - this.avoid) * (1 - Math.exp(-dt * 3));

    // --- steer towards a look-ahead target point ---
    const lookDist = (55 + speed * 0.32) * this.level.look;
    const la = Math.max(3, Math.round(lookDist / track.step));
    const ti = (r.trackIdx + la) % n;
    const tp = pts[ti];
    const maxLat = track.roadWidth / 2 - 18;
    const lat = Math.max(-maxLat, Math.min(maxLat, this.line.offsets[ti] + this.lane + this.avoid));
    const tx = tp.x + tp.nx * lat, ty = tp.y + tp.ny * lat;
    let d = Math.atan2(ty - car.y, tx - car.x) - car.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const dead = 0.035;
    inp.left = d < -dead;
    inp.right = d > dead;

    // --- speed: matched to the sharpest corner within braking distance ---
    const brakeDist = (speed * speed) / (2 * 500) + 60;
    const steps = Math.min(n - 1, Math.ceil(brakeDist / track.step));
    let target = car.maxSpeed;
    for (let j = 2; j <= steps; j += 2) {
      const c = Math.abs(this.line.curv[(r.trackIdx + j) % n]);
      if (c < 1e-5) continue;
      const vCorner = 16.5 * this.level.corner * Math.sqrt(1 / c);
      // how fast we may go now to still slow down in time
      const dist = j * track.step;
      const allowed = Math.sqrt(vCorner * vCorner + 2 * 420 * dist);
      if (allowed < target) target = allowed;
    }
    if (this.cruise) target = Math.min(target, car.maxSpeed * 0.45);
    if (speed > target + 12) {
      // don't steer sharply while braking (it would start a drift)
      inp.brake = true; inp.gas = false;
      if (Math.abs(d) < 0.25) { inp.left = false; inp.right = false; }
    } else {
      inp.brake = false;
      inp.gas = speed < target - 4 || speed < 60;
    }

    // --- stuck detection: if it stands still for long, the game resets it ---
    if (speed < 15 && !this.cruise) this.stuckTime += dt; else this.stuckTime = 0;
    return inp;
  }
}
