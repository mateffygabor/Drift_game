import * as THREE from '../lib/three.module.js';
import { softCircleTexture } from './textures.js';

// Low-poly 3D car models. Every model is a body + cabin extruded from a
// side-view profile (Shape), with separate wheels (they spin, the front ones
// steer), brake lights and headlights. Local coordinates:
// +X = forward, +Y = up, +Z = right. Sizes in metres.

// Profile points: [x fraction 0 (rear) .. 1 (front), y metres]
const MODELS = {
  coupe: {
    L: 4.5, W: 1.86, cabinW: 0.8,
    body: [[0, 0.26], [0, 0.78], [0.07, 0.86], [0.3, 0.9], [0.74, 0.88], [0.96, 0.7], [1, 0.46], [0.98, 0.26]],
    cabin: [[0.29, 0.88], [0.43, 1.3], [0.64, 1.3], [0.76, 0.87]],
    wheelR: 0.34, wheelX: [0.19, 0.8], wheelW: 0.26, lightY: 0.62, lightXf: 0.985, tailY: 0.7,
    spoiler: 'lip',
  },
  jdm: {
    L: 4.4, W: 1.8, cabinW: 0.78,
    body: [[0, 0.3], [0, 0.78], [0.1, 0.82], [0.32, 0.84], [0.72, 0.82], [0.96, 0.62], [1, 0.42], [0.97, 0.26]],
    cabin: [[0.32, 0.83], [0.45, 1.22], [0.63, 1.22], [0.74, 0.81]],
    wheelR: 0.33, wheelX: [0.18, 0.8], wheelW: 0.28, lightY: 0.56, lightXf: 0.985, tailY: 0.68,
    spoiler: 'wing',
  },
  muscle: {
    L: 4.9, W: 1.95, cabinW: 0.8,
    body: [[0, 0.3], [0, 0.86], [0.05, 0.93], [0.28, 0.93], [0.62, 0.93], [0.97, 0.88], [1, 0.8], [1, 0.36], [0.97, 0.28]],
    cabin: [[0.28, 0.92], [0.37, 1.32], [0.55, 1.32], [0.63, 0.92]],
    wheelR: 0.37, wheelX: [0.17, 0.8], wheelW: 0.32, lightY: 0.66, lightXf: 1.0, tailY: 0.72,
    stripes: true, scoop: true,
  },
  hatch: {
    L: 4.0, W: 1.8, cabinW: 0.84,
    body: [[0, 0.34], [0, 0.92], [0.72, 0.94], [0.95, 0.76], [1, 0.56], [0.98, 0.32]],
    cabin: [[0.02, 0.92], [0.08, 1.44], [0.58, 1.46], [0.73, 0.93]],
    wheelR: 0.36, wheelX: [0.17, 0.81], wheelW: 0.26, lightY: 0.66, lightXf: 0.99, tailY: 0.8,
    spoiler: 'roof', rally: true,
  },
  super: {
    L: 4.6, W: 2.0, cabinW: 0.72,
    body: [[0, 0.28], [0, 0.72], [0.1, 0.77], [0.35, 0.8], [0.66, 0.72], [0.95, 0.5], [1, 0.36], [0.98, 0.24]],
    cabin: [[0.3, 0.79], [0.43, 1.1], [0.56, 1.1], [0.72, 0.7]],
    wheelR: 0.35, wheelX: [0.18, 0.8], wheelW: 0.32, lightY: 0.45, lightXf: 0.985, tailY: 0.62,
    spoiler: 'wing', stripes: true,
  },
  pickup: {
    L: 5.3, W: 2.05, cabinW: 0.86,
    body: [[0, 0.5], [0, 1.08], [0.58, 1.08], [0.6, 1.12], [0.78, 1.14], [0.97, 1.04], [1, 0.88], [1, 0.52], [0.97, 0.46]],
    cabin: [[0.58, 1.12], [0.6, 1.76], [0.75, 1.76], [0.83, 1.13]],
    wheelR: 0.46, wheelX: [0.17, 0.8], wheelW: 0.36, lightY: 0.95, lightXf: 1.0, tailY: 0.95,
    bed: true, bullbar: true,
  },
};

const tmpShadowTex = { tex: null };

function extrudeProfile(points, L, width, mat) {
  const shape = new THREE.Shape();
  points.forEach(([fx, y], i) => {
    const x = (fx - 0.5) * L;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  });
  shape.closePath();
  const bevel = 0.06;
  const depth = Math.max(0.1, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, steps: 1, curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Thin quad between two profile points (windscreen / rear window).
function glassQuad(p1, p2, L, halfW, mat, outward = 0.02) {
  const x1 = (p1[0] - 0.5) * L, y1 = p1[1];
  const x2 = (p2[0] - 0.5) * L, y2 = p2[1];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  let nx = dy / len, ny = -dx / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const shrink = 0.08;
  const ax = x1 + dx * shrink + nx * outward, ay = y1 + dy * shrink + ny * outward;
  const bx = x2 - dx * shrink + nx * outward, by = y2 - dy * shrink + ny * outward;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ax, ay, -halfW, ax, ay, halfW, bx, by, -halfW, bx, by, halfW,
  ], 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function makeWheel(r, w, rimMat, tireMat) {
  const spinner = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20).rotateX(Math.PI / 2), tireMat);
  tire.castShadow = true;
  spinner.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateX(Math.PI / 2), rimMat);
  spinner.add(rim);
  // spokes, so the rotation is visible
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 1.05, r * 0.14, w + 0.04), spokeMat);
    spoke.rotation.z = (i / 5) * Math.PI;
    spinner.add(spoke);
  }
  return spinner;
}

export function buildCarModel(vehicle, colorHex, { night = false, headlight: withLight = true } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.32, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.7, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f141c, roughness: 0.08, metalness: 0.6, side: THREE.DoubleSide });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.25, metalness: 0.9 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: night ? 2.5 : 0.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35, metalness: 0.4 });

  const wheels = [];
  let dims;

  if (vehicle.model === 'kart') {
    dims = buildKart(body, wheels, paint, dark, tireMat, chrome);
  } else {
    const M = MODELS[vehicle.model];
    const { L, W } = M;
    dims = { L, W };
    body.add(extrudeProfile(M.body, L, W, paint));
    const cabW = W * M.cabinW;
    body.add(extrudeProfile(M.cabin, L, cabW, paint));
    // side windows: the shrunken cabin profile, slightly wider
    const cx = M.cabin.reduce((s, p) => s + p[0], 0) / M.cabin.length;
    const cy = M.cabin.reduce((s, p) => s + p[1], 0) / M.cabin.length;
    const inset = M.cabin.map(([fx, y]) => [cx + (fx - cx) * 0.84, cy + (y - cy) * 0.74 + 0.03]);
    body.add(extrudeProfile(inset, L, cabW + 0.05, glass));
    body.add(glassQuad(M.cabin[2], M.cabin[3], L, cabW / 2 - 0.02, glass));
    body.add(glassQuad(M.cabin[0], M.cabin[1], L, cabW / 2 - 0.02, glass));

    if (M.stripes) {
      const s1 = extrudeProfile(M.body.map(([fx, y]) => [fx, y + 0.012]), L, 0.26, stripeMat);
      s1.position.z = -0.2; body.add(s1);
      const s2 = extrudeProfile(M.body.map(([fx, y]) => [fx, y + 0.012]), L, 0.26, stripeMat);
      s2.position.z = 0.2; body.add(s2);
    }
    if (M.scoop) {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.55), dark);
      scoop.position.set(L * 0.28, 0.98, 0);
      body.add(scoop);
    }
    if (M.spoiler === 'wing') {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, W * 0.95), dark);
      wing.position.set(-L / 2 + 0.2, M.tailY + 0.45, 0);
      wing.castShadow = true;
      body.add(wing);
      for (const z of [-0.5, 0.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.05), dark);
        post.position.set(-L / 2 + 0.24, M.tailY + 0.25, z * W * 0.7);
        body.add(post);
      }
    } else if (M.spoiler === 'lip') {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, W * 0.9), paint);
      lip.position.set(-L / 2 + 0.3, 0.92, 0);
      body.add(lip);
    } else if (M.spoiler === 'roof') {
      const roofSp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, W * 0.8), dark);
      roofSp.position.set(-L / 2 + 0.2, 1.45, 0);
      body.add(roofSp);
    }
    if (M.rally) {
      // roof lamps + mud flaps + race-number decal
      for (const z of [-0.45, -0.15, 0.15, 0.45]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2), headMat);
        lamp.position.set(L * 0.5 + 0.04, 0.75, z * W * 0.6);
        body.add(lamp);
      }
      for (const side of [-1, 1]) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.3), dark);
        flap.position.set((M.wheelX[0] - 0.5) * L - 0.42, 0.25, side * (W / 2 - 0.2));
        body.add(flap);
        const plate = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        plate.position.set(0.1, 0.62, side * (W / 2 + 0.005));
        plate.rotation.y = side > 0 ? 0 : Math.PI;
        body.add(plate);
      }
    }
    if (M.bed) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(L * 0.53, 0.05, W * 0.85), dark);
      bed.position.set((0.29 - 0.5) * L, 1.09, 0);
      body.add(bed);
      const rollBar = new THREE.Mesh(new THREE.TorusGeometry(W * 0.42, 0.05, 6, 16, Math.PI), chrome);
      rollBar.rotation.y = Math.PI / 2;
      rollBar.position.set((0.55 - 0.5) * L, 1.1, 0);
      body.add(rollBar);
    }
    if (M.bullbar) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, W * 0.8), chrome);
      bar.position.set(L / 2 + 0.12, 0.72, 0);
      body.add(bar);
    }
    // dark bumper / sill
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.12, W + 0.02), dark);
    skirt.position.set(0, (M.body[0][1] + 0.06), 0);
    body.add(skirt);

    // lights
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.38), headMat);
      hl.position.set((M.lightXf - 0.5) * L + 0.03, M.lightY, side * (W / 2 - 0.3));
      body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.42), tailMat);
      tl.position.set(-L / 2 - 0.035, M.tailY, side * (W / 2 - 0.28));
      body.add(tl);
    }

    // kerekek
    const [rx, fx] = M.wheelX;
    for (const [xf, front] of [[rx, false], [fx, true]]) {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set((xf - 0.5) * L, M.wheelR, side * (W / 2 - M.wheelW / 2 + 0.03));
        const spinner = makeWheel(M.wheelR, M.wheelW, chrome, tireMat);
        pivot.add(spinner);
        root.add(pivot);
        wheels.push({ pivot, spinner, front, side, x: (xf - 0.5) * L });
      }
    }
  }

  // soft "contact shadow" under the car
  if (!tmpShadowTex.tex) tmpShadowTex.tex = softCircleTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(dims.L * 1.25, dims.W * 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tmpShadowTex.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  blob.position.y = 0.04;
  blob.renderOrder = 1;
  root.add(blob);

  let headlight = null;
  if (night && withLight) {
    headlight = new THREE.SpotLight(0xfff0d0, 900, 90, 0.55, 0.55, 2);
    headlight.position.set(dims.L / 2, 0.8, 0);
    headlight.target.position.set(dims.L / 2 + 20, -1.5, 0);
    root.add(headlight, headlight.target);
  }

  return { root, body, wheels, tailMat, headMat, dims, headlight };
}

function buildKart(body, wheels, paint, dark, tireMat, chrome) {
  const L = 2.1, W = 1.35;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.06, W * 0.62), dark);
  frame.position.y = 0.14;
  body.add(frame);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, W * 0.7), paint);
  nose.position.set(L / 2 - 0.2, 0.22, 0);
  nose.castShadow = true;
  body.add(nose);
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.2), paint);
    pod.position.set(0, 0.22, side * (W / 2 - 0.25));
    pod.castShadow = true;
    body.add(pod);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), dark);
  seat.position.set(-0.25, 0.4, 0);
  body.add(seat);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.3), chrome);
  engine.position.set(-0.7, 0.32, 0.25);
  body.add(engine);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 10), paint);
  torso.position.set(-0.12, 0.72, 0);
  torso.rotation.z = -0.25;
  torso.castShadow = true;
  body.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.2, metalness: 0.3 }));
  helmet.position.set(0.0, 1.1, 0);
  helmet.castShadow = true;
  body.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, -0.9, 1.8, 1.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.05, metalness: 0.8 }));
  visor.position.copy(helmet.position);
  body.add(visor);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 16), dark);
  wheel.position.set(0.3, 0.62, 0);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.5;
  body.add(wheel);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, W * 0.9), chrome);
  bumper.position.set(-L / 2, 0.2, 0);
  body.add(bumper);
  for (const [xf, front, r, w] of [[-0.36, false, 0.15, 0.2], [0.36, true, 0.13, 0.14]]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(xf * L, r, side * (W / 2 - w / 2));
      const spinner = makeWheel(r, w, chrome, tireMat);
      pivot.add(spinner);
      body.parent ? body.parent.add(pivot) : body.add(pivot);
      wheels.push({ pivot, spinner, front, side, x: xf * L });
    }
  }
  return { L, W };
}

// Floating "P1"/"P2" tag above the car (only visible in the OTHER player's view).
export function makeNameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(8, 4, 112, 40, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(52, 44); ctx.lineTo(76, 44); ctx.lineTo(64, 60); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.8, 1);
  sprite.renderOrder = 20;
  return sprite;
}
