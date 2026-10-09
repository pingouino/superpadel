// Dimensions officielles d'une piste de padel (en mètres).
// Repère : x = largeur (-5..5), z = longueur (-10..10, filet en z=0), y = hauteur.
// L'équipe 0 joue côté z > 0, l'équipe 1 côté z < 0.

export const HALF_W = 5;
export const HALF_L = 10;
export const SERVICE_LINE = 6.95; // distance filet -> ligne de service
export const BALL_R = 0.033;
export const GRAVITY = 9.81;

export const BACK_WALL_H = 4;   // vitre 3 m + grillage 1 m
export const BACK_GLASS_H = 3;

export const SIM_DT = 1 / 120;
export const BALL_SUBSTEPS = 2;

export function netHeight(x) {
  return 0.88 + 0.04 * Math.min(1, Math.abs(x) / HALF_W);
}

// Murs latéraux : vitres en escalier près du fond, grillage ailleurs.
export function sideWallHeight(z) {
  const a = Math.abs(z);
  if (a > 8) return 4;
  return 3;
}

export function sideGlassHeight(z) {
  const a = Math.abs(z);
  if (a > 8) return 3;
  if (a > 6) return 2;
  return 0;
}

// Côté du terrain d'une équipe (+1 pour l'équipe 0, -1 pour l'équipe 1).
export function teamSide(team) {
  return team === 0 ? 1 : -1;
}

// Direction "droite" vue par l'équipe (en x monde). L'équipe 0 regarde vers -z.
export function teamRight(team) {
  return team === 0 ? 1 : -1;
}

export const PLAYER_SPEED = 5.4;
export const PLAYER_ACCEL = 34;
export const REACH = 1.2;
export const MAX_HIT_H = 2.55;
export const SMASH_HIT_H = 2.95;

export const SHOT = { DRIVE: 'drive', SLICE: 'slice', LOB: 'lob' };

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
