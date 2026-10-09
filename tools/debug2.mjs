import { Sim } from '../public/js/core/sim.js';
const sim = new Sim({ seed: 1000, aiLevel: 2, introTime: 0.1 });
let rally = [];
while (sim.time < 3600) {
  sim.tick();
  for (const e of sim.events) {
    if (e.type === 'hit') { rally.push(e); }
    if (e.type === 'setup') rally = [];
  }
  sim.events.length = 0;
  if (rally.length > 80) break;
}
for (const e of rally.slice(40, 60)) {
  const p = sim.players[e.id];
  console.log(e.id, e.kind, 'pow', e.power.toFixed(2), 'sp', e.speed.toFixed(1), 'at', e.x.toFixed(2), e.y.toFixed(2), e.z.toFixed(2));
}
