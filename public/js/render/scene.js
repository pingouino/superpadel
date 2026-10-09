// Rendu Three.js : caméra façon "Virtua Tennis", balle, ombres, effets.
import * as THREE from '../vendor/three.module.min.js';
import { buildCourt } from './court.js';
import { buildArena } from './arena.js';
import { Character, TEAM_COLORS } from './character.js';
import { clamp } from '../core/constants.js';

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,20,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,20,0.3)');
  grd.addColorStop(1, 'rgba(0,0,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,250,200,0.9)');
  grd.addColorStop(1, 'rgba(255,240,150,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Trebuchet MS", Arial';
  g.textAlign = 'center';
  g.lineWidth = 7;
  g.strokeStyle = '#1b1530';
  g.strokeText(text, 64, 32);
  g.fillStyle = color;
  g.fillText(text, 64, 32);
  g.beginPath();
  g.moveTo(52, 44); g.lineTo(76, 44); g.lineTo(64, 60); g.closePath();
  g.fill();
  g.stroke();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GameRenderer {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x34408a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(-6, 18, 8);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.6);
    fill.position.set(8, 10, -10);
    scene.add(fill);

    this.court = buildCourt(scene, renderer);
    this.arena = buildArena(scene);

    // Balle
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0xe8ff3a, emissive: 0x4a5a00 }),
    );
    scene.add(this.ball);
    const blob = blobTexture();
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    scene.add(this.ballShadow);

    // Traînée de la balle
    this.trailN = 16;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.trailN * 3), 3));
    const cols = new Float32Array(this.trailN * 3);
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.blobTex = blob;
    this.starTex = starTexture();
    this.chars = [];
    this.shadows = [];
    this.markers = [];
    this.particles = [];
    this.camX = 0;
    this.camSide = 1;
    this.shake = 0;
    this.time = 0;
    this.orbit = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // garder toute la largeur de la piste visible, même en portrait
    this.camera.fov = clamp(42 * (1.6 / Math.max(0.5, this.camera.aspect)), 40, 75);
    this.camera.updateProjectionMatrix();
  }

  // players : [{ char, team, name, label, local }]
  setupPlayers(players) {
    for (const c of this.chars) this.scene.remove(c.root);
    for (const s of this.shadows) this.scene.remove(s);
    for (const m of this.markers) if (m) this.scene.remove(m);
    this.chars = []; this.shadows = []; this.markers = [];
    for (const p of players) {
      const c = new Character(p.char, p.team);
      this.scene.add(c.root);
      this.chars.push(c);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.006;
      this.scene.add(sh);
      this.shadows.push(sh);
      let marker = null;
      if (p.label) {
        const tc = TEAM_COLORS[p.team];
        marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.label, p.local ? '#ffffff' : tc.css), depthTest: false, transparent: true }));
        marker.scale.set(0.8, 0.4, 1);
        marker.renderOrder = 10;
        this.scene.add(marker);
        if (p.local) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: tc.shirt, transparent: true, opacity: 0.85, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.012;
          sh.add(ring);
          ring.rotation.x = 0;
          ring.position.set(0, 0, 0.001);
        }
      }
      this.markers.push(marker);
    }
  }

  setCameraSide(sign) {
    this.camSide = sign;
    this.court.setCameraSide(sign);
  }

  burst(x, y, z, scale = 1, color = 0xffffff, n = 6) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 0.5;
      const sp = (1 + Math.random() * 2) * scale;
      this.particles.push({ s, vx: Math.cos(a) * sp, vy: e * sp + 1, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.2, max: 0.5, size: 0.25 * scale });
      this.scene.add(s);
    }
  }

  dust(x, z, strength = 1) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.blobTex, color: 0xaad4ff, transparent: true, depthWrite: false, opacity: 0.6 }));
      s.position.set(x, 0.05, z);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ s, vx: Math.cos(a) * 0.6 * strength, vy: 0.4, vz: Math.sin(a) * 0.6 * strength, life: 0.4, max: 0.4, size: 0.3 * strength, grow: true });
      this.scene.add(s);
    }
  }

  confetti() {
    const colors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff8fd8, 0x4ef0c8];
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
      m.position.set((Math.random() - 0.5) * 10, 6 + Math.random() * 4, (Math.random() - 0.5) * 18);
      this.particles.push({ s: m, vx: (Math.random() - 0.5) * 0.6, vy: -1 - Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 5 + Math.random() * 2, max: 7, confetti: true, spin: Math.random() * 6 });
      this.scene.add(m);
    }
  }

  // view : { players: [...], ball: {x,y,z,visible}, focus: {x,z} }
  render(view, dt) {
    this.time += dt;
    const t = this.time;

    for (let i = 0; i < this.chars.length; i++) {
      const st = view.players[i];
      if (!st) continue;
      this.chars[i].update(st, dt);
      const sh = this.shadows[i];
      sh.position.x = st.x; sh.position.z = st.z;
      const m = this.markers[i];
      if (m) m.position.set(st.x, 1.85 + Math.sin(t * 4) * 0.04 + (st.jump || 0), st.z);
    }

    const b = view.ball;
    this.ball.visible = b.visible;
    this.ballShadow.visible = b.visible && b.y < 8;
    if (b.visible) {
      this.ball.position.set(b.x, b.y, b.z);
      this.ballShadow.position.set(b.x, 0.008, b.z);
      const s = 1 + Math.min(1.5, b.y * 0.25);
      this.ballShadow.scale.set(s, s, s);
      this.ballShadow.material.opacity = clamp(1 - b.y * 0.12, 0.3, 1);
    }
    // traînée
    this.trailPts.unshift([b.x, b.y, b.z]);
    if (this.trailPts.length > this.trailN) this.trailPts.length = this.trailN;
    const pos = this.trail.geometry.attributes.position;
    const col = this.trail.geometry.attributes.color;
    const speed = b.speed || 0;
    const k = b.visible ? clamp((speed - 8) / 16, 0, 1) : 0;
    for (let i = 0; i < this.trailN; i++) {
      const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
      pos.setXYZ(i, p[0], p[1], p[2]);
      const f = (1 - i / this.trailN) * k;
      col.setXYZ(i, f, f, f * 0.4);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    // particules
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.s);
        p.s.material.dispose();
        if (p.confetti) p.s.geometry.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      if (p.confetti) {
        p.s.rotation.x += p.spin * dt; p.s.rotation.y += p.spin * 0.7 * dt;
        if (p.s.position.y < 0.02) { p.s.position.y = 0.02; p.vx = p.vz = p.vy = 0; p.spin = 0; }
      } else {
        p.vy -= 3 * dt;
        const f = p.life / p.max;
        const sz = p.grow ? p.size * (2 - f) : p.size * (0.4 + f);
        p.s.scale.set(sz, sz, sz);
        p.s.material.opacity = f;
      }
    }

    this.arena.update(dt, t);

    // Caméra
    const side = this.camSide;
    if (this.orbit) {
      const a = t * 0.12;
      this.camera.position.set(Math.sin(a) * 19, 8 + Math.sin(t * 0.3), Math.cos(a) * 19);
      this.camera.lookAt(0, 0.5, 0);
    } else {
      const f = view.focus || { x: 0, z: 0 };
      const targetX = clamp(f.x * 0.45 + (b.visible ? b.x * 0.2 : 0), -2.6, 2.6);
      this.camX += (targetX - this.camX) * Math.min(1, dt * 3);
      const portrait = this.camera.aspect < 1.1;
      const camY = portrait ? 9.5 : 6.0;
      const camZ = portrait ? 19 : 16.2;
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const sh = this.shake * this.shake;
      this.camera.position.set(this.camX + (Math.random() - 0.5) * sh * 0.3, camY + (Math.random() - 0.5) * sh * 0.3, side * camZ);
      this.camera.lookAt(this.camX * 0.55, 0, side * (portrait ? 0 : 1.8));
    }
    this.renderer.render(this.scene, this.camera);
  }
}
