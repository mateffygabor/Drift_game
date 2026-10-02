import * as THREE from '../lib/three.module.js';
import {
  asphaltTexture, curbTexture, noiseTexture, detailTexture, wallTexture, checkerTexture,
  bannerTexture, crowdTexture, windowTextures, softCircleTexture, mulberry32,
} from './textures.js';
import { t } from './i18n.js';

// The 3D world of a track: themes, terrain, road, walls, bridge, start
// area, scenery and lights. Built once per race, disposed afterwards.

// Scale: physics works in its own "units", the 3D world in metres:
// 10 physics units = 1 metre.
export const S = 0.1;

// ---------------------------------------------------------------------------
// Themes: sky, fog, lights, terrain colours, wall style, scenery.
// ---------------------------------------------------------------------------
export const THEMES = {
  valley: {
    sky: { top: '#2f6fd0', horizon: '#cfe4f5', bottom: '#8fb07a' },
    fog: { color: '#cfe4f5', near: 120, far: 1100 },
    sun: { color: '#fff1d6', intensity: 2.6, dir: [0.55, 0.75, 0.35] },
    hemi: { sky: '#cfe6ff', ground: '#4d6b35', intensity: 1.0 },
    ground: { low: '#4f8f36', high: '#79a845', steep: '#7a6d5a', variation: 0.5 },
    runoff: { base: '#4b8a34', speckles: ['#5c9e3f', '#3f7a2c', '#6aa84a'], blades: 'rgba(40,90,30,0.5)' },
    wall: 'tires',
    roof: '#c8322a',
    dust: 0xc8b890,
    scenery: { trees: 750, pines: 0.3, rocks: 60, bushes: 200, ring: 'hills' },
    base: (n, x, y, d) => 32 * n.fbm(x / 1400, y / 1400) + Math.min(200, Math.max(0, d - 700) * 0.12),
  },
  sunset: {
    sky: { top: '#253a7a', horizon: '#ff9a55', bottom: '#5a4a50' },
    fog: { color: '#e99a6e', near: 120, far: 1000 },
    sun: { color: '#ffb070', intensity: 2.2, dir: [-0.8, 0.25, 0.3] },
    hemi: { sky: '#ffc9a0', ground: '#3e4a2a', intensity: 0.9 },
    ground: { low: '#5e7c32', high: '#8a8a3c', steep: '#6b5344', variation: 0.5 },
    runoff: { base: '#5e7c32', speckles: ['#6f8c3a', '#4e6a2a', '#7c9446'], blades: 'rgba(50,70,20,0.5)' },
    wall: 'stripes',
    roof: '#2a7de8',
    dust: 0xd0b090,
    scenery: { trees: 520, pines: 0.15, rocks: 40, bushes: 150, ring: 'hills', ferris: true },
    base: (n, x, y, d) => 20 * n.fbm(x / 1100, y / 1100) + Math.min(160, Math.max(0, d - 800) * 0.1),
  },
  alpine: {
    sky: { top: '#3b78c8', horizon: '#e4edf6', bottom: '#dfe7ef' },
    fog: { color: '#e1e9f2', near: 150, far: 1300 },
    sun: { color: '#ffffff', intensity: 2.4, dir: [0.4, 0.8, -0.45] },
    hemi: { sky: '#dbe9ff', ground: '#9aa4ae', intensity: 1.1 },
    ground: { low: '#eef3f8', high: '#dfe7ef', steep: '#6c6660', variation: 0.2, snow: true },
    runoff: { base: '#9a9994', speckles: ['#8a8984', '#b0afa9', '#7d7c78', '#f0f0f0'] },
    wall: 'armco',
    roof: '#2f6fd0',
    dust: 0xf4f6fa,
    scenery: { trees: 950, pines: 1.0, rocks: 120, bushes: 0, ring: 'mountains' },
    base: (n, x, y, d) => 45 * n.fbm(x / 900, y / 900) + Math.min(1100, Math.max(0, d - 330) * 0.6) * (0.75 + 0.5 * n.fbm(x / 600 + 9, y / 600)),
  },
  city: {
    night: true,
    sky: { top: '#03050c', horizon: '#1d2744', bottom: '#0b0f1a' },
    fog: { color: '#141b2e', near: 60, far: 700 },
    sun: { color: '#9fb4ff', intensity: 0.55, dir: [-0.3, 0.8, 0.4] },
    hemi: { sky: '#34466e', ground: '#15161a', intensity: 0.55 },
    ground: { low: '#3a3c42', high: '#44464d', steep: '#3a3c42', variation: 0.15 },
    runoff: { base: '#77777a', speckles: ['#6a6a6d', '#86868a', '#5f5f62'] },
    wall: 'concrete',
    roof: '#444',
    dust: 0x9a9aa0,
    scenery: { buildings: true, streetlights: true, ring: null },
    base: () => -1,
  },
  desert: {
    sky: { top: '#3d7fd0', horizon: '#f2d6a8', bottom: '#d2a26a' },
    fog: { color: '#eed2a4', near: 150, far: 1300 },
    sun: { color: '#fff0d0', intensity: 3.0, dir: [0.3, 0.85, 0.4] },
    hemi: { sky: '#f7e2c0', ground: '#b5773f', intensity: 1.0 },
    ground: { low: '#d9a867', high: '#e6bd80', steep: '#b0552e', variation: 0.4, canyon: true },
    runoff: { base: '#c9965a', speckles: ['#b8844a', '#dcae70', '#a87440'] },
    wall: 'stripes',
    roof: '#e8322a',
    dust: 0xd9b07a,
    scenery: { cacti: 260, rocks: 160, ring: 'mesas' },
    base: (n, x, y, d) => 18 * Math.abs(n.fbm(x / 700, y / 700)) + smoothstep(450, 720, d) * (300 + 90 * n.fbm(x / 500, y / 500)),
  },
};

export const QUALITY = {
  high: { shadow: 4096, pixelRatio: 2, scenery: 1, terrainStep: 50 },
  medium: { shadow: 2048, pixelRatio: 1.25, scenery: 0.6, terrainStep: 70 },
  low: { shadow: 0, pixelRatio: 0.85, scenery: 0.3, terrainStep: 100 },
};

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const lat = (ix, iy) => vals[perm[(perm[ix & 255] + (iy & 255)) & 511]];
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function fbm(x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return s;
  }
  return { noise, fbm };
}

// Simple geometry merge (non-indexed) to save draw calls.
function mergeGeometries(geoms) {
  const attrs = ['position', 'normal', 'uv'];
  const arrays = { position: [], normal: [], uv: [] };
  let hasColor = geoms.every((g) => g.getAttribute('color'));
  if (hasColor) { attrs.push('color'); arrays.color = []; }
  for (let g of geoms) {
    if (g.index) g = g.toNonIndexed();
    for (const a of attrs) {
      const attr = g.getAttribute(a);
      if (attr) arrays[a].push(...attr.array);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3));
  if (arrays.uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  if (hasColor) out.setAttribute('color', new THREE.Float32BufferAttribute(arrays.color, 3));
  return out;
}

function colorize(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// ---------------------------------------------------------------------------
// Ribbon along the track: between two lateral offsets (a, b).
// ---------------------------------------------------------------------------
function ribbonGeometry(track, { a, b, yA = 0, yB = 0, vLen = 100, alongU = false, filter = null }) {
  const pts = track.centerline;
  const n = pts.length;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n];
    const s = i === n ? track.length : p.s;
    const rows = [[a, yA, 0], [b, yB, 1]];
    for (let k = 0; k < 2; k++) {
      const [off, yo, u] = rows[k];
      const vi = (i * 2 + k) * 3;
      pos[vi] = (p.x + p.nx * off) * S;
      pos[vi + 1] = (p.h + yo) * S;
      pos[vi + 2] = (p.y + p.ny * off) * S;
      const ti = (i * 2 + k) * 2;
      if (alongU) { uv[ti] = s / vLen; uv[ti + 1] = u; } else { uv[ti] = u; uv[ti + 1] = s / vLen; }
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    if (filter && !(filter(i) && filter((i + 1) % n))) continue;
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Sky: gradient sphere + sun glow, follows the camera.
// ---------------------------------------------------------------------------
function buildSky(theme) {
  const sunDir = new THREE.Vector3(...theme.sun.dir).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky.top) },
      horizon: { value: new THREE.Color(theme.sky.horizon) },
      bottom: { value: new THREE.Color(theme.sky.bottom) },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color(theme.sun.color) },
      sunSize: { value: theme.night ? 3000.0 : 900.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(min(-h * 4.0, 1.0), 0.6));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, sunSize) * 3.0 + pow(s, 12.0) * 0.28);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  sphere.frustumCulled = false;
  sphere.renderOrder = -10;
  sky.add(sphere);
  if (theme.night) {
    const rand = mulberry32(42);
    const count = 1600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * Math.PI * 2, v = Math.acos(0.05 + rand() * 0.95);
      pos[i * 3] = Math.sin(v) * Math.cos(u) * 1400;
      pos[i * 3 + 1] = Math.cos(v) * 1400;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 1400;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    stars.frustumCulled = false;
    sky.add(stars);
    // moon
    const moon = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0xf3f0dc, fog: false }));
    moon.position.copy(sunDir.clone().multiplyScalar(1300));
    moon.lookAt(0, 0, 0);
    sky.add(moon);
  }
  return sky;
}

// ---------------------------------------------------------------------------
// The world: terrain, track, scenery, lights.
// ---------------------------------------------------------------------------
export class World {
  constructor(track, qualityKey = 'high') {
    this.track = track;
    this.theme = THEMES[track.theme];
    this.quality = QUALITY[qualityKey] || QUALITY.high;
    this.scene = new THREE.Scene();
    this.rand = mulberry32(1234);
    this.noise = makeNoise(77);
    this.animated = [];
    this._disposables = [];

    const theme = this.theme;
    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    this.scene.background = new THREE.Color(theme.fog.color);

    this.sky = buildSky(theme);
    this.scene.add(this.sky);

    this._buildLights();
    this._buildHeightFunction();
    this._buildTerrain();
    this._buildTrackSurface();
    this._buildBridge();
    this._buildStartArea();
    this._buildScenery();
  }

  // --------------------------- lights ---------------------------
  _buildLights() {
    const t = this.theme;
    const hemi = new THREE.HemisphereLight(t.hemi.sky, t.hemi.ground, t.hemi.intensity);
    this.scene.add(hemi);

    const b = this.track.bounds;
    const cx = (b.minX + b.width / 2) * S, cz = (b.minY + b.height / 2) * S;
    const half = (Math.max(b.width, b.height) / 2) * S + 40;
    const dir = new THREE.Vector3(...t.sun.dir).normalize();
    const sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    sun.position.set(cx + dir.x * 400, dir.y * 400, cz + dir.z * 400);
    sun.target.position.set(cx, 0, cz);
    this.scene.add(sun, sun.target);
    if (this.quality.shadow && !t.night) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 10; sc.far = 1000;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.04;
    }
    this.sun = sun;
  }

  // --------------------------- terrain ---------------------------
  // Near the track the terrain follows the track height (embankments /
  // cuttings); further away it blends into the theme's own landscape. Bridge
  // points are skipped so the ground doesn't "grow" up under the bridge.
  _buildHeightFunction() {
    const track = this.track;
    const wb = track.wallBoundary;
    const theme = this.theme;
    const noise = this.noise;
    const R = 520;
    // the flat strip next to the track extends at least one terrain cell past the
    // wall, otherwise triangle interpolation could "pierce" the run-off area
    const flat = wb + 12 + this.quality.terrainStep;
    // thinned point list to estimate the track distance of far points (outside R)
    const coarse = track.centerline.filter((_, i) => i % 6 === 0);
    const farDist = (x, y) => {
      let best = Infinity;
      for (const p of coarse) {
        const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    this.terrainInfo = (x, y) => {
      let dmin = Infinity, hNear = 0, wsum = 0, hsum = 0;
      for (const i of track.pointsNear(x, y, R)) {
        const p = track.centerline[i];
        if (p.bridge) continue;
        const dx = p.x - x, dy = p.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < dmin) { dmin = d; hNear = p.h; }
        if (d < R) {
          const w = 1 / (d * d * d * d + 1);
          wsum += w; hsum += w * p.h;
        }
      }
      if (!isFinite(dmin)) {
        const d = Math.max(R, farDist(x, y));
        return { h: theme.base(noise, x, y, d), d };
      }
      const base = theme.base(noise, x, y, dmin);
      const hRoad = hNear + ((wsum > 0 ? hsum / wsum : hNear) - hNear) * smoothstep(flat, flat + 80, dmin);
      if (dmin <= flat) return { h: hNear - 3, d: dmin };
      return { h: hRoad - 3 + (base - (hRoad - 3)) * smoothstep(flat, flat + 220, dmin), d: dmin };
    };
    // this exact function is used while placing scenery; once the terrain is
    // built, heightAt returns the ACTUAL (triangulated) surface
    this.heightAt = (x, y) => this.terrainInfo(x, y).h;
  }

  _buildTerrain() {
    const b = this.track.bounds;
    const margin = 3600;
    const step = this.quality.terrainStep;
    const x0 = b.minX - margin, y0 = b.minY - margin;
    const nx = Math.ceil((b.width + margin * 2) / step) + 1;
    const ny = Math.ceil((b.height + margin * 2) / step) + 1;
    const heights = new Float32Array(nx * ny);
    const dists = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const info = this.terrainInfo(x0 + i * step, y0 + j * step);
        heights[j * nx + i] = info.h;
        dists[j * nx + i] = info.d;
      }
    }
    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    const g = this.theme.ground;
    const cLow = new THREE.Color(g.low), cHigh = new THREE.Color(g.high), cSteep = new THREE.Color(g.steep);
    const tmp = new THREE.Color();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = x0 + i * step, y = y0 + j * step;
        const h = heights[k];
        pos[k * 3] = x * S; pos[k * 3 + 1] = h * S; pos[k * 3 + 2] = y * S;
        uv[k * 2] = x / 160; uv[k * 2 + 1] = y / 160;
        // slope from the neighbours
        const hx = heights[j * nx + Math.min(nx - 1, i + 1)] - heights[j * nx + Math.max(0, i - 1)];
        const hy = heights[Math.min(ny - 1, j + 1) * nx + i] - heights[Math.max(0, j - 1) * nx + i];
        const slope = Math.hypot(hx, hy) / (2 * step);
        const n = this.noise.fbm(x / 500, y / 500) * 0.5 + 0.5;
        tmp.copy(cLow).lerp(cHigh, Math.min(1, n * g.variation * 2));
        let steepMix = smoothstep(0.45, 0.9, slope);
        if (g.canyon) steepMix = Math.max(steepMix, smoothstep(120, 260, h) * 0.85);
        tmp.lerp(cSteep, steepMix);
        // the strip next to the track is a little more worn
        const nearRoad = 1 - smoothstep(this.track.wallBoundary, this.track.wallBoundary + 120, dists[k]);
        tmp.multiplyScalar(1 - nearRoad * 0.12);
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b2 = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrainExtent = { x0, y0, x1: x0 + (nx - 1) * step, y1: y0 + (ny - 1) * step };
    const exact = this.heightAt;
    this.heightAt = (x, y) => {
      const gx = (x - x0) / step, gy = (y - y0) / step;
      const i = Math.floor(gx), j = Math.floor(gy);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return exact(x, y);
      const fx = gx - i, fy = gy - j;
      const a = heights[j * nx + i], b2 = heights[j * nx + i + 1];
      const c = heights[(j + 1) * nx + i], d = heights[(j + 1) * nx + i + 1];
      // same triangle split as in the mesh (diagonal: b - c)
      if (fx + fy <= 1) return a + (b2 - a) * fx + (c - a) * fy;
      return d + (c - d) * (1 - fx) + (b2 - d) * (1 - fy);
    };

    // endless "base" plane beyond the terrain edge (hidden by fog)
    const far = new THREE.Mesh(
      new THREE.CircleGeometry(4000, 32).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: this.theme.ground.low }),
    );
    far.position.set((b.minX + b.width / 2) * S, -3, (b.minY + b.height / 2) * S);
    this.scene.add(far);
  }

  // --------------------------- track surface ---------------------------
  _buildTrackSurface() {
    const track = this.track;
    const theme = this.theme;
    const rw = track.roadWidth;
    const cw = track.curbWidth;
    const wb = track.wallBoundary;

    const asphalt = asphaltTexture({ night: !!theme.night });
    const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: theme.night ? 0.55 : 0.88, metalness: 0.05 });
    const road = new THREE.Mesh(ribbonGeometry(track, { a: -rw / 2, b: rw / 2, vLen: rw * 2 }), roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.7 });
    for (const side of [-1, 1]) {
      const a = side * (rw / 2), b = side * (rw / 2 + cw);
      const g = ribbonGeometry(track, { a: Math.min(a, b), b: Math.max(a, b), yA: side < 0 ? 0.6 : 0.2, yB: side < 0 ? 0.2 : 0.6, vLen: 60 });
      const m = new THREE.Mesh(g, curbMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    const r = theme.runoff;
    const runoffTex = noiseTexture(r.base, r.speckles, { blades: r.blades || null, seed: 9 });
    const runoffMat = new THREE.MeshLambertMaterial({ map: runoffTex });
    for (const side of [-1, 1]) {
      const a = side * (rw / 2 + cw), b = side * wb;
      const g = ribbonGeometry(track, { a: Math.min(a, b), b: Math.max(a, b), yA: 0, yB: 0, vLen: 30 });
      // the texture's u spans one width across - compress it
      const uvAttr = g.getAttribute('uv');
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setX(i, uvAttr.getX(i) * ((wb - rw / 2 - cw) / 30));
      const m = new THREE.Mesh(g, runoffMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // walls
    const wallTex = wallTexture(theme.wall);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.DoubleSide });
    const wallH = theme.wall === 'concrete' ? 11 : 9;
    for (const side of [-1, 1]) {
      const g = ribbonGeometry(track, { a: side * wb, b: side * wb, yA: -3, yB: wallH, vLen: 60, alongU: true });
      const m = new THREE.Mesh(g, wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      // top edge
      const topG = ribbonGeometry(track, { a: side * wb - 1.2, b: side * wb + 1.2, yA: wallH, yB: wallH, vLen: 60 });
      this.scene.add(new THREE.Mesh(topG, new THREE.MeshLambertMaterial({ color: 0x55585e })));
    }
  }

  // --------------------------- bridge ---------------------------
  _buildBridge() {
    const track = this.track;
    if (track.def.bridgeHeight == null) return;
    const wb = track.wallBoundary;
    const isBridge = (i) => track.centerline[i].bridge;
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.85, side: THREE.DoubleSide });
    const depth = 14;
    this.scene.add(new THREE.Mesh(ribbonGeometry(track, { a: -wb - 1, b: wb + 1, yA: -depth, yB: -depth, filter: isBridge }), deckMat));
    for (const side of [-1, 1]) {
      const edge = side * (wb + 1);
      this.scene.add(new THREE.Mesh(ribbonGeometry(track, { a: edge, b: edge, yA: -depth, yB: 0, alongU: true, filter: isBridge }), deckMat));
    }
    // pillars - they can't stand on the other (lower) leg of the track
    const pillars = [];
    const pts = track.centerline;
    for (let i = 0; i < pts.length; i += 7) {
      const p = pts[i];
      if (!p.bridge) continue;
      for (const side of [-1, 1]) {
        const x = p.x + p.nx * side * (track.roadWidth * 0.32);
        const y = p.y + p.ny * side * (track.roadWidth * 0.32);
        if (track.distanceToTrack(x, y, 400, true) < wb + 25) continue;
        const ground = this.heightAt(x, y);
        const top = p.h - depth;
        if (top - ground < 5) continue;
        pillars.push({ x, y, ground, top });
      }
    }
    const pg = new THREE.CylinderGeometry(1.1, 1.3, 1, 12).translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, deckMat, pillars.length);
    const m4 = new THREE.Matrix4();
    pillars.forEach((pl, i) => {
      m4.makeScale(1, (pl.top - pl.ground) * S, 1).setPosition(pl.x * S, pl.ground * S, pl.y * S);
      pm.setMatrixAt(i, m4);
    });
    pm.castShadow = true;
    pm.receiveShadow = true;
    this.scene.add(pm);
  }

  // --------------------------- start: gantry, start lights, grandstand ---------------------------
  _buildStartArea() {
    const track = this.track;
    const p0 = track.centerline[0];
    const wb = track.wallBoundary;
    const rw = track.roadWidth;

    // chequered start line
    const checker = checkerTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, rw * S).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    line.position.set(p0.x * S, p0.h * S + 0.03, p0.y * S);
    line.rotation.y = -track.startAngle;
    line.receiveShadow = true;
    this.scene.add(line);

    // start gantry
    const gantry = new THREE.Group();
    gantry.position.set(p0.x * S, p0.h * S, p0.y * S);
    gantry.rotation.y = -track.startAngle;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
    const halfW = (wb + 6) * S;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), metal);
      post.position.set(0, 4, side * halfW);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, halfW * 2 + 0.8), metal);
    beam.position.set(0, 8, 0);
    beam.castShadow = true;
    gantry.add(beam);
    const bannerTex = bannerTexture(t('world.startBanner'));
    for (const side of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 1.4, halfW * 1.4 / 8), new THREE.MeshBasicMaterial({ map: bannerTex }));
      banner.position.set(side * 0.62, 8, 0);
      banner.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      gantry.add(banner);
    }
    // start lights (5), facing the track (the approaching cars)
    this.startLights = [];
    for (let i = 0; i < 5; i++) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 1.0), metal);
      const z = (i - 2) * 1.4;
      housing.position.set(-0.7, 10.0, z);
      gantry.add(housing);
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 3 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), mat);
      bulb.position.set(-0.98, 10.0, z);
      gantry.add(bulb);
      this.startLights.push(mat);
    }
    this.scene.add(gantry);

    this._buildGrandstand();
  }

  setStartLights(count, green = false) {
    if (!this.startLights) return;
    this.startLights.forEach((m, i) => {
      if (green) { m.emissive.setHex(0x22ff44); m.color.setHex(0x0a3a10); } else if (i < count) { m.emissive.setHex(0xff1a0a); m.color.setHex(0x3a0000); } else { m.emissive.setHex(0x000000); m.color.setHex(0x220000); }
    });
  }

  _buildGrandstand() {
    const track = this.track;
    const pts = track.centerline;
    const wb = track.wallBoundary;
    const i0 = 4, i1 = 4 + Math.round(380 / track.step);
    let side = null;
    for (const s of [-1, 1]) {
      let ok = true;
      for (let i = i0; i <= i1; i += 3) {
        const p = pts[i];
        for (const extra of [30, 70, 125]) {
          const x = p.x + p.nx * s * (wb + extra), y = p.y + p.ny * s * (wb + extra);
          if (!track.isClear(x, y, extra - 15)) ok = false;
        }
      }
      if (ok) { side = s; break; }
    }
    if (side == null) return;
    const pa = pts[i0], pb = pts[i1];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) * S;
    const mid = pts[Math.floor((i0 + i1) / 2)];
    const g = new THREE.Group();
    g.position.set((mid.x + mid.nx * side * (wb + 25)) * S, mid.h * S, (mid.y + mid.ny * side * (wb + 25)) * S);
    g.rotation.y = -Math.atan2(mid.ty, mid.tx);
    if (side < 0) g.scale.z = -1;
    const depth = 10, height = 7;
    // sloped surface of the crowd
    const crowd = new THREE.BufferGeometry();
    const L = len / 2;
    crowd.setAttribute('position', new THREE.Float32BufferAttribute([
      -L, 1, 0.5, L, 1, 0.5, -L, 1 + height, depth, L, 1 + height, depth,
    ], 3));
    crowd.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / 12, 0, 0, 1, len / 12, 1], 2));
    crowd.setIndex([0, 2, 1, 1, 2, 3]);
    crowd.computeVertexNormals();
    const tex = crowdTexture();
    const crowdMesh = new THREE.Mesh(crowd, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    crowdMesh.receiveShadow = true;
    g.add(crowdMesh);
    const concrete = new THREE.MeshLambertMaterial({ color: 0x9ea2a8 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, height + 4, 0.6), concrete);
    back.position.set(0, (height + 4) / 2, depth + 0.3);
    back.castShadow = true;
    g.add(back);
    const front = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.4), concrete);
    front.position.set(0, 0.6, 0.3);
    g.add(front);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.3, depth + 2), new THREE.MeshLambertMaterial({ color: this.theme.roof }));
    roof.position.set(0, height + 4.2, depth / 2 - 0.5);
    roof.castShadow = true;
    g.add(roof);
    for (let x = -L; x <= L + 0.01; x += len / 4) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, height + 4, 0.35), concrete);
      post.position.set(x, (height + 4) / 2, 0.4);
      g.add(post);
    }
    this.scene.add(g);
  }

  // --------------------------- scenery ---------------------------
  // Random point next to the track (not too close, not on another leg of the track).
  _scatterPoint(minMargin, spread) {
    const track = this.track;
    const pts = track.centerline;
    for (let tries = 0; tries < 12; tries++) {
      const p = pts[Math.floor(this.rand() * pts.length)];
      const side = this.rand() < 0.5 ? -1 : 1;
      const lat = track.wallBoundary + minMargin + this.rand() * spread;
      const x = p.x + p.nx * side * lat + (this.rand() - 0.5) * 60;
      const y = p.y + p.ny * side * lat + (this.rand() - 0.5) * 60;
      if (track.isClear(x, y, minMargin)) return { x, y };
    }
    return null;
  }

  _instanced(geom, mat, items, { castShadow = true } = {}) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geom, mat, items.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot || 0);
      m4.compose(new THREE.Vector3(it.x * S, it.h * S, it.y * S), q, new THREE.Vector3(it.sx || it.s, it.sy || it.s, it.sz || it.s));
      mesh.setMatrixAt(i, m4);
      if (it.color) mesh.setColorAt(i, color.set(it.color));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  _buildScenery() {
    const sc = this.theme.scenery;
    const q = this.quality.scenery;
    const rand = this.rand;
    const jitterColor = (hex, amt) => {
      const c = new THREE.Color(hex);
      c.offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * amt, (rand() - 0.5) * amt);
      return c;
    };

    if (sc.trees) {
      const count = Math.round(sc.trees * q);
      const decid = [], pines = [], trunksD = [], trunksP = [];
      for (let i = 0; i < count; i++) {
        const pt = this._scatterPoint(25, 900);
        if (!pt) continue;
        const h = this.heightAt(pt.x, pt.y);
        const s = 0.7 + rand() * 0.8;
        const rot = rand() * Math.PI * 2;
        if (rand() < sc.pines) {
          pines.push({ ...pt, h, s, rot, color: jitterColor(this.theme.ground.snow ? '#2e5a3a' : '#2f6a34', 0.15) });
          trunksP.push({ ...pt, h, s, rot });
        } else {
          decid.push({ ...pt, h, s, rot, color: jitterColor(this.track.theme === 'sunset' ? '#7a8a2a' : '#3f8a2e', 0.25) });
          trunksD.push({ ...pt, h, s, rot });
        }
      }
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3e2a });
      const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 3, 6).translate(0, 1.5, 0);
      this._instanced(trunkG, trunkMat, trunksD);
      this._instanced(trunkG, trunkMat, trunksP);
      const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      const decidG = mergeGeometries([
        new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.4, 0),
        new THREE.IcosahedronGeometry(1.7, 0).translate(0.9, 5.6, 0.4),
        new THREE.IcosahedronGeometry(1.6, 0).translate(-0.8, 5.2, -0.6),
      ]);
      this._instanced(decidG, leafMat, decid);
      const pineParts = [
        new THREE.ConeGeometry(2.4, 4.2, 8).translate(0, 3.8, 0),
        new THREE.ConeGeometry(1.8, 3.4, 8).translate(0, 5.7, 0),
        new THREE.ConeGeometry(1.1, 2.6, 8).translate(0, 7.4, 0),
      ];
      const pineG = mergeGeometries(pineParts);
      this._instanced(pineG, leafMat, pines);
      if (this.theme.ground.snow) {
        // snow caps on the pines
        const capG = mergeGeometries([
          new THREE.ConeGeometry(1.25, 1.4, 8).translate(0, 6.7, 0),
          new THREE.ConeGeometry(0.75, 1.3, 8).translate(0, 8.2, 0),
        ]);
        this._instanced(capG, new THREE.MeshLambertMaterial({ color: 0xf6f9fc, flatShading: true }), pines.map((p) => ({ ...p, color: null })));
      }
    }

    if (sc.bushes) {
      const items = [];
      for (let i = 0; i < sc.bushes * q; i++) {
        const pt = this._scatterPoint(8, 500);
        if (!pt) continue;
        items.push({ ...pt, h: this.heightAt(pt.x, pt.y), s: 0.5 + rand() * 0.7, rot: rand() * 6, color: jitterColor('#3c7a2a', 0.2) });
      }
      this._instanced(new THREE.IcosahedronGeometry(1.2, 0).scale(1, 0.7, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), items);
    }

    if (sc.rocks) {
      const items = [];
      const base = this.track.theme === 'desert' ? '#a4552f' : '#7d7a76';
      for (let i = 0; i < sc.rocks * q; i++) {
        const pt = this._scatterPoint(12, 800);
        if (!pt) continue;
        const s = 0.6 + rand() * 2.2;
        items.push({ ...pt, h: this.heightAt(pt.x, pt.y) - 3, s, sy: s * (0.5 + rand() * 0.6), rot: rand() * 6, color: jitterColor(base, 0.15) });
      }
      this._instanced(new THREE.DodecahedronGeometry(1.4, 0), new THREE.MeshLambertMaterial({ flatShading: true }), items);
    }

    if (sc.cacti) {
      const items = [];
      for (let i = 0; i < sc.cacti * q; i++) {
        const pt = this._scatterPoint(15, 700);
        if (!pt) continue;
        items.push({ ...pt, h: this.heightAt(pt.x, pt.y), s: 0.8 + rand() * 0.7, rot: rand() * 6, color: jitterColor('#3f7a3a', 0.15) });
      }
      const cactusG = mergeGeometries([
        new THREE.CylinderGeometry(0.45, 0.5, 5, 8).translate(0, 2.5, 0),
        new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8).rotateZ(Math.PI / 2).translate(0.8, 2.2, 0),
        new THREE.CylinderGeometry(0.28, 0.3, 2.0, 8).translate(1.5, 3.1, 0),
        new THREE.CylinderGeometry(0.3, 0.3, 1.4, 8).rotateZ(Math.PI / 2).translate(-0.7, 2.9, 0),
        new THREE.CylinderGeometry(0.26, 0.28, 1.6, 8).translate(-1.3, 3.6, 0),
      ]);
      this._instanced(cactusG, new THREE.MeshLambertMaterial({ flatShading: true }), items);
    }

    if (sc.ring) this._buildRing(sc.ring);
    if (sc.ferris) this._buildFerrisWheel();
    if (sc.buildings) this._buildCity();
    if (sc.streetlights) this._buildStreetLights();
  }

  // ring of distant mountains / hills / mesas on the horizon
  _buildRing(kind) {
    const b = this.track.bounds;
    const cx = b.minX + b.width / 2, cy = b.minY + b.height / 2;
    const R = Math.max(b.width, b.height) / 2 + 4200;
    const rand = this.rand;
    const items = [], caps = [];
    const count = 34;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.15;
      const r = R + rand() * 1800;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const s = 1 + rand() * 1.4;
      items.push({ x, y, h: -40, s, sy: s * (0.7 + rand() * 0.8), rot: rand() * 6 });
      caps.push(items[items.length - 1]);
    }
    let geom, color, capGeom = null;
    if (kind === 'mountains') {
      geom = new THREE.ConeGeometry(110, 170, 7);
      geom.translate(0, 85, 0);
      color = 0x76818e;
      capGeom = new THREE.ConeGeometry(47, 73, 7).translate(0, 170 - 36, 0);
    } else if (kind === 'mesas') {
      geom = new THREE.CylinderGeometry(70, 100, 60, 7).translate(0, 30, 0);
      color = 0xb8643a;
    } else {
      geom = new THREE.SphereGeometry(120, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1);
      color = this.track.theme === 'sunset' ? 0x5a4a58 : 0x5d8a4a;
    }
    this._instanced(geom, new THREE.MeshLambertMaterial({ color, flatShading: true }), items, { castShadow: false });
    if (capGeom) this._instanced(capGeom, new THREE.MeshLambertMaterial({ color: 0xf4f7fb, flatShading: true }), caps, { castShadow: false });
  }

  _buildFerrisWheel() {
    const track = this.track;
    // find a spot: a free point somewhere near the track
    const b = track.bounds;
    const candidates = [];
    for (let i = 0; i < 400; i++) {
      const x = b.minX + this.rand() * b.width, y = b.minY + this.rand() * b.height;
      const d = track.distanceToTrack(x, y, 1200);
      if (d > track.wallBoundary + 260 && d < track.wallBoundary + 600) candidates.push({ x, y, d });
    }
    if (!candidates.length) return;
    candidates.sort((a, c) => a.d - c.d);
    const spot = candidates[0];
    const R = 22;
    const group = new THREE.Group();
    const ground = this.heightAt(spot.x, spot.y);
    group.position.set(spot.x * S, ground * S, spot.y * S);
    group.rotation.y = Math.atan2(spot.x - (b.minX + b.width / 2), spot.y - (b.minY + b.height / 2));
    const steel = new THREE.MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.4, metalness: 0.5 });
    for (const z of [-3.5, 3.5]) {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, R + 6, 8), steel);
        leg.position.set(sx * 7, (R + 4) / 2, z);
        leg.rotation.z = sx * 0.28;
        leg.castShadow = true;
        group.add(leg);
      }
    }
    const wheel = new THREE.Group();
    wheel.position.set(0, R + 4, 0);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9a40, emissiveIntensity: 0.6, roughness: 0.4 });
    for (const z of [-1.6, 1.6]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), glow);
      ring.position.z = z;
      wheel.add(ring);
    }
    const spokes = 16;
    const cabinColors = [0xe8322a, 0x2a7de8, 0xf2c230, 0x2fbf5a];
    this.ferrisCabins = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.18, R, 0.18), steel);
      spoke.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
      spoke.rotation.z = a - Math.PI / 2;
      wheel.add(spoke);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2.4), new THREE.MeshLambertMaterial({ color: cabinColors[i % 4] }));
      cabin.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.3, 0);
      cabin.castShadow = true;
      wheel.add(cabin);
      this.ferrisCabins.push({ mesh: cabin, a });
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 8, 12).rotateX(Math.PI / 2), steel);
    wheel.add(hub);
    group.add(wheel);
    this.scene.add(group);
    this.animated.push((dt, t) => {
      const rot = t * 0.08;
      wheel.rotation.z = rot;
      for (const c of this.ferrisCabins) c.mesh.rotation.z = -rot;
    });
  }

  _buildCity() {
    const track = this.track;
    const rand = this.rand;
    const q = this.quality.scenery;
    const variants = [];
    const tints = ['#7c8796', '#8e8a82', '#6a7482', '#9aa0a8', '#5f6670', '#8a7b6e'];
    for (let v = 0; v < tints.length; v++) {
      const { map, emissiveMap } = windowTextures(100 + v, tints[v]);
      variants.push({ mat: new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.75, metalness: 0.1 }), geoms: [] });
    }
    const step = 300;
    const limit = 2400;
    const b = track.bounds;
    for (let x = b.minX - limit; x < b.maxX + limit; x += step) {
      for (let y = b.minY - limit; y < b.maxY + limit; y += step) {
        if (rand() > 0.35 + 0.65 * q) continue;
        const w = 120 + rand() * 140, dpt = 120 + rand() * 140;
        const px = x + (rand() - 0.5) * 60, py = y + (rand() - 0.5) * 60;
        const clearance = Math.hypot(w, dpt) / 2 + 30;
        if (!track.isClear(px, py, clearance)) continue;
        const dist = track.distanceToTrack(px, py, 3000);
        const tall = dist < 900 ? 1 : 1.6;
        const hgt = (90 + rand() * rand() * 600) * tall;
        const g = new THREE.BoxGeometry(w * S, hgt * S, dpt * S);
        // scale the UVs so windows keep their size; dark roof
        const uv = g.getAttribute('uv');
        for (let f = 0; f < 6; f++) {
          const faceW = (f < 2 ? dpt : w) * S;
          for (let k = 0; k < 4; k++) {
            const i = f * 4 + k;
            if (f === 2 || f === 3) { uv.setXY(i, 0.01, 0.01); continue; }
            uv.setXY(i, uv.getX(i) * faceW / 12, uv.getY(i) * (hgt * S) / 24);
          }
        }
        g.translate(px * S, (hgt / 2 - 2) * S, py * S);
        variants[Math.floor(rand() * variants.length)].geoms.push(g);
      }
    }
    for (const v of variants) {
      if (!v.geoms.length) continue;
      v.mat.map.wrapS = v.mat.map.wrapT = THREE.RepeatWrapping;
      const mesh = new THREE.Mesh(mergeGeometries(v.geoms), v.mat);
      this.scene.add(mesh);
    }
  }

  _buildStreetLights() {
    const track = this.track;
    const pts = track.centerline;
    const wb = track.wallBoundary;
    const poles = [], heads = [], pools = [];
    let side = 1;
    const every = 10;
    for (let i = 0; i < pts.length; i += every) {
      const p = pts[i];
      side = -side;
      const x = p.x + p.nx * side * (wb + 6), y = p.y + p.ny * side * (wb + 6);
      const rot = -Math.atan2(p.ny * -side, p.nx * -side);
      poles.push({ x, y, h: p.h, s: 1, rot });
      const hx = p.x + p.nx * side * (wb - 32), hy = p.y + p.ny * side * (wb - 32);
      heads.push({ x: hx, y: hy, h: p.h + 80, s: 1, rot });
      pools.push({ x: hx, y: hy, h: p.h + 0.8, s: 1, rot: 0 });
    }
    const poleG = mergeGeometries([
      new THREE.CylinderGeometry(0.15, 0.22, 8.2, 8).translate(0, 4.1, 0),
      new THREE.BoxGeometry(3.9, 0.14, 0.14).translate(1.9, 8.1, 0),
    ]);
    this._instanced(poleG, new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.4 }), poles, { castShadow: false });
    const headG = new THREE.BoxGeometry(1.1, 0.25, 0.5);
    this._instanced(headG, new THREE.MeshBasicMaterial({ color: 0xffe3a8 }), heads, { castShadow: false });
    const poolTex = softCircleTexture('rgba(255,210,140,0.55)', 'rgba(255,210,140,0)');
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    this._instanced(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), poolMat, pools, { castShadow: false });
  }

  update(dt, time) {
    for (const fn of this.animated) fn(dt, time);
  }

  // The sky follows the camera position (so it looks infinitely far away).
  prepareView(camera) {
    this.sky.position.copy(camera.position);
  }

  dispose() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const key of ['map', 'emissiveMap']) if (m[key]) m[key].dispose();
          m.dispose();
        }
      }
    });
  }
}
