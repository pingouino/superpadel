// Personnages "chibi" : grosse tête, petit corps, animations procédurales.
import * as THREE from '../vendor/three.module.min.js';

export const ROSTER = [
  { name: 'Pipo', skin: 0xffd9b8, hair: 0xff7a1a, style: 'spiky', eyes: 0x2b1d14 },
  { name: 'Lola', skin: 0xf6c9a5, hair: 0xff5fa2, style: 'ponytail', eyes: 0x2b1d14 },
  { name: 'Kiki', skin: 0xffe3cc, hair: 0x8a5cf6, style: 'cat', eyes: 0x1d2b4a },
  { name: 'Momo', skin: 0xc98e64, hair: 0x3b2618, style: 'cap', eyes: 0x1a1a1a, cap: 0xff3b5c },
  { name: 'Nano', skin: 0xffd9b8, hair: 0xffe066, style: 'bob', eyes: 0x1d3a2b },
  { name: 'Tita', skin: 0xe9b48a, hair: 0x2ecc71, style: 'buns', eyes: 0x2b1d14 },
  { name: 'Bubu', skin: 0xffcfa8, hair: 0xf1f1f1, style: 'band', eyes: 0x1a1a1a, band: 0x18b7ff },
  { name: 'Coco', skin: 0x8d5a3b, hair: 0x1b1b1b, style: 'afro', eyes: 0x111111 },
];

export const TEAM_COLORS = [
  { shirt: 0xff8a3d, shorts: 0xffffff, accent: 0xffd23f, name: 'Soleil', css: '#ff8a3d' },
  { shirt: 0x9b5cff, shorts: 0x2a2250, accent: 0x4ef0c8, name: 'Lune', css: '#9b5cff' },
];

let gradientMap = null;
function toonGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 170, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const matCache = new Map();
export function toon(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
  matCache.set(key, m);
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b1530, side: THREE.BackSide });

function addOutline(mesh, s = 1.06) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(s);
  mesh.add(o);
  return o;
}

const G = {
  sphere: new THREE.SphereGeometry(1, 24, 18),
  sphereLo: new THREE.SphereGeometry(1, 12, 10),
  cap: new THREE.CapsuleGeometry(1, 1, 6, 12),
  cone: new THREE.ConeGeometry(1, 1, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  torus: new THREE.TorusGeometry(1, 0.28, 8, 20, Math.PI),
  ring: new THREE.TorusGeometry(1, 0.18, 8, 24),
};

function mesh(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy ?? sx, sz ?? sx);
  m.position.set(x, y, z);
  return m;
}

let racketTex = null;
function racketTexture() {
  if (racketTex) return racketTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1530';
  for (let y = 18; y < 120; y += 13) {
    for (let x = 18; x < 120; x += 13) {
      const dx = (x - 64) / 54, dy = (y - 64) / 58;
      if (dx * dx + dy * dy < 0.75) {
        g.beginPath(); g.arc(x + ((y / 13) % 2) * 6, y, 3.2, 0, Math.PI * 2); g.fill();
      }
    }
  }
  racketTex = new THREE.CanvasTexture(c);
  racketTex.colorSpace = THREE.SRGBColorSpace;
  return racketTex;
}

function buildRacket(color) {
  const g = new THREE.Group();
  const handle = mesh(G.cyl, toon(0x222222), 0.022, 0.16, 0.022, 0, -0.06, 0);
  g.add(handle);
  const frame = mesh(G.cyl, toon(color), 0.14, 0.035, 0.125, 0, -0.27, 0);
  frame.rotation.x = Math.PI / 2;
  g.add(frame);
  const faceMat = new THREE.MeshToonMaterial({ map: racketTexture(), gradientMap: toonGradient(), color: 0xf4f4ff });
  const face = new THREE.Mesh(new THREE.CircleGeometry(1, 24), faceMat);
  face.scale.set(0.125, 0.115, 1);
  face.position.set(0, -0.27, 0.019);
  g.add(face);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.019;
  g.add(back);
  addOutline(frame, 1.08);
  return g;
}

export class Character {
  constructor(charIdx, team) {
    const def = ROSTER[charIdx % ROSTER.length];
    const tc = TEAM_COLORS[team];
    this.def = def;
    this.team = team;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const skin = toon(def.skin);
    const shirt = toon(tc.shirt);
    const shorts = toon(tc.shorts);
    const shoe = toon(0xffffff);
    const sole = toon(tc.accent);

    // Jambes
    this.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.09, 0.4, 0);
      const leg = mesh(G.cap, skin, 0.06, 0.13, 0.06, 0, -0.16, 0);
      pivot.add(leg);
      const sh = mesh(G.sphere, shoe, 0.085, 0.06, 0.12, 0, -0.33, 0.035);
      pivot.add(sh);
      const so = mesh(G.sphere, sole, 0.088, 0.025, 0.122, 0, -0.365, 0.035);
      pivot.add(so);
      this.body.add(pivot);
      this.legs.push(pivot);
    }

    // Torse
    this.torso = new THREE.Group();
    this.torso.position.y = 0.42;
    this.body.add(this.torso);
    const sh = mesh(G.cyl, shorts, 0.165, 0.12, 0.15, 0, 0.03, 0);
    this.torso.add(sh);
    const chest = mesh(G.sphere, shirt, 0.19, 0.22, 0.165, 0, 0.2, 0);
    this.torso.add(chest);
    addOutline(chest, 1.07);
    // numéro / logo
    const badge = mesh(G.sphere, toon(tc.accent), 0.05, 0.05, 0.02, 0.06, 0.25, 0.155);
    this.torso.add(badge);

    // Tête
    this.head = new THREE.Group();
    this.head.position.y = 0.4;
    this.torso.add(this.head);
    const headMesh = mesh(G.sphere, skin, 0.29, 0.27, 0.27, 0, 0.27, 0);
    this.head.add(headMesh);
    addOutline(headMesh, 1.05);

    const eyeMat = toon(def.eyes);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = mesh(G.sphere, eyeMat, 0.048, 0.068, 0.03, sx * 0.1, 0.26, 0.245);
      e.rotation.y = sx * 0.35;
      const hl = mesh(G.sphereLo, white, 0.35, 0.3, 0.5, -0.25 * sx + 0.1, 0.35, 0.7);
      e.add(hl);
      this.head.add(e);
      this.eyes.push(e);
      const blush = mesh(G.sphereLo, new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.6 }), 0.05, 0.028, 0.015, sx * 0.175, 0.18, 0.22);
      blush.rotation.y = sx * 0.6;
      this.head.add(blush);
    }
    const mouth = mesh(G.torus, toon(0x7a2b2b), 0.035, 0.03, 0.03, 0, 0.165, 0.262);
    mouth.rotation.z = Math.PI;
    this.head.add(mouth);
    this.mouth = mouth;

    this.buildHair(def);

    // Bras
    this.armR = new THREE.Group();
    this.armR.position.set(-0.19, 0.27, 0);
    this.torso.add(this.armR);
    const aR = mesh(G.cap, skin, 0.045, 0.13, 0.045, 0, -0.13, 0);
    this.armR.add(aR);
    const sleeveR = mesh(G.sphere, shirt, 0.065, 0.06, 0.065, 0, -0.01, 0);
    this.armR.add(sleeveR);
    const handR = mesh(G.sphere, skin, 0.05, 0.05, 0.05, 0, -0.27, 0);
    this.armR.add(handR);
    this.racket = buildRacket(tc.shirt);
    this.racket.position.set(0, -0.27, 0);
    this.armR.add(this.racket);

    this.armL = new THREE.Group();
    this.armL.position.set(0.19, 0.27, 0);
    this.torso.add(this.armL);
    this.armL.add(mesh(G.cap, skin, 0.045, 0.13, 0.045, 0, -0.13, 0));
    this.armL.add(mesh(G.sphere, shirt, 0.065, 0.06, 0.065, 0, -0.01, 0));
    this.armL.add(mesh(G.sphere, skin, 0.05, 0.05, 0.05, 0, -0.27, 0));

    this.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; });

    this.runPhase = Math.random() * 6;
    this.blinkT = 1 + Math.random() * 3;
    this.time = Math.random() * 10;
  }

  buildHair(def) {
    const hair = toon(def.hair);
    const h = this.head;
    const add = (m) => { h.add(m); return m; };
    switch (def.style) {
      case 'spiky': {
        add(mesh(G.sphere, hair, 0.3, 0.2, 0.29, 0, 0.36, -0.02));
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const c = add(mesh(G.cone, hair, 0.08, 0.2, 0.08, Math.cos(a) * 0.15, 0.5, Math.sin(a) * 0.15 - 0.03));
          c.rotation.z = -Math.cos(a) * 0.6; c.rotation.x = Math.sin(a) * 0.6;
        }
        break;
      }
      case 'ponytail': {
        add(mesh(G.sphere, hair, 0.305, 0.23, 0.295, 0, 0.34, -0.03));
        const t = add(mesh(G.sphere, hair, 0.09, 0.2, 0.09, 0, 0.32, -0.33));
        t.rotation.x = 0.6;
        add(mesh(G.sphere, toon(0xffffff), 0.05, 0.05, 0.05, 0, 0.42, -0.28));
        add(mesh(G.sphere, hair, 0.12, 0.07, 0.07, 0, 0.47, 0.2));
        break;
      }
      case 'cat': {
        add(mesh(G.sphere, hair, 0.31, 0.24, 0.3, 0, 0.33, -0.03));
        for (const sx of [-1, 1]) {
          const ear = add(mesh(G.cone, hair, 0.09, 0.16, 0.06, sx * 0.17, 0.58, 0));
          ear.rotation.z = -sx * 0.35;
          const inner = add(mesh(G.cone, toon(0xffb3cf), 0.05, 0.1, 0.03, sx * 0.17, 0.56, 0.03));
          inner.rotation.z = -sx * 0.35;
        }
        break;
      }
      case 'cap': {
        add(mesh(G.sphere, hair, 0.3, 0.2, 0.295, 0, 0.3, -0.04));
        const capM = toon(def.cap || 0xff3b5c);
        add(mesh(G.sphere, capM, 0.305, 0.2, 0.3, 0, 0.4, 0));
        const brim = add(mesh(G.cyl, capM, 0.2, 0.02, 0.16, 0, 0.42, 0.24));
        brim.rotation.x = 0.15;
        add(mesh(G.sphere, toon(0xffffff), 0.04, 0.04, 0.04, 0, 0.6, 0));
        break;
      }
      case 'bob': {
        add(mesh(G.sphere, hair, 0.325, 0.27, 0.31, 0, 0.3, -0.03));
        add(mesh(G.sphere, hair, 0.25, 0.08, 0.1, 0, 0.42, 0.21));
        break;
      }
      case 'buns': {
        add(mesh(G.sphere, hair, 0.305, 0.22, 0.295, 0, 0.35, -0.03));
        for (const sx of [-1, 1]) add(mesh(G.sphere, hair, 0.11, 0.11, 0.11, sx * 0.2, 0.55, -0.02));
        break;
      }
      case 'band': {
        add(mesh(G.sphere, hair, 0.3, 0.15, 0.29, 0, 0.4, -0.05));
        const band = add(mesh(G.cyl, toon(def.band || 0x18b7ff), 0.3, 0.06, 0.29, 0, 0.38, 0));
        void band;
        // moustache
        for (const sx of [-1, 1]) {
          const m = add(mesh(G.sphere, hair, 0.06, 0.025, 0.03, sx * 0.045, 0.2, 0.258));
          m.rotation.z = sx * 0.3;
        }
        break;
      }
      case 'afro': {
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2;
          add(mesh(G.sphere, hair, 0.13, 0.13, 0.13, Math.cos(a) * 0.22, 0.42 + Math.sin(i * 1.7) * 0.05, Math.sin(a) * 0.2 - 0.05));
        }
        add(mesh(G.sphere, hair, 0.27, 0.22, 0.25, 0, 0.5, -0.04));
        break;
      }
    }
  }

  // state : { x, z, vx, vz, face, jump, armed, armKind, swingKind, swingT, mood, time }
  update(st, dt) {
    this.time += dt;
    const r = this.root;
    r.position.set(st.x, 0, st.z);
    r.rotation.y = st.face;
    const speed = Math.hypot(st.vx, st.vz);

    // vitesse dans le repère local (avant = +z local)
    const sin = Math.sin(st.face), cos = Math.cos(st.face);
    const fwd = st.vx * sin + st.vz * cos;
    const side = st.vx * cos - st.vz * sin;

    let bodyY = 0, lean = 0, roll = 0, torsoYaw = 0;
    let legA = 0;
    if (speed > 0.3) {
      this.runPhase += dt * (6 + speed * 2.2);
      const s = Math.sin(this.runPhase);
      legA = s * Math.min(1, speed / 3) * 0.9;
      bodyY = Math.abs(Math.cos(this.runPhase)) * 0.05 * Math.min(1, speed / 3);
      lean = fwd * 0.04;
      roll = -side * 0.04;
    } else {
      // petit sautillement d'attente
      bodyY = Math.abs(Math.sin(this.time * 4.5)) * 0.015;
      this.runPhase *= 0.9;
    }
    this.legs[0].rotation.x = legA;
    this.legs[1].rotation.x = -legA;
    if (Math.abs(side) > Math.abs(fwd) && speed > 0.3) {
      // pas chassés
      this.legs[0].rotation.z = Math.sin(this.runPhase) * 0.35;
      this.legs[1].rotation.z = Math.sin(this.runPhase) * 0.35;
    } else {
      this.legs[0].rotation.z = 0;
      this.legs[1].rotation.z = 0;
    }

    // Bras : position de garde par défaut
    let aRx = -0.9, aRy = 0, aRz = 0.35;
    let aLx = -0.6, aLz = -0.3;
    let headTilt = 0;
    const jumpY = st.jump > 0 ? Math.sin(Math.min(1, st.jump / 0.3) * Math.PI * 0.5) * 0.35 : 0;

    if (speed > 0.3) {
      aLx = -0.3 - legA * 0.7;
    }

    const sk = st.swingKind;
    if (sk) {
      const t = st.swingT; // secondes depuis la frappe
      const p = Math.min(1, t / 0.32);
      const e = 1 - Math.pow(1 - p, 3);
      if (sk === 'fh') {
        torsoYaw = 0.9 - e * 1.7;
        aRx = -1.2; aRz = 1.35 - e * 0.3; aRy = 0.3;
      } else if (sk === 'bh') {
        torsoYaw = -1.0 + e * 1.8;
        aRx = -1.4; aRz = -0.6 + e * 0.9; aRy = -0.6 + e * 0.6;
        aLx = -1.0;
      } else if (sk === 'oh') {
        aRx = -2.9 + e * 2.2; aRz = 0.2;
        torsoYaw = 0.3 - e * 0.6;
        aLx = -2.2 + e * 1.5;
      } else if (sk === 'serve') {
        aRx = 0.8 - e * 2.3; aRz = 0.2;
        torsoYaw = 0.4 - e * 0.6;
      }
    } else if (st.armed) {
      // préparation (back-swing)
      const k = st.armKind;
      if (k === 'oh') { aRx = -2.9; aRz = 0.3; aLx = -2.4; torsoYaw = 0.35; }
      else if (k === 'bh') { torsoYaw = -1.0; aRx = -1.3; aRz = -0.6; aRy = -0.6; aLx = -1.1; }
      else { torsoYaw = 0.9; aRx = -1.1; aRz = 1.35; aRy = 0.3; }
    }

    if (st.mood === 'happy') {
      const j = Math.abs(Math.sin(this.time * 7));
      bodyY += j * 0.18;
      aRx = -2.8 + Math.sin(this.time * 14) * 0.2; aLx = -2.8 - Math.sin(this.time * 14) * 0.2;
      aRz = 0.5; aLz = -0.5;
      torsoYaw = Math.sin(this.time * 3) * 0.3;
    } else if (st.mood === 'sad') {
      headTilt = 0.35;
      aRx = -0.2; aLx = -0.1; aRz = 0.15; aLz = -0.15;
      lean = 0.15;
    }

    this.body.position.y = bodyY + jumpY;
    this.body.rotation.x = lean;
    this.body.rotation.z = roll;
    this.torso.rotation.y = torsoYaw;
    this.head.rotation.y = -torsoYaw * 0.6;
    this.head.rotation.x = headTilt;
    this.armR.rotation.set(aRx, aRy, aRz);
    this.armL.rotation.set(aLx, 0, aLz);

    // clignement
    this.blinkT -= dt;
    let eyeS = 1;
    if (this.blinkT < 0) {
      eyeS = 0.12;
      if (this.blinkT < -0.1) this.blinkT = 2 + Math.random() * 3;
    }
    if (st.mood === 'happy') eyeS = 0.35;
    for (const e of this.eyes) e.scale.y = 0.068 * eyeS;
    this.mouth.scale.set(st.mood === 'happy' ? 0.05 : 0.035, st.mood === 'sad' ? -0.03 : 0.03, 0.03);
  }
}

// Vignette (portrait) d'un personnage, rendue hors écran
export function renderPortraits(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6677aa, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6);
  dl.position.set(1, 2, 3);
  scene.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  cam.position.set(0, 1.1, 2.4);
  cam.lookAt(0, 0.95, 0);
  const out = [];
  for (let i = 0; i < ROSTER.length; i++) {
    const c = new Character(i, i % 2);
    c.update({ x: 0, z: 0, vx: 0, vz: 0, face: 0.25, jump: 0, mood: null }, 0.016);
    c.blinkT = 9;
    for (const e of c.eyes) e.scale.y = 0.068;
    scene.add(c.root);
    r.render(scene, cam);
    out.push(canvas.toDataURL());
    scene.remove(c.root);
  }
  r.dispose();
  r.forceContextLoss?.();
  return out;
}
