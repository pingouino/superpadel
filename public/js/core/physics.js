// Physique de la balle : gravité, traînée, effet Magnus, rebonds sol / vitres / grillage / filet.
import {
  HALF_W, HALF_L, BALL_R, GRAVITY, BACK_WALL_H, BACK_GLASS_H,
  netHeight, sideWallHeight, sideGlassHeight,
} from './constants.js';

export const DRAG = 0.0105;
export const MAGNUS = 0.00062;
const FLOOR_E = 0.74;
const GLASS_E = 0.72;
const MESH_E = 0.32;

export function makeBall() {
  return {
    x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0,
    top: 0, side: 0, outside: false, seed: 1234567, rolling: false, kick: false,
  };
}

export function copyBall(b, out = {}) {
  out.x = b.x; out.y = b.y; out.z = b.z;
  out.vx = b.vx; out.vy = b.vy; out.vz = b.vz;
  out.top = b.top; out.side = b.side;
  out.outside = b.outside; out.seed = b.seed; out.rolling = b.rolling; out.kick = b.kick;
  return out;
}

// Petit générateur déterministe porté par la balle pour que les prédictions soient exactes.
function brand(b) {
  let x = b.seed | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  b.seed = x | 0;
  return ((x >>> 0) % 100000) / 100000;
}

function pushEv(events, ev) {
  if (events) events.push(ev);
}

export function stepBall(b, dt, events) {
  const px = b.x, py = b.y, pz = b.z;

  if (!b.rolling) {
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const vh = Math.hypot(b.vx, b.vz);
    let ax = -DRAG * sp * b.vx;
    let ay = -GRAVITY - DRAG * sp * b.vy;
    let az = -DRAG * sp * b.vz;
    if (vh > 0.2) {
      ay -= MAGNUS * b.top * vh;
      const lx = -b.vz / vh, lz = b.vx / vh;
      ax += MAGNUS * b.side * vh * lx;
      az += MAGNUS * b.side * vh * lz;
    }
    b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
    const decay = 1 - 0.12 * dt;
    b.top *= decay; b.side *= decay;
  } else {
    const f = Math.max(0, 1 - 1.6 * dt);
    b.vx *= f; b.vz *= f;
  }

  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

  // Filet
  if ((pz > 0) !== (b.z > 0) && Math.abs(b.x) < HALF_W && !b.outside) {
    const f = pz / (pz - b.z);
    const yc = py + (b.y - py) * f;
    const xc = px + (b.x - px) * f;
    const nh = netHeight(xc);
    const from = pz > 0 ? 1 : -1;
    if (yc - BALL_R < nh) {
      if (yc > nh - BALL_R * 0.4 && brand(b) < 0.55) {
        // Bande du filet : la balle passe en perdant de la vitesse
        b.vz *= 0.42; b.vx *= 0.6;
        b.vy = Math.abs(b.vy) * 0.25 + 0.9;
        b.y = Math.max(b.y, nh + BALL_R);
        pushEv(events, { type: 'netcord', x: xc, y: yc, z: 0, from });
        pushEv(events, { type: 'cross', from, x: xc, y: yc });
      } else {
        b.z = from * (BALL_R + 0.02);
        b.vz = -b.vz * 0.1;
        b.vx *= 0.3;
        b.vy = b.vy * 0.2;
        b.top = 0; b.side = 0;
        pushEv(events, { type: 'net', x: xc, y: yc, z: 0, from, speed: Math.hypot(b.vx, b.vz) });
      }
    } else {
      pushEv(events, { type: 'cross', from, x: xc, y: yc });
    }
  }

  // Sol
  if (b.y < BALL_R) {
    b.y = BALL_R;
    if (b.vy < 0 && !b.rolling) {
      const impact = -b.vy;
      if (impact < 0.35) {
        b.vy = 0;
        b.rolling = true;
        pushEv(events, { type: 'floor', x: b.x, y: 0, z: b.z, speed: impact });
      } else {
        let e = FLOOR_E;
        if (impact < 1.5) e *= 0.85;
        let fh = 0.8;
        if (b.top > 0) fh = Math.min(0.97, 0.8 + 0.00045 * b.top);
        else if (b.top < 0) {
          fh = Math.max(0.5, 0.8 + 0.0006 * b.top);
          e *= Math.max(0.8, 1 + 0.0004 * b.top);
        }
        b.vy = impact * e;
        if (b.kick) { b.vy *= 1.6; fh = Math.max(fh, 0.92); b.kick = false; }
        b.vx *= fh; b.vz *= fh;
        if (b.side) {
          const vh = Math.hypot(b.vx, b.vz);
          if (vh > 0.2) {
            const k = 0.0012 * b.side;
            const ox = b.vx, oz = b.vz;
            b.vx += -oz * k;
            b.vz += ox * k;
          }
        }
        b.top *= 0.4; b.side *= 0.5;
        pushEv(events, { type: 'floor', x: b.x, y: 0, z: b.z, speed: impact });
      }
    }
  }

  if (b.outside) return;

  // Murs latéraux
  const limX = HALF_W - BALL_R;
  if (Math.abs(b.x) > limX && b.x * b.vx > 0) {
    const s = Math.sign(b.x);
    const h = sideWallHeight(b.z);
    if (b.y < h) {
      const glass = b.y < sideGlassHeight(b.z);
      const speed = Math.abs(b.vx);
      b.x = s * limX - (b.x - s * limX);
      wallBounce(b, 'x', glass);
      pushEv(events, { type: glass ? 'glass' : 'mesh', wall: 'side', x: s * HALF_W, y: b.y, z: b.z, speed });
    } else {
      b.outside = true;
      pushEv(events, { type: 'out', wall: 'side', x: b.x, y: b.y, z: b.z });
    }
  }

  // Murs du fond
  const limZ = HALF_L - BALL_R;
  if (Math.abs(b.z) > limZ && b.z * b.vz > 0 && !b.outside) {
    const s = Math.sign(b.z);
    if (b.y < BACK_WALL_H) {
      const glass = b.y < BACK_GLASS_H;
      const speed = Math.abs(b.vz);
      b.z = s * limZ - (b.z - s * limZ);
      wallBounce(b, 'z', glass);
      pushEv(events, { type: glass ? 'glass' : 'mesh', wall: 'back', x: b.x, y: b.y, z: s * HALF_L, speed });
    } else {
      b.outside = true;
      pushEv(events, { type: 'out', wall: 'back', x: b.x, y: b.y, z: b.z });
    }
  }
}

function wallBounce(b, axis, glass) {
  b.rolling = false;
  b.kick = false;
  if (glass) {
    const e = Math.max(0.45, Math.min(0.85, GLASS_E + 0.00035 * b.top));
    if (axis === 'x') { b.vx = -b.vx * e; b.vz *= 0.9; }
    else { b.vz = -b.vz * e; b.vx *= 0.9; }
    b.vy *= 0.9;
    if (b.top < 0) b.vy += 0.0025 * b.top; // la balle coupée "tombe" après la vitre
    b.top *= 0.5;
    b.side *= 0.5;
  } else {
    const r1 = brand(b) - 0.5, r2 = brand(b) - 0.5;
    if (axis === 'x') { b.vx = -b.vx * MESH_E; b.vz = b.vz * 0.6 + r1 * 1.6; }
    else { b.vz = -b.vz * MESH_E; b.vx = b.vx * 0.6 + r1 * 1.6; }
    b.vy = b.vy * 0.6 + r2 * 1.2;
    b.top = 0; b.side = 0;
  }
}

// Simule la trajectoire future (copie de la balle) et renvoie des échantillons + événements datés.
export function predictBall(ball, duration, dt = 1 / 240, sampleEvery = 4) {
  const b = copyBall(ball);
  const samples = [];
  const events = [];
  const evBuf = [];
  const steps = Math.ceil(duration / dt);
  for (let i = 1; i <= steps; i++) {
    evBuf.length = 0;
    stepBall(b, dt, evBuf);
    const t = i * dt;
    for (const e of evBuf) { e.t = t; events.push(e); }
    if (i % sampleEvery === 0 || evBuf.length) {
      samples.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, ev: evBuf.length ? evBuf.map(e => e.type) : null });
    }
    if (b.rolling && b.outside) break;
  }
  return { samples, events };
}
