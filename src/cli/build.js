import path from 'node:path';
import { loadConfig } from '../config.js';
import { build } from '../build.js';

export function runBuild({ configPath, out } = {}) {
  const cfgPath = path.resolve(configPath || 'ticketflow.config.yaml');
  const config = loadConfig(cfgPath);
  const written = build(config, { outputDir: out });

  const byTool = {};
  for (const { tool, path: p } of written) (byTool[tool] ||= []).push(p);

  const root = path.resolve(out || config.output.dir || '.');
  console.log(`Built ${written.length} files for backend "${config.backend.type}" into ${root}\n`);
  for (const tool of Object.keys(byTool)) {
    console.log(`  ${tool}:`);
    for (const p of byTool[tool]) console.log(`    ${p}`);
  }
  return written;
}
