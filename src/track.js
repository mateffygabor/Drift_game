import { t } from './i18n.js';

// Track geometry.
//
// A track is given as the vertices of a polygon: [x, y, height, cornerRadius].
// Every corner is rounded with a true circular arc (filletPolyline), so the
// corner radii are exactly controlled and there are none of the "overshoots"
// typical of splines. The resulting dense point list is resampled at even
// spacing, and the heights are smoothed so hills and slopes are continuous.
//
// The physics is 2D (x, y); the height (h) is only used for rendering and to
// tell the upper and lower legs of the bridge apart.

export const SPACING = 13; // distance between two centreline points (physics units)

export function filletPolyline(verts) {
  const n = verts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = verts[(i - 1 + n) % n];
    const [bx, by, bh, r] = verts[i];
    const [cx, cy] = verts[(i + 1) % n];
    let dix = bx - ax, diy = by - ay;
    const l1 = Math.hypot(dix, diy); dix /= l1; diy /= l1;
    let dox = cx - bx, doy = cy - by;
    const l2 = Math.hypot(dox, doy); dox /= l2; doy /= l2;
    const th = Math.atan2(dix * doy - diy * dox, dix * dox + diy * doy);
    if (!r || Math.abs(th) < 0.01) {
      out.push({ x: bx, y: by, h: bh });
      continue;
    }
    const t = r * Math.tan(Math.abs(th) / 2);
    const t1x = bx - dix * t, t1y = by - diy * t;
    const s = th > 0 ? 1 : -1;
    const ccx = t1x - diy * s * r, ccy = t1y + dix * s * r;
    const a0 = Math.atan2(t1y - ccy, t1x - ccx);
    const k = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 45)));
    for (let j = 0; j <= k; j++) {
      const a = a0 + (th * j) / k;
      out.push({ x: ccx + Math.cos(a) * r, y: ccy + Math.sin(a) * r, h: bh });
    }
  }
  return out;
}

function resampleEvenly(points, spacing) {
  const closed = [...points, points[0]];
  const segLen = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const d = Math.hypot(closed[i + 1].x - closed[i].x, closed[i + 1].y - closed[i].y);
    segLen.push(d);
    total += d;
  }
  const count = Math.max(8, Math.round(total / spacing));
  const step = total / count;
  const result = [];
  let segIdx = 0, segPos = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (segIdx < segLen.length - 1 && segPos + segLen[segIdx] < target) {
      segPos += segLen[segIdx];
      segIdx++;
    }
    const frac = segLen[segIdx] > 0 ? (target - segPos) / segLen[segIdx] : 0;
    const a = closed[segIdx], b = closed[segIdx + 1];
    result.push({
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      h: a.h + (b.h - a.h) * frac,
    });
  }
  return { points: result, length: total, step };
}

// Circular moving average of the heights (several passes ~ Gaussian smoothing).
function smoothHeights(points, halfWindow, passes) {
  const n = points.length;
  let hs = points.map((p) => p.h);
  for (let p = 0; p < passes; p++) {
    const next = new Array(n);
    let sum = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) sum += hs[(k + n) % n];
    for (let i = 0; i < n; i++) {
      next[i] = sum / (2 * halfWindow + 1);
      sum += hs[(i + halfWindow + 1) % n] - hs[(i - halfWindow + n) % n];
    }
    hs = next;
  }
  points.forEach((p, i) => { p.h = hs[i]; });
}

function pointSegClosest(px, py, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1e-6;
  let t = ((px - a.x) * abx + (py - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + abx * t, y = a.y + aby * t;
  const dx = px - x, dy = py - y;
  return { x, y, dist2: dx * dx + dy * dy, h: a.h + (b.h - a.h) * t };
}

const HASH_CELL = 200;
const hashKey = (i, j) => (i + 5000) * 10000 + (j + 5000);

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.difficulty = def.difficulty; // 'easy' | 'medium' | 'hard'
    this.theme = def.theme;
    this.roadWidth = def.roadWidth;
    this.runoffWidth = def.runoffWidth;
    this.curbWidth = 12;
    // A solid wall at the outer edge of the run-off area stops the cars.
    this.wallBoundary = def.roadWidth / 2 + def.runoffWidth;

    const dense = filletPolyline(def.verts);
    const { points, length, step } = resampleEvenly(dense, SPACING);
    smoothHeights(points, 20, 3);
    this.centerline = points;
    this.length = length;
    this.step = step;

    const n = points.length;
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      const p = points[i];
      p.tx = tx; p.ty = ty;
      p.nx = -ty; p.ny = tx; // points to the RIGHT of the driving direction
      p.s = i * step;
      p.bridge = def.bridgeHeight != null && p.h >= def.bridgeHeight;
    }

    this.checkpointCount = def.checkpointCount || 24;
    this.checkpointIndices = [];
    for (let k = 0; k < this.checkpointCount; k++) {
      this.checkpointIndices.push(Math.floor((k * n) / this.checkpointCount));
    }

    const p0 = points[0];
    this.startAngle = Math.atan2(p0.ty, p0.tx);
    this.startPos = { x: p0.x, y: p0.y };

    this.bounds = this._computeBounds();
    this._buildHash();
  }

  get name() { return t(`track.${this.id}.name`); }
  get description() { return t(`track.${this.id}.desc`); }
  get difficultyLabel() { return t(`diff.${this.difficulty}`); }

  _computeBounds() {
    const pad = this.wallBoundary + 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.centerline) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return {
      minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad,
      width: maxX - minX + pad * 2, height: maxY - minY + pad * 2,
    };
  }

  _buildHash() {
    this._hash = new Map();
    this.centerline.forEach((p, i) => {
      const key = hashKey(Math.floor(p.x / HASH_CELL), Math.floor(p.y / HASH_CELL));
      if (!this._hash.has(key)) this._hash.set(key, []);
      this._hash.get(key).push(i);
    });
  }

  // Indices of the centreline points within `radius` of (x, y).
  pointsNear(x, y, radius) {
    const r = Math.ceil(radius / HASH_CELL);
    const cx = Math.floor(x / HASH_CELL), cy = Math.floor(y / HASH_CELL);
    const out = [];
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        const list = this._hash.get(hashKey(i, j));
        if (list) for (const idx of list) out.push(idx);
      }
    }
    return out;
  }

  // Smallest distance from the centreline (used to place scenery).
  distanceToTrack(x, y, maxRadius = 800, ignoreBridge = false) {
    let best = Infinity;
    for (const i of this.pointsNear(x, y, maxRadius)) {
      const p = this.centerline[i];
      if (ignoreBridge && p.bridge) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) best = d;
    }
    return best;
  }

  isClear(x, y, margin) {
    return this.distanceToTrack(x, y, this.wallBoundary + margin + HASH_CELL) > this.wallBoundary + margin;
  }

  // Nearest centreline index. With a `hint` (last frame's index) only its
  // neighbourhood is searched, so at the crossing of the figure-eight a car
  // can't "jump" to the other leg (under / over the bridge).
  nearestIndex(x, y, hint = null) {
    const pts = this.centerline;
    const n = pts.length;
    let best = Infinity, bestIdx = 0;
    if (hint == null) {
      for (let i = 0; i < n; i++) {
        const dx = x - pts[i].x, dy = y - pts[i].y;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bestIdx = i; }
      }
      return bestIdx;
    }
    const W = 16;
    for (let k = -W; k <= W; k++) {
      const i = (hint + k + n) % n;
      const dx = x - pts[i].x, dy = y - pts[i].y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bestIdx = i; }
    }
    return bestIdx;
  }

  closestPointOnTrack(x, y, nearIdx) {
    const n = this.centerline.length;
    const p = this.centerline[nearIdx];
    const prev = this.centerline[(nearIdx - 1 + n) % n];
    const next = this.centerline[(nearIdx + 1) % n];
    const c1 = pointSegClosest(x, y, prev, p);
    const c2 = pointSegClosest(x, y, p, next);
    return c1.dist2 <= c2.dist2 ? c1 : c2;
  }

  // Starting grid: two cars per row (slightly staggered) behind the start line.
  gridSlot(index, count) {
    const p = this.centerline[0];
    const row = Math.floor(index / 2);
    const back = 26 + row * 64 + (index % 2) * 18;
    let lateral = 0;
    if (count > 1) lateral = (index % 2 === 0 ? -1 : 1) * Math.min(this.roadWidth * 0.22, 36);
    return {
      x: p.x - p.tx * back + p.nx * lateral,
      y: p.y - p.ty * back + p.ny * lateral,
      angle: this.startAngle,
    };
  }
}
