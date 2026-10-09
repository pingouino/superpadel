// Piste de padel : sol bleu, lignes, vitres, grillage, filet.
import * as THREE from '../vendor/three.module.min.js';
import { HALF_W, HALF_L, SERVICE_LINE, BACK_GLASS_H, BACK_WALL_H } from '../core/constants.js';

function courtTexture(maxAniso) {
  const W = 1024, H = 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1f63c9';
  g.fillRect(0, 0, W, H);
  // texture "gazon synthétique"
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n * 0.5; d[i + 1] += n * 0.7; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // bandes de tonte subtiles
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < H; y += 256) g.fillRect(0, y, W, 128);
  const ppm = W / (HALF_W * 2);
  const lw = 0.05 * ppm;
  g.fillStyle = '#ffffff';
  const zToY = z => (z + HALF_L) * ppm;
  // lignes de service
  for (const s of [-1, 1]) g.fillRect(0, zToY(s * SERVICE_LINE) - lw / 2, W, lw);
  // ligne centrale (entre les lignes de service)
  g.fillRect(W / 2 - lw / 2, zToY(-SERVICE_LINE), lw, zToY(SERVICE_LINE) - zToY(-SERVICE_LINE));
  // petites marques au fond
  for (const s of [-1, 1]) g.fillRect(W / 2 - lw / 2, s > 0 ? H - 0.2 * ppm : 0, lw, 0.2 * ppm);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function meshTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(30,36,48,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(25,25,35,1)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildCourt(scene, renderer) {
  const group = new THREE.Group();
  scene.add(group);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  // Sol de la piste
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_W * 2, HALF_L * 2),
    new THREE.MeshLambertMaterial({ map: courtTexture(aniso) }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // Abords de la piste
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_W * 2 + 4, HALF_L * 2 + 4),
    new THREE.MeshLambertMaterial({ color: 0x174a9a }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  group.add(apron);

  const glassMat = new THREE.MeshPhongMaterial({
    color: 0xcfeeff, transparent: true, opacity: 0.13, shininess: 120, specular: 0xffffff,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const glassMatNear = glassMat.clone();
  glassMatNear.opacity = 0.05;
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x23293a });
  const mt = meshTexture();
  const meshMatBase = new THREE.MeshLambertMaterial({ map: mt, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: true });

  const walls = { near: [], far: [] }; // éléments masquables selon le côté de la caméra

  function meshPanel(w, h, x, y, z, ry, tag) {
    const tex = mt.clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 0.12, h / 0.12);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), meshMatBase.clone());
    m.material.map = tex;
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    if (tag) walls[tag].push(m);
    return m;
  }

  function glassPanel(w, h, x, y, z, ry, tag) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.renderOrder = 2;
    group.add(m);
    if (tag) walls[tag].push(m);
    return m;
  }

  function post(x, z, h, tag) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), frameMat);
    p.position.set(x, h / 2, z);
    group.add(p);
    if (tag) walls[tag].push(p);
  }

  function rail(x1, z1, x2, z2, y, tag) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), frameMat);
    r.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    r.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(r);
    if (tag) walls[tag].push(r);
  }

  for (const s of [-1, 1]) {
    const tag = s > 0 ? 'near' : 'far';
    const z = s * HALF_L;
    // Fond : 4 vitres de 2,5 m + grillage
    for (let i = 0; i < 4; i++) {
      const x = -HALF_W + 1.25 + i * 2.5;
      const gp = glassPanel(2.5, BACK_GLASS_H, x, BACK_GLASS_H / 2, z, 0, tag);
      if (s > 0) gp.material = glassMatNear;
      post(-HALF_W + i * 2.5, z, BACK_WALL_H, tag);
    }
    post(HALF_W, z, BACK_WALL_H, tag);
    meshPanel(HALF_W * 2, BACK_WALL_H - BACK_GLASS_H, 0, (BACK_WALL_H + BACK_GLASS_H) / 2, z, 0, tag);
    rail(-HALF_W, z, HALF_W, z, BACK_GLASS_H, tag);
    rail(-HALF_W, z, HALF_W, z, BACK_WALL_H, tag);

    // Côtés
    for (const sx of [-1, 1]) {
      const x = sx * HALF_W;
      // 2 m de vitre haute (3 m) près du fond
      glassPanel(2, 3, x, 1.5, s * 9, Math.PI / 2);
      meshPanel(2, 1, x, 3.5, s * 9, Math.PI / 2);
      // 2 m de vitre basse (2 m)
      glassPanel(2, 2, x, 1, s * 7, Math.PI / 2);
      meshPanel(2, 1, x, 2.5, s * 7, Math.PI / 2);
      // grillage jusqu'au filet
      meshPanel(6, 3, x, 1.5, s * 3, Math.PI / 2);
      for (const pz of [10, 8, 6, 4, 2, 0]) post(x, s * pz, pz >= 8 ? 4 : 3);
      rail(x, s * 10, x, s * 8, 4);
      rail(x, s * 8, x, 0, 3);
      rail(x, s * 10, x, s * 8, 3);
      rail(x, s * 8, x, s * 6, 2);
    }
  }

  // Filet
  const ntex = netTexture();
  ntex.repeat.set(10 / 0.05, 0.88 / 0.05);
  const netMat = new THREE.MeshBasicMaterial({ map: ntex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, color: 0x333344 });
  const netGeo = new THREE.PlaneGeometry(HALF_W * 2, 0.88, 1, 1);
  // relève les bords pour suivre la hauteur aux poteaux
  const pos = netGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + (Math.abs(pos.getX(i)) / HALF_W) * 0.04);
  }
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(0, 0.44, 0);
  group.add(net);
  const bandGeo = new THREE.BoxGeometry(HALF_W * 2, 0.06, 0.03);
  const band = new THREE.Mesh(bandGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  band.position.set(0, 0.87, 0);
  group.add(band);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), frameMat);
    p.position.set(sx * (HALF_W + 0.02), 0.5, 0);
    group.add(p);
  }

  return {
    group,
    setCameraSide(sign) {
      // la paroi côté caméra est quasi invisible pour ne pas gêner la vue
      for (const m of walls.near) m.visible = sign < 0;
      for (const m of walls.far) m.visible = sign > 0;
      for (const m of [...walls.near, ...walls.far]) {
        if (m.material === glassMat || m.material === glassMatNear) m.visible = true;
      }
      // vitres : la proche plus transparente
      for (const m of walls.near) if (m.material === glassMat || m.material === glassMatNear) m.material = sign > 0 ? glassMatNear : glassMat;
      for (const m of walls.far) if (m.material === glassMat || m.material === glassMatNear) m.material = sign > 0 ? glassMat : glassMatNear;
    },
  };
}
