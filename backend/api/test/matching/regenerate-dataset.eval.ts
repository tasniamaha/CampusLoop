// npm run eval:matching:generate. Rewrites data/synthetic.json from the generator.
// Only do this on purpose: the set is frozen so the scorer cannot be tuned to a moving target.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSynthetic } from './generate-synthetic.js';

const target = fileURLToPath(new URL('./data/synthetic.json', import.meta.url));

it('writes data/synthetic.json', () => {
  const dataset = generateSynthetic();
  writeFileSync(target, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Wrote ${dataset.queries.length} queries and ${dataset.pool.length} pool reports to ${target}`);
});
