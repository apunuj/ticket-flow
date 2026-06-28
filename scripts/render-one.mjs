// Ad-hoc renderer for development: node scripts/render-one.mjs <skill> <backend> <tool>
import { renderSkill } from '../src/compose/composer.js';
import { parseConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [skill = 'next-ticket', backendId = 'linear', toolId = 'claude'] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = parseConfig(fs.readFileSync(path.join(root, 'examples', 'example.config.yaml'), 'utf8'));
const backend = (await import(`../src/backends/${backendId}.js`)).default;
const tool = (await import(`../src/render/${toolId}.js`)).default;

const out = renderSkill(skill, { config, backend, tool });
console.log(`# PATH: ${out.path}\n`);
console.log(out.content);
