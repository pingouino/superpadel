// Calcul des coups : du choix (type, visée, puissance) à la vitesse initiale de la balle.
import { BALL_R, GRAVITY, HALF_W, HALF_L, netHeight, clamp, lerp, gauss, teamSide, teamRight } from './constants.js';
import { DRAG, MAGNUS } from './physics.js';

// Noms affichés
export const SHOT_NAMES = {
  drive: 'Liftado', slice: 'Cortado', lob: 'Globo',
  smash: 'Remate', bandeja: 'Bandeja', vibora: 'Víbora',
  volley: 'Volée', volleySlice: 'Volée coupée', volleyLob: 'Volée lobée',
  drop: 'Amortie', serve: 'Service', serveSlice: 'Service coupé', serveKick: 'Service lifté',
};

// Simule une trajectoire sans murs ni filet pour trouver le point d'impact au sol.
function flight(x, y, z, vx, vy, vz, top, side) {
  const dt = 1 / 200;
  let netClear = Infinity;
  let t = 0;
  for (let i = 0; i < 1400; i++) {
    const sp = Math.hypot(vx, vy, vz);
    const vh = Math.hypot(vx, vz);
    let ax = -DRAG * sp * vx, ay = -GRAVITY - DRAG * sp * vy, az = -DRAG * sp * vz;
    if (vh > 0.2) {
      ay -= MAGNUS * top * vh;
      ax += MAGNUS * side * vh * (-vz / vh);
      az += MAGNUS * side * vh * (vx / vh);
    }
    vx += ax * dt; vy += ay * dt; vz += az * dt;
    const pz = z;
    x += vx * dt; y += vy * dt; z += vz * dt;
    top *= 1 - 0.12 * dt; side *= 1 - 0.12 * dt;
    t += dt;
    if ((pz > 0) !== (z > 0)) netClear = Math.min(netClear, y - BALL_R - netHeight(x));
    if (y <= BALL_R && vy < 0) return { x, z, t, netClear };
  }
  return { x, z, t, netClear };
}

// Trouve la vitesse pour atterrir sur (tx, tz) avec une vitesse horizontale hs.
export function solveShot(from, tx, tz, hs, top, side, minClear, maxIter = 6) {
  let ax = tx, az = tz;
  let v = null;
  let speed = hs;
  for (let iter = 0; iter < maxIter + 6; iter++) {
    const dx = ax - from.x, dz = az - from.z;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const T = dist / speed;
    const vy = (BALL_R - from.y + 0.5 * GRAVITY * T * T) / T;
    v = { vx: dx / T, vy, vz: dz / T };
    const land = flight(from.x, from.y, from.z, v.vx, v.vy, v.vz, top, side);
    if (land.netClear < minClear && speed > 6) {
      speed *= 0.9;
      continue;
    }
    const ex = tx - land.x, ez = tz - land.z;
    if (Math.abs(ex) + Math.abs(ez) < 0.06) break;
    ax += ex; az += ez;
  }
  return v;
}

// Paramètres de base selon la famille de coup.
// d = distance de la cible au filet (0..10) dans le camp adverse.
function shotProfile(kind, power) {
  switch (kind) {
    case 'drive': return { dMin: 5.2, dMax: 9.0, hs: 14 + 10 * power, top: 160 + 170 * power, side: 0, clear: 0.22 };
    case 'slice': return { dMin: 3.4, dMax: 8.7, hs: 12 + 7 * power, top: -230 - 80 * power, side: 0, clear: 0.15 };
    case 'lob': return { dMin: 7.4, dMax: 9.5, lobT: 2.15 - 0.35 * power, top: 60, side: 0, clear: 1.6 };
    case 'volley': return { dMin: 4.0, dMax: 8.8, hs: 13 + 8 * power, top: 40, side: 0, clear: 0.12 };
    case 'volleySlice': return { dMin: 2.6, dMax: 7.5, hs: 10 + 6 * power, top: -220, side: 0, clear: 0.1 };
    case 'volleyLob': return { dMin: 7.6, dMax: 9.4, lobT: 1.85 - 0.25 * power, top: 30, side: 0, clear: 1.3 };
    case 'smash': return { dMin: 3.0, dMax: 7.4, hs: 21 + 12 * power, top: 30, side: 0, clear: 0.12 };
    case 'bandeja': return { dMin: 6.4, dMax: 9.1, hs: 14 + 6 * power, top: -200, side: 0, clear: 0.3 };
    case 'vibora': return { dMin: 5.6, dMax: 8.8, hs: 17 + 8 * power, top: -160, side: 160, clear: 0.2 };
    case 'serve': return { dMin: 4.4, dMax: 6.6, hs: 12.5 + 6 * power, top: 80, side: 0, clear: 0.12 };
    case 'serveSlice': return { dMin: 4.0, dMax: 6.4, hs: 11 + 4.5 * power, top: -200, side: 0, clear: 0.12 };
    case 'serveKick': return { dMin: 4.6, dMax: 6.6, hs: 11 + 4 * power, top: 260, side: 0, clear: 0.3 };
    default: return shotProfile('drive', power);
  }
}

// Choisit la famille de coup à partir du bouton et du contexte.
export function shotKind(button, ctx) {
  if (ctx.serve) return button === 'slice' ? 'serveSlice' : button === 'lob' ? 'serveKick' : 'serve';
  if (ctx.overhead) return button === 'slice' ? 'bandeja' : button === 'lob' ? 'vibora' : 'smash';
  if (ctx.volley) return button === 'slice' ? 'volleySlice' : button === 'lob' ? 'volleyLob' : 'volley';
  return button;
}

// ctx : { team, from{x,y,z}, button, aimX, aimZ, power, quality, errSigma, rng, serve, serveBoxSign,
//         overhead, volley, target? {x, d} }
export function computeShot(ctx) {
  const kind = shotKind(ctx.button, ctx);
  const p = clamp(ctx.power, 0, 1);
  const prof = shotProfile(kind, p);
  const oz = -teamSide(ctx.team); // signe z du camp adverse
  const right = teamRight(ctx.team);
  const rng = ctx.rng;

  let tx, d;
  if (ctx.target) {
    tx = ctx.target.x;
    d = ctx.target.d;
  } else if (ctx.serve) {
    const bs = ctx.serveBoxSign;
    tx = bs * clamp(2.5 + ctx.aimX * right * bs * 1.7, 0.6, 4.4);
    d = lerp(prof.dMin, prof.dMax, (clamp(ctx.aimZ, -1, 1) + 1) / 2);
  } else {
    const neutral = clamp(-ctx.from.x * 0.35, -1.6, 1.6);
    tx = Math.abs(ctx.aimX) > 0.2 ? ctx.aimX * right * 3.6 + ctx.from.x * 0.08 : neutral;
    let az = clamp(ctx.aimZ, -1, 1);
    // Sans direction : profondeur "par défaut" plutôt longue
    const tt = Math.abs(az) < 0.2 ? 0.62 : (az + 1) / 2;
    d = lerp(prof.dMin, prof.dMax, tt);
    if (kind === 'vibora' || kind === 'smash') tx = Math.abs(ctx.aimX) > 0.2 ? ctx.aimX * right * 3.8 : tx * 1.6;
  }

  // Erreurs
  const sig = ctx.errSigma || 0;
  if (sig > 0) {
    tx += gauss(rng) * sig * 0.9;
    d += gauss(rng) * sig;
  }
  tx = clamp(tx, -HALF_W - 0.8, HALF_W + 0.8);
  d = clamp(d, 0.6, HALF_L + 1.2);
  const tz = oz * d;

  let hs;
  if (prof.lobT) {
    const dist = Math.hypot(tx - ctx.from.x, tz - ctx.from.z);
    hs = dist / prof.lobT;
  } else {
    hs = prof.hs;
  }

  // Une balle basse ne peut pas être frappée fort
  if (!ctx.overhead && ctx.from.y < 0.45 && !prof.lobT) hs *= 0.75 + ctx.from.y * 0.5;

  const clearErr = sig > 0 ? gauss(rng) * sig * 0.12 : 0;
  const v = solveShot(ctx.from, tx, tz, hs, prof.top, prof.side * right, prof.clear + clearErr);
  // Erreur verticale (balle dans le filet ou trop longue)
  if (sig > 0) {
    v.vy += gauss(rng) * sig * 0.18;
  }
  return { vx: v.vx, vy: v.vy, vz: v.vz, top: prof.top, side: prof.side * right, kind, target: { x: tx, z: tz } };
}
