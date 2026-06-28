import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../compose/composer.js';

export function init({ force = false } = {}) {
  const src = path.join(PKG_ROOT, 'templates', 'ticketflow.config.yaml');
  const dest = path.resolve('ticketflow.config.yaml');

  if (fs.existsSync(dest) && !force) {
    console.log(`ticketflow.config.yaml already exists. Edit it, or re-run with --force to overwrite.`);
    return dest;
  }
  fs.copyFileSync(src, dest);
  console.log(`Created ${path.relative(process.cwd(), dest)}`);
  console.log(`\nNext:`);
  console.log(`  1. Edit ticketflow.config.yaml for your project (name, ticketPrefix, backend, baseBranch, testCommand).`);
  console.log(`  2. Run \`ticketflow build\` to generate the skills for your tools.`);
  return dest;
}
