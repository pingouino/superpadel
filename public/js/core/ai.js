// Intelligence artificielle des joueurs : lecture de trajectoire, placement, choix des coups.
import { clamp, lerp, teamSide, teamRight, REACH, PLAYER_SPEED, HALF_W } from './constants.js';

export const AI_LEVELS = [
  { name: 'Débutant', reaction: 0.42, speed: 0.8, err: 1.35, unforced: 0.14, smart: 0.15, power: 0.42, posErr: 0.75, smash: 0.25 },
  { name: 'Amateur', reaction: 0.31, speed: 0.87, err: 1.05, unforced: 0.09, smart: 0.35, power: 0.52, posErr: 0.55, smash: 0.45 },
  { name: 'Confirmé', reaction: 0.23, speed: 0.93, err: 0.98, unforced: 0.06, smart: 0.6, power: 0.62, posErr: 0.38, smash: 0.65 },
  { name: 'Pro', reaction: 0.16, speed: 0.99, err: 0.78, unforced: 0.035, smart: 0.8, power: 0.72, posErr: 0.22, smash: 0.82 },
  { name: 'Légende', reaction: 0.11, speed: 1.04, err: 0.6, unforced: 0.02, smart: 0.95, power: 0.8, posErr: 0.1, smash: 0.95 },
];

const HUMAN_SPEED = 1;

// Point où se placer pour frapper une balle en (bx, bz) : la balle sur le côté coup droit si possible.
function crossesBefore(samples, idx, st) {
  for (let j = 0; j < idx - 6; j++) {
    const s = samples[j];
    if (s.y < 1.4 && Math.abs(s.x - st.x) < 0.4 && Math.abs(s.z - st.z) < 0.4) return true;
  }
  return false;
}

export function standPoint(p, bx, bz, flip = false) {
  const ts = teamSide(p.team), r = teamRight(p.team);
  let side = 1;
  if (bx * r > 4.0) side = -1; // trop près de la vitre : revers
  if (flip) side = -side;
  const off = 0.55;
  let sx = bx - r * off * side;
  let sz = bz + ts * 0.2;
  sx = clamp(sx, -4.75, 4.75);
  sz = ts > 0 ? clamp(sz, 0.4, 9.75) : clamp(sz, -9.75, -0.4);
  return { x: sx, z: sz, side };
}

// Recherche du meilleur point d'interception sur la trajectoire prédite.
// Renvoie { cand, stand, margin, score } ou null.
export function bestIntercept(sim, p, speedMul, reaction, opts = {}) {
  const pred = sim.pred;
  if (!pred) return null;
  const ts = teamSide(p.team);
  const now = sim.time;
  const maxSpeed = PLAYER_SPEED * speedMul;
  let best = null;
  let bestLate = null;
  const samples = pred.samples;
  for (let i = 0; i < samples.length; i += 2) {
    const s = samples[i];
    const T = pred.t0 + s.t;
    if (T < now + 0.05) continue;
    if (T >= pred.t0 + pred.deadT - 0.01) break;
    if (s.z * ts < 0.25) continue;
    if (pred.isServe && !(s.t > pred.validT)) continue;
    if (s.y < 0.18 || s.y > 2.75) continue;
    if (s.y > 1.5 && s.y < 1.8) continue; // hauteur inconfortable
    if (opts.noDeadVolley && pred.hitterFault && s.t < pred.validT) continue;
    let st = standPoint(p, s.x, s.z);
    if (crossesBefore(samples, i, st)) {
      st = standPoint(p, s.x, s.z, true);
      if (crossesBefore(samples, i, st)) continue;
    }
    // la balle doit rester accessible depuis le point de placement
    const dist = Math.hypot(st.x - p.x, st.z - p.z);
    const travel = dist / maxSpeed + 0.12;
    const avail = T - now - reaction;
    const margin = avail - travel;
    const bounced = s.t > pred.validT;
    let score = 0;
    if (s.y > 1.8) score += opts.aggressive ? 0.6 : -0.1;
    else {
      const dev = s.y < 0.65 ? 0.65 - s.y : s.y > 1.25 ? s.y - 1.25 : 0;
      score -= dev * 1.6;
    }
    score += Math.min(margin, 0.7) * 1.4;
    if (!bounced && Math.abs(p.z) < 5.5) score += 0.35; // déjà au filet : volée
    if (Math.abs(s.z) > 9.35) score -= 0.5;
    if (Math.abs(s.x) > 4.6) score -= 0.4;
    const c = { s, T, stand: st, margin, score, bounced };
    if (margin >= 0) {
      if (!best || score > best.score) best = c;
    } else if (!bestLate || margin > bestLate.margin) {
      bestLate = c;
    }
  }
  return best || bestLate;
}

export class AIBrain {
  constructor(sim, p, levelIdx) {
    this.sim = sim;
    this.p = p;
    this.setLevel(levelIdx);
    this.plan = null;
    this.planEpoch = -1;
    this.nextPos = 0;
    this.posTarget = { x: p.x, z: p.z };
    this.serveAt = -1;
    this.errOff = { x: 0, z: 0 };
  }

  setLevel(i) {
    this.levelIdx = clamp(i | 0, 0, AI_LEVELS.length - 1);
    this.L = AI_LEVELS[this.levelIdx];
    this.p.speedMul = this.L.speed;
  }

  update(dt) {
    const sim = this.sim, p = this.p, L = this.L;
    p.wantX = 0; p.wantZ = 0;
    if (sim.phase === 'serve') return this.updateServe();
    if (sim.phase !== 'rally') {
      this.plan = null;
      return;
    }
    const ref = sim.ref;
    const incoming = ref.lastHitTeam >= 0 && ref.lastHitTeam !== p.team && !ref.result;

    if (incoming && sim.pred && sim.time >= sim.epochTime + L.reaction) {
      if (this.planEpoch !== sim.epoch) this.makePlan();
    } else if (!incoming) {
      this.plan = null;
    }

    if (this.plan && this.plan.mine) {
      const pl = this.plan;
      if (sim.time > pl.T + 0.3) {
        // raté : nouvelle tentative (ex. après la vitre)
        this.planEpoch = -1;
        this.plan = null;
        p.armed = null;
        return;
      }
      this.moveTo(pl.stand.x + this.errOff.x, pl.stand.z + this.errOff.z, 1);
      if (!p.armed && sim.time >= pl.T - pl.armLead) this.arm();
      return;
    }

    if (sim.time >= this.nextPos) {
      this.nextPos = sim.time + 0.15;
      this.posTarget = this.formation();
    }
    this.moveTo(this.posTarget.x, this.posTarget.z, 0.92);
  }

  updateServe() {
    const sim = this.sim, p = this.p;
    const sv = sim.serve;
    if (!sv) return;
    if (sv.id === p.id && sv.state === 'ready') {
      if (this.serveAt < 0) this.serveAt = sim.time + 0.8 + sim.rng() * 0.9;
      if (sim.time >= this.serveAt) {
        this.serveAt = -1;
        const r = sim.rng();
        const button = r < 0.55 ? 'drive' : r < 0.85 ? 'slice' : 'lob';
        const aimX = (sim.rng() * 2 - 1);
        const aimZ = 0.2 + sim.rng() * 0.8;
        sim.startServe(p, button, this.L.power * (0.75 + sim.rng() * 0.3), aimX, aimZ);
      }
    } else {
      this.serveAt = -1;
    }
  }

  moveTo(tx, tz, urgency) {
    const p = this.p;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const k = Math.min(1, d / 0.6) * urgency;
    p.wantX = dx / d * k;
    p.wantZ = dz / d * k;
  }

  makePlan() {
    const sim = this.sim, p = this.p, L = this.L;
    this.planEpoch = sim.epoch;
    const partner = sim.partnerOf(p);
    const opts = { aggressive: sim.rng() < L.smash, noDeadVolley: sim.rng() < L.smart };
    const mine = bestIntercept(sim, p, p.speedMul, 0, opts);
    let claim = sim.claims[p.team];
    if (!claim || claim.epoch !== sim.epoch) {
      // Décide qui joue la balle dans l'équipe
      let mineWins = true;
      if (partner) {
        const pSpeed = partner.ctrl === 'ai' ? partner.speedMul : HUMAN_SPEED;
        const theirs = bestIntercept(sim, partner, pSpeed, 0, opts);
        if (!mine) mineWins = false;
        else if (!theirs) mineWins = true;
        else {
          const mOk = mine.margin >= 0, tOk = theirs.margin >= 0;
          if (mOk && !tOk) mineWins = true;
          else if (!mOk && tOk) mineWins = false;
          else if (!mOk && !tOk) mineWins = mine.margin >= theirs.margin;
          else {
            // les deux peuvent : celui qui est du bon côté latéral
            const bx = mine.s.x;
            const midX = (p.x + partner.x) / 2;
            const mySideIsLeft = p.x < partner.x;
            const ballLeft = bx < midX;
            mineWins = mySideIsLeft === ballLeft;
            if (Math.abs(bx - midX) < 0.6) mineWins = mine.score >= theirs.score;
          }
        }
      }
      claim = { epoch: sim.epoch, id: mineWins ? p.id : partner.id };
      sim.claims[p.team] = claim;
    }
    if (claim.id === p.id && mine) {
      const armLead = 0.38 + sim.rng() * 0.25;
      const pe = L.posErr;
      this.errOff = { x: (sim.rng() * 2 - 1) * pe, z: (sim.rng() * 2 - 1) * pe * 0.5 };
      this.plan = { ...mine, mine: true, armLead };
      p.aiNotBefore = mine.T - 0.1;
    } else {
      this.plan = { mine: false };
      p.aiNotBefore = Infinity;
    }
  }

  arm() {
    const sim = this.sim, p = this.p;
    const b = sim.ball;
    const plan = this.plan && this.plan.s ? this.plan : { s: { x: b.x, y: b.y, z: b.z } };
    const choice = this.chooseShot(plan);
    p.armed = choice.button;
    p.aiPower = choice.power;
    p.aiTarget = choice.target;
    p.armT = sim.time;
  }

  // Choix tactique du coup et de la cible
  chooseShot(plan) {
    const sim = this.sim, p = this.p, L = this.L, rng = sim.rng;
    const s = plan.s;
    const myD = Math.abs(s.z);
    const opps = sim.players.filter(o => o.team !== p.team);
    const oppD = opps.reduce((a, o) => a + Math.abs(o.z), 0) / opps.length;
    const overhead = s.y > 1.8;
    const r = teamRight(p.team);
    let button = 'drive', power = L.power, dRange = [7.5, 8.8];
    const smart = rng() < L.smart;

    if (overhead) {
      if (myD < 6.5 && rng() < L.smash) {
        button = 'drive';
        power = clamp(L.power + 0.3, 0, 1);
        dRange = [3.5, 5.5];
        if (rng() < 0.5) {
          const side = rng() < 0.5 ? -1 : 1;
          return { button, power: Math.max(power, 0.85), target: { x: side * 3.9, d: 4 + rng() } };
        }
      } else {
        button = rng() < 0.7 ? 'slice' : 'lob';
        power = L.power;
        dRange = [7.0, 8.8];
      }
    } else if (oppD < 5.5) {
      // adversaires au filet
      if (myD > 6.5) {
        if (rng() < 0.45 + L.smart * 0.25) { button = 'lob'; power = 0.4 + rng() * 0.4; dRange = [8.4, 9.3]; }
        else { button = rng() < 0.5 ? 'slice' : 'drive'; power = L.power * 0.8; dRange = [5.0, 6.8]; }
      } else {
        button = rng() < 0.6 ? 'drive' : 'slice';
        dRange = [5.0, 7.5];
      }
    } else {
      // adversaires au fond
      if (myD < 5.5) {
        button = rng() < 0.5 ? 'slice' : 'drive';
        dRange = rng() < 0.5 ? [4.0, 6.0] : [7.5, 8.8];
        if (smart && rng() < 0.15) { button = 'slice'; dRange = [2.2, 3.4]; power = 0.15; }
      } else {
        button = rng() < 0.6 ? 'drive' : 'slice';
        dRange = [7.2, 8.8];
        if (smart && rng() < 0.12) { button = 'lob'; dRange = [8.6, 9.3]; power = 0.5; }
      }
    }
    if (s.y < 0.45 && !overhead) power *= 0.7;
    power = clamp(power + (rng() - 0.5) * 0.2, 0.1, 1);

    // Cible latérale : l'espace le plus libre
    const d = lerp(dRange[0], dRange[1], rng());
    const oz = -teamSide(p.team);
    const xs = [-3.6, -2.2, 0, 2.2, 3.6];
    let bestX = 0, bestScore = -Infinity;
    for (const x of xs) {
      let minD = Infinity;
      for (const o of opps) minD = Math.min(minD, Math.hypot(o.x - x, o.z - oz * d));
      const sc = (smart ? minD : minD * 0.3) + rng() * 1.2 - Math.abs(x) * 0.1;
      if (sc > bestScore) { bestScore = sc; bestX = x; }
    }
    const tx = clamp(bestX, -HALF_W + 0.9, HALF_W - 0.9);
    void r;
    return { button, power, target: { x: tx, d } };
  }

  // Erreur de frappe propre au niveau
  errSigma(difficulty) {
    const L = this.L;
    let sig = L.err * (1.05 + 1.7 * difficulty);
    if (this.sim.rng() < L.unforced) sig *= 3;
    return sig;
  }

  formation() {
    const sim = this.sim, p = this.p;
    const ts = teamSide(p.team);
    const ref = sim.ref;
    const partner = sim.partnerOf(p);
    let depth;
    if (ref.lastHitTeam === p.team) {
      depth = sim.teamAttack[p.team] ? 3.1 : 8.2;
    } else {
      const lobOver = sim.pred && sim.pred.landD > 7.5 && sim.pred.apex > 4;
      const claimer = partner && sim.claims[p.team] && sim.claims[p.team].id === partner.id && sim.claims[p.team].epoch === sim.epoch;
      if (lobOver) depth = 8.4;
      else if (claimer) depth = Math.abs(partner.z) < 5.5 ? 3.3 : 8.0;
      else depth = sim.teamAttack[p.team] ? 3.3 : 8.2;
    }
    const zone = partner ? (p.x <= partner.x ? -1 : 1) : p.zone;
    let bx = sim.ball.x;
    let x = zone * 2.3 + bx * 0.28;
    if (partner && Math.abs(x - partner.x) < 1.8) x = partner.x + zone * 1.8;
    x = clamp(x, -4.4, 4.4);
    return { x, z: ts * depth };
  }
}
