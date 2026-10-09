// Ambiance autour de la piste : tribunes, public animé, panneaux LED, projecteurs, ciel.
import * as THREE from '../vendor/three.module.min.js';
import { toon } from './character.js';

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#0b1446');
  grd.addColorStop(0.45, '#2a3f9e');
  grd.addColorStop(0.75, '#5c7fe0');
  grd.addColorStop(1, '#9fc2ff');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ledTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 64);
  g.font = 'bold 40px "Trebuchet MS", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  let x = 10;
  while (x < 1024) {
    g.fillText(text, x, 34);
    x += g.measureText(text).width + 40;
  }
  // effet pixels LED
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 1024, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CROWD_COLORS = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xff8fd8, 0xffffff, 0xff9f45, 0x9b5cff, 0x2ec4b6, 0xf15bb5, 0xfee440, 0x00bbf9];
const SKINS = [0xffd9b8, 0xf6c9a5, 0xc98e64, 0x8d5a3b, 0xffe3cc, 0xe9b48a];

export function buildArena(scene) {
  const group = new THREE.Group();
  scene.add(group);

  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x2a3f9e, 45, 110);

  // Sol extérieur
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: 0x1a2350 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  group.add(ground);

  // Étoiles
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 0.9, r = 90;
    sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false, transparent: true, opacity: 0.8 }));
  group.add(stars);

  // Tribunes (gradins) sur les côtés et au fond
  const standMat = new THREE.MeshLambertMaterial({ color: 0x2b3a7a });
  const standMat2 = new THREE.MeshLambertMaterial({ color: 0x34489a });
  const seats = [];
  function stand(cx, cz, len, rows, dirX, dirZ, rotY) {
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5 + r * 0.55, 0.9), r % 2 ? standMat : standMat2);
      const off = r * 0.9;
      step.position.set(cx + dirX * off, (0.5 + r * 0.55) / 2, cz + dirZ * off);
      step.rotation.y = rotY;
      group.add(step);
      const n = Math.floor(len / 0.62);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.12) continue;
        const t = (i + 0.5) / n - 0.5;
        const lx = Math.cos(rotY) * t * len, lz = -Math.sin(rotY) * t * len;
        seats.push({ x: cx + dirX * off + lx + (Math.random() - 0.5) * 0.1, y: 0.5 + r * 0.55, z: cz + dirZ * off + lz, row: r });
      }
    }
  }
  stand(-9.5, 0, 22, 7, -1, 0, Math.PI / 2);
  stand(9.5, 0, 22, 7, 1, 0, Math.PI / 2);
  stand(0, -14, 18, 6, 0, -1, 0);

  // Public (instancié)
  const count = seats.length;
  const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.28, 4, 8);
  const headGeo = new THREE.SphereGeometry(0.17, 10, 8);
  const bodies = new THREE.InstancedMesh(bodyGeo, toon(0xffffff), count);
  const heads = new THREE.InstancedMesh(headGeo, toon(0xffffff), count);
  const color = new THREE.Color();
  const crowd = [];
  for (let i = 0; i < count; i++) {
    const s = seats[i];
    color.setHex(CROWD_COLORS[(Math.random() * CROWD_COLORS.length) | 0]);
    bodies.setColorAt(i, color);
    color.setHex(SKINS[(Math.random() * SKINS.length) | 0]);
    heads.setColorAt(i, color);
    crowd.push({ ...s, phase: Math.random() * 10, speed: 0.7 + Math.random() * 0.8, fan: Math.random() });
  }
  bodies.instanceColor.needsUpdate = true;
  heads.instanceColor.needsUpdate = true;
  group.add(bodies, heads);

  // Panneaux LED autour de la piste
  const leds = [];
  const ledDefs = [
    { text: '★ SUPER PADEL ★  ¡VAMOS!  ', bg: '#0a1030', fg: '#4ef0c8' },
    { text: '¡PUNTO DE ORO!  ★  PADEL TOUR  ★  ', bg: '#140a30', fg: '#ffd23f' },
    { text: 'BANDEJA · VÍBORA · REMATE · ', bg: '#0a1a30', fg: '#ff8fd8' },
  ];
  function led(w, x, z, ry, def) {
    const tex = ledTexture(def.text, def.bg, def.fg);
    tex.repeat.set(w / 8, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 0.12), [
      new THREE.MeshBasicMaterial({ color: 0x111122 }), new THREE.MeshBasicMaterial({ color: 0x111122 }),
      new THREE.MeshBasicMaterial({ color: 0x111122 }), new THREE.MeshBasicMaterial({ color: 0x111122 }),
      new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex }),
    ]);
    m.position.set(x, 0.38, z);
    m.rotation.y = ry;
    group.add(m);
    leds.push(tex);
  }
  led(22, -7.2, 0, Math.PI / 2, ledDefs[0]);
  led(22, 7.2, 0, -Math.PI / 2, ledDefs[1]);
  led(14, 0, -12.2, 0, ledDefs[2]);

  // Projecteurs
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x1a1f33 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe6 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 13, z = sz * 13;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 14, 8), towerMat);
      pole.position.set(x, 7, z);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.3), towerMat);
      head.position.set(x, 14, z);
      head.lookAt(0, 0, 0);
      group.add(head);
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), lampMat);
        l.position.set(-0.7 + (i % 3) * 0.7, i < 3 ? 0.3 : -0.3, 0.16);
        head.add(l);
      }

    }
  }

  // Écran géant au fond
  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 512; scoreCanvas.height = 256;
  const scoreTex = new THREE.CanvasTexture(scoreCanvas);
  scoreTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: scoreTex }));
  screen.position.set(0, 8.2, -19.8);
  group.add(screen);
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(8.5, 4.5, 0.3), towerMat);
  screenFrame.position.set(0, 8.2, -20);
  group.add(screenFrame);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), towerMat);
  legs.position.set(0, 3, -20);
  group.add(legs);

  // Plantes mignonnes dans les coins
  const potMat = toon(0xe07a5f), leafMat = toon(0x3ccf6e);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.5, 12), potMat);
      pot.position.set(sx * 6.6, 0.25, sz * 11.6);
      group.add(pot);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), leafMat);
      bush.position.set(sx * 6.6, 0.85, sz * 11.6);
      group.add(bush);
    }
  }

  const dummy = new THREE.Object3D();
  let excite = 0;
  let ledOffset = 0;

  function drawScreen(info) {
    const g = scoreCanvas.getContext('2d');
    g.fillStyle = '#060a24';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#4ef0c8';
    g.font = 'bold 34px "Trebuchet MS", Arial';
    g.textAlign = 'center';
    g.fillText('SUPER PADEL', 256, 46);
    if (info) {
      g.font = 'bold 30px "Trebuchet MS", Arial';
      for (let t = 0; t < 2; t++) {
        const y = 110 + t * 70;
        g.fillStyle = info.colors[t];
        g.textAlign = 'left';
        g.fillText(info.names[t], 24, y);
        g.textAlign = 'right';
        g.fillStyle = '#ffffff';
        g.fillText(`${info.sets[t]}   ${info.games[t]}   ${info.points[t]}`, 490, y);
      }
    }
    scoreTex.needsUpdate = true;
  }
  drawScreen(null);

  return {
    group,
    drawScreen,
    cheer(amount) { excite = Math.min(1.5, excite + amount); },
    update(dt, time) {
      excite = Math.max(0, excite - dt * 0.35);
      ledOffset += dt * 0.05;
      for (const t of leds) t.offset.x = ledOffset;
      for (let i = 0; i < count; i++) {
        const c = crowd[i];
        const e = excite * (0.4 + c.fan);
        const bob = Math.abs(Math.sin(time * c.speed * (2 + e * 4) + c.phase)) * (0.03 + e * 0.25);
        const sway = Math.sin(time * c.speed + c.phase) * 0.05;
        dummy.position.set(c.x + sway * 0.3, c.y + 0.31 + bob, c.z);
        dummy.rotation.set(0, 0, sway);
        dummy.updateMatrix();
        bodies.setMatrixAt(i, dummy.matrix);
        dummy.position.y += 0.36;
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
  };
}
