import { Sim } from '../public/js/core/sim.js';
const sim = new Sim({ seed: 5, aiLevel: 2, introTime: 0.1 });
let n=0;
while (n < 15 && sim.time < 3000) {
  sim.tick();
  for (const e of sim.events) {
    if (e.type === 'point') {
      n++;
      const p = sim.players[e.player ?? 0];
      const br = sim.brains[p.id];
      console.log(e.reason, 'winner', e.winner, 'rally', e.rally, 'player', e.player, 'team', p.team, 'lastHitTeam', sim.ref.lastHitTeam,
        'ball', sim.ball.x.toFixed(2), sim.ball.y.toFixed(2), sim.ball.z.toFixed(2), 'p', p.x.toFixed(2), p.z.toFixed(2), 'armed', p.armed, 'plan', br?.plan && br.plan.mine, br?.plan?.T?.toFixed(2), 'now', sim.time.toFixed(2), 'notBefore', p.aiNotBefore.toFixed?.(2), 'valid', sim.ref.valid);
    }
  }
  sim.events.length = 0;
}
