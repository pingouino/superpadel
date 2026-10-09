// Matchs IA contre IA sans rendu : vérifie que les échanges tiennent et que les règles se déclenchent.
import { Sim } from '../public/js/core/sim.js';

const level = +(process.argv[2] ?? 2);
const nMatches = +(process.argv[3] ?? 3);
let allReasons = {}, rallies = [], kinds = {};
for (let m = 0; m < nMatches; m++) {
  const sim = new Sim({ seed: 1000 + m, aiLevel: level, match: { gamesPerSet: 6, setsToWin: 1, golden: true }, introTime: 0.1 });
  let ticks = 0;
  while (sim.phase !== 'matchEnd' && ticks < 120 * 60 * 60) {
    sim.tick();
    for (const e of sim.events) {
      if (e.type === 'point') rallies.push(e.rally);
      if (e.type === 'hit') kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    }
    sim.events.length = 0;
    ticks++;
  }
  for (const [k, v] of Object.entries(sim.stats.reasons)) allReasons[k] = (allReasons[k] || 0) + v;
  console.log(`match ${m}: ${sim.match.setScores.map(s => s.join('-')).join(' ')} winner=${sim.match.winner} points=${sim.stats.points} time=${(sim.time / 60).toFixed(1)}min phase=${sim.phase}`);
}
const avg = rallies.reduce((a, b) => a + b, 0) / rallies.length;
console.log('avg hits/point', avg.toFixed(2), 'max', Math.max(...rallies));
console.log('reasons', allReasons);
console.log('shots', kinds);
