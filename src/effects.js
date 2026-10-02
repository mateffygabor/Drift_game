import * as THREE from '../lib/three.module.js';
import { smokeTexture, softCircleTexture } from './textures.js';

// Skid marks: one ring-buffer mesh; every new segment overwrites the oldest.
export class SkidMarks {
  constructor(scene, capacity = 4000) {
    this.capacity = capacity;
    this.next = 0;
    this.positions = new Float32Array(capacity * 4 * 3);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.trails = new Map(); // key -> previous point
  }

  // key: e.g. "p1-0"; active: drawing a mark now; x,y,z: world position (m); rx,rz: unit vector to the right
  track(key, active, x, y, z, rx, rz, halfWidth = 0.13) {
    const prev = this.trails.get(key);
    const cur = { lx: x - rx * halfWidth, lz: z - rz * halfWidth, rx2: x + rx * halfWidth, rz2: z + rz * halfWidth, y };
    if (active && prev) {
      const d = Math.hypot(cur.lx - prev.lx, cur.lz - prev.lz);
      if (d < 0.08) return; // too short, wait
      if (d < 3) this._addQuad(prev, cur);
    }
    if (active) this.trails.set(key, cur); else this.trails.delete(key);
  }

  _addQuad(a, b) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const p = this.positions;
    const o = i * 12;
    p[o] = a.lx; p[o + 1] = a.y; p[o + 2] = a.lz;
    p[o + 3] = a.rx2; p[o + 4] = a.y; p[o + 5] = a.rz2;
    p[o + 6] = b.lx; p[o + 7] = b.y; p[o + 8] = b.lz;
    p[o + 9] = b.rx2; p[o + 10] = b.y; p[o + 11] = b.rz2;
    this.posAttr.needsUpdate = true;
  }

  clear() {
    this.positions.fill(0);
    this.posAttr.needsUpdate = true;
    this.trails.clear();
  }
}

// Particles (smoke, dust, sparks) from sprites, from a pre-allocated pool.
export class Particles {
  constructor(scene, { count, texture, additive = false, gravity = 0 }) {
    this.pool = [];
    this.gravity = gravity;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, transparent: true, depthWrite: false, opacity: 0,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.pool.push({ sprite: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size0: 1, size1: 2, alpha: 1 });
    }
    this.cursor = 0;
  }

  emit(x, y, z, { vx = 0, vy = 0, vz = 0, life = 1, size0 = 0.8, size1 = 3, alpha = 0.6, color = 0xffffff }) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    p.sprite.position.set(x, y, z);
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life;
    p.size0 = size0; p.size1 = size1; p.alpha = alpha;
    p.sprite.material.color.setHex(color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.vy -= this.gravity * dt;
      const drag = Math.exp(-dt * 1.5);
      p.vx *= drag; p.vz *= drag;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      const s = p.size0 + (p.size1 - p.size0) * t;
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 6 + 0.2);
    }
  }

  clear() {
    for (const p of this.pool) { p.life = 0; p.sprite.visible = false; }
  }
}

export function createEffects(scene) {
  return {
    skid: new SkidMarks(scene),
    smoke: new Particles(scene, { count: 220, texture: smokeTexture() }),
    sparks: new Particles(scene, { count: 80, texture: softCircleTexture('rgba(255,230,160,1)', 'rgba(255,120,20,0)'), additive: true, gravity: 9 }),
  };
}
