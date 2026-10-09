// Test du netcode : un hôte (Sim) et un client (ClientWorld) reliés par un faux relais avec latence.
import { Sim } from '../public/js/core/sim.js';
import { ClientWorld } from '../public/js/core/client.js';
import { SIM_DT } from '../public/js/core/constants.js';

const LAT = +(process.argv[2] ?? 0.05); // latence aller simple
const slots = [{ name: 'H', ctrl: 'ai' }, { name: 'A', ctrl: 'ai' }, { name: 'C', ctrl: 'remote' }, { name: 'B', ctrl: 'ai' }];
const sim = new Sim({ seed: 3, aiLevel: 2, introTime: 0.2, players: slots, match: { gamesPerSet: 4, setsToWin: 1 } });
const cw = new ClientWorld(slots, 2);
cw.lag = LAT * 2;
const toClient = [], toHost = [];
let now = 0;
cw.onLocalHit = (m) => toHost.push({ at: now + LAT, d: m });
const fwd = (e) => {
  if (e.type === 'ball') return;
  const o = { ...e };
  if (e.type === 'setup') o.pos = sim.players.map(p => [p.x, p.z]);
  toClient.push({ at: now + LAT, d: { k: 'ev', e: o } });
};
fwd({ type: 'setup' });
let tick = 0, clientHits = 0, accepted = 0, rejected = 0, holdUntil = 0;
const me = cw.me;
while (sim.phase !== 'matchEnd' && now < 900) {
  now += SIM_DT;
  sim.tick(); tick++;
  for (const e of sim.events) { fwd(e); if (e.type === 'hit' && e.id === 2) accepted++; }
  sim.events.length = 0;
  if (tick % 4 === 0) toClient.push({ at: now + LAT, d: { k: 's', s: JSON.parse(JSON.stringify(sim.snapshot())) } });
  // livraison
  while (toClient.length && toClient[0].at <= now) {
    const m = toClient.shift().d;
    if (m.k === 's') cw.applySnapshot(m.s);
    else if (m.e.type === 'setup') cw.teleport(m.e.pos);
  }
  while (toHost.length && toHost[0].at <= now) {
    const m = toHost.shift().d;
    if (m.k === 'hit') { m.lag = LAT * 2; if (!sim.applyRemoteHit(sim.players[2], m)) rejected++; }
    else if (m.k === 'serve') { sim.players[2].held = true; sim.startServe(sim.players[2], m.b, 0.6, m.ax, m.ay); }
    else if (m.k === 'in') Object.assign(sim.players[2], m.v);
  }
  // le client joue à 120 Hz aussi
  let presses = [];
  if (cw.phase === 'serve' && cw.serve && cw.serve.id === 2 && cw.serve.state === 'ready' && Math.random() < 0.01) toHost.push({ at: now + LAT, d: { k: 'serve', b: 'drive', ax: 0, ay: 0.5 } });
  if (cw.phase === 'rally' && cw.ref.lastHitTeam === 0 && !me.armed) { me.armed = 'drive'; me.armT = cw.time; me.holdT = 0; holdUntil = now + 0.3; }
  if (cw.phase !== 'rally') me.armed = null;
  const before = cw.events.length;
  cw.update(SIM_DT, { wx: 0, wz: 0, mx: 0, my: 0.3, held: now < holdUntil });
  for (const e of cw.events) if (e.type === 'hit' && e.local) clientHits++;
  cw.events.length = 0;
  void before; void presses;
  if (tick % 6 === 0) toHost.push({ at: now + LAT, d: { k: 'in', v: { x: me.x, z: me.z, vx: me.vx, vz: me.vz, face: me.face, held: me.held, armed: me.armed ? 'drive' : null } } });
}
console.log('latency', LAT, 'client hits', clientHits, 'accepted', accepted, 'rejected', rejected, 'score', sim.match.setScores, sim.match.points, 'reasons', sim.stats.reasons);
