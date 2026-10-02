import * as THREE from '../lib/three.module.js';

// Every texture is drawn on a canvas at runtime - no image files are needed
// and the game works offline too (e.g. while the computer is connected to the
// ESP32's own WiFi network).

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Deterministic pseudo-random numbers (so it looks the same on every start).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTexture(canvas, { repeat = true, anisotropy = 8, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function speckle(ctx, w, h, count, colors, sizeMin, sizeMax, rand) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const s = sizeMin + rand() * (sizeMax - sizeMin);
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

// Asphalt with road markings. u = across (0 = left edge, 1 = right edge),
// v = along (repeats).
export function asphaltTexture({ base = '#3b3f46', lines = '#f0f0f0', center = '#f2c14e', night = false } = {}) {
  const w = 512, h = 1024;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rand = mulberry32(7);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 26000, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)', 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.05)'], 1, 3, rand);
  // rubbered-in lines on the two racing lines
  for (const cx of [0.32, 0.68]) {
    const g = ctx.createLinearGradient((cx - 0.12) * w, 0, (cx + 0.12) * w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect((cx - 0.12) * w, 0, 0.24 * w, h);
  }
  // cracks / patches
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = rand() * w, y = rand() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 40; y += rand() * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // white edge lines
  ctx.fillStyle = lines;
  ctx.globalAlpha = night ? 1 : 0.92;
  ctx.fillRect(w * 0.025, 0, w * 0.022, h);
  ctx.fillRect(w * (1 - 0.047), 0, w * 0.022, h);
  // dashed centre line
  ctx.fillStyle = center;
  for (let y = 0; y < h; y += 256) ctx.fillRect(w * 0.492, y + 40, w * 0.016, 130);
  ctx.globalAlpha = 1;
  return toTexture(c);
}

export function curbTexture() {
  const w = 64, h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#d62828' : '#f4f4f4';
    ctx.fillRect(0, (i * h) / 4, w, h / 4);
  }
  // slight shading at the edges (ribbed look)
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.3, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return toTexture(c);
}

// Generic noisy surface (grass, gravel, sand, snow, concrete).
export function noiseTexture(base, speckles, { size = 256, count = 9000, sMin = 1, sMax = 3, seed = 3, blades = null } = {}) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // larger blotches for variety
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = speckles[Math.floor(rand() * speckles.length)];
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 10 + rand() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, size, size, count, speckles, sMin, sMax, rand);
  if (blades) {
    ctx.strokeStyle = blades;
    ctx.lineWidth = 1;
    for (let i = 0; i < 2500; i++) {
      const x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4); ctx.stroke();
    }
  }
  return toTexture(c);
}

// Greyscale detail texture for the terrain (the colour comes from vertex colours).
export function detailTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(11);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const v = 180 + Math.floor(rand() * 75);
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 8 + rand() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, size, size, 14000, ['#ffffff', '#b8b8b8', '#c8c8c8', '#f0f0f0', '#a8a8a8'], 1, 2, rand);
  return toTexture(c, { srgb: false });
}

// Wall textures: u = along (repeats), v = vertical.
export function wallTexture(style) {
  const w = 256, h = 64;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (style === 'tires') {
    // tyre wall with a red-white band
    ctx.fillStyle = '#1b1b1d';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      for (let y = 0; y < h; y += 21) {
        const g = ctx.createRadialGradient(x + 16, y + 10, 2, x + 16, y + 10, 16);
        g.addColorStop(0, '#0a0a0a'); g.addColorStop(0.45, '#2c2c30'); g.addColorStop(1, '#141416');
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y + 1, 30, 19);
      }
    }
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = '#d62828'; ctx.fillRect(x, 24, 32, 16);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x + 32, 24, 32, 16);
    }
  } else if (style === 'armco') {
    ctx.fillStyle = '#6d7075';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 8, 0, 40);
    g.addColorStop(0, '#d9dde2'); g.addColorStop(0.5, '#8f959c'); g.addColorStop(1, '#cfd4da');
    ctx.fillStyle = g; ctx.fillRect(0, 8, w, 32);
    ctx.fillStyle = '#3a3c40';
    for (let x = 0; x < w; x += 128) ctx.fillRect(x + 60, 0, 8, h);
    ctx.fillStyle = '#f2c230';
    for (let x = 0; x < w; x += 128) ctx.fillRect(x + 20, 20, 10, 8);
  } else if (style === 'concrete') {
    ctx.fillStyle = '#a9a9a4';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 3000, ['#9a9a95', '#b8b8b2', '#8c8c88'], 1, 2, mulberry32(5));
    ctx.fillStyle = '#6a6a66';
    for (let x = 0; x < w; x += 128) ctx.fillRect(x, 0, 2, h);
    // advertising strip
    const ads = ['#e83a3a', '#2a7de8', '#f2c230', '#2fbf5a'];
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = ads[i * 2 + 1];
      ctx.fillRect(i * 128 + 14, 18, 100, 26);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px Arial';
      ctx.fillText(i ? 'DRIFT' : 'TURBO', i * 128 + 30, 38);
    }
  } else {
    // 'stripes' - red-white concrete
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = '#c62b2b'; ctx.fillRect(x, 0, 32, h);
      ctx.fillStyle = '#efefef'; ctx.fillRect(x + 32, 0, 32, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - 8, w, 8);
  }
  return toTexture(c);
}

export function checkerTexture() {
  // u = driving direction (2 squares), v = across (10 squares)
  const sq = 16;
  const c = makeCanvas(2 * sq, 10 * sq);
  const ctx = c.getContext('2d');
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 10; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  }
  const tex = toTexture(c, { repeat: false });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export function bannerTexture(text, bg = '#141820', fg = '#ffffff', accent = '#ff5c39') {
  const c = makeCanvas(1024, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 1024, 10); ctx.fillRect(0, 118, 1024, 10);
  ctx.fillStyle = fg;
  ctx.font = 'bold 76px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 66);
  return toTexture(c, { repeat: false });
}

// Grandstand: rows of colourful "heads".
export function crowdTexture() {
  const w = 512, h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rand = mulberry32(21);
  ctx.fillStyle = '#3a3f4a';
  ctx.fillRect(0, 0, w, h);
  const rows = 8;
  const shirt = ['#e8322a', '#2a7de8', '#f2c230', '#ffffff', '#2fbf5a', '#ff7a1a', '#8a4be8', '#222'];
  const skin = ['#f1c7a3', '#d9a47c', '#a86f4b', '#6e4630'];
  for (let r = 0; r < rows; r++) {
    const y0 = (r * h) / rows;
    ctx.fillStyle = r % 2 ? '#4a505c' : '#555c69';
    ctx.fillRect(0, y0 + h / rows - 6, w, 6);
    for (let x = 4; x < w; x += 9 + rand() * 4) {
      if (rand() < 0.12) continue;
      ctx.fillStyle = shirt[Math.floor(rand() * shirt.length)];
      ctx.fillRect(x, y0 + 14, 8, 12);
      ctx.fillStyle = skin[Math.floor(rand() * skin.length)];
      ctx.beginPath(); ctx.arc(x + 4, y0 + 10, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  return toTexture(c);
}

// Building facade with windows. The emissive map (night lights) is separate.
export function windowTextures(seed, tint = '#8fa3b8') {
  const w = 128, h = 256;
  const color = makeCanvas(w, h);
  const glow = makeCanvas(w, h);
  const c1 = color.getContext('2d');
  const c2 = glow.getContext('2d');
  const rand = mulberry32(seed);
  c1.fillStyle = tint; c1.fillRect(0, 0, w, h);
  c2.fillStyle = '#000'; c2.fillRect(0, 0, w, h);
  const cols = 4, rows = 8;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = 8 + k * 30, y = 8 + r * 31;
      c1.fillStyle = '#1b2230';
      c1.fillRect(x, y, 22, 20);
      if (rand() < 0.55) {
        const warm = rand() < 0.7;
        c2.fillStyle = warm ? `hsl(${38 + rand() * 12},90%,${55 + rand() * 20}%)` : `hsl(200,70%,${60 + rand() * 20}%)`;
        c2.fillRect(x, y, 22, 20);
      }
    }
  }
  return { map: toTexture(color), emissiveMap: toTexture(glow) };
}

// Soft round sprite (smoke, dust, light pool).
export function softCircleTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return toTexture(c, { repeat: false });
}

export function smokeTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const rand = mulberry32(99);
  for (let i = 0; i < 18; i++) {
    const x = s / 2 + (rand() - 0.5) * s * 0.4;
    const y = s / 2 + (rand() - 0.5) * s * 0.4;
    const r = s * (0.15 + rand() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return toTexture(c, { repeat: false });
}
