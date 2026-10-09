// Un "humain" scripté : arme un coup dès que la balle vient vers lui, sans se déplacer lui-même (aide au placement seule).
import { Sim } from '../public/js/core/sim.js';
const sim = new Sim({ seed: 7, aiLevel: +(process.argv[2] ?? 2), introTime: 0.1, players: [{ ctrl: 'local', name: 'H' }, {}, {}, {}], match: { gamesPerSet: 4, setsToWin: 1 } });
const me = sim.players[0];
let hits = 0, pts = [0, 0], my = {};
let holdUntil = 0;
while (sim.phase !== 'matchEnd' && sim.time < 3600) {
  me.wantX = 0; me.wantZ = 0;
  me.aimX = Math.sin(sim.time) ; me.aimZ = 0.3;
  if (sim.phase === 'serve' && sim.serve.id === 0 && sim.serve.state === 'ready' && sim.phaseT > 1) sim.pressShot(me, 'drive');
  const incoming = sim.phase === 'rally' && sim.ref.lastHitTeam === 1;
  if (incoming && !me.armed && sim.time - sim.epochTime > 0.25) { sim.pressShot(me, ['drive','slice','lob'][(Math.random()*3)|0]); holdUntil = sim.time + 0.4; }
  me.held = sim.time < holdUntil;
  sim.tick();
  for (const e of sim.events) {
    if (e.type === 'hit' && e.id === 0) { hits++; my[e.kind] = (my[e.kind] || 0) + 1; }
    if (e.type === 'point') pts[e.winner]++;
  }
  sim.events.length = 0;
}
console.log('human hits', hits, my, 'points', pts, 'score', sim.match.setScores, 'reasons', sim.stats.reasons);
