import path from 'node:path';
import { loadConfig } from '../config.js';
import { build } from '../build.js';

export function runBuild({ configPath, out } = {}) {
  const cfgPath = path.resolve(configPath || 'ticket-flow.config.yaml');
  const config = loadConfig(cfgPath);
  const written = build(config, { outputDir: out });

  const byTool = {};
  for (const f of written) (byTool[f.tool] ||= []).push(f);

  const root = path.resolve(out || config.output.dir || '.');
  console.log(`Built ${written.length} files for backend "${config.backend.type}" into ${root}\n`);
  for (const tool of Object.keys(byTool)) {
    console.log(`  ${tool}:`);
    for (const f of byTool[tool]) {
      const tag = f.kind === 'guide' ? '  (always-on guide)' : f.note ? `  (${f.note})` : '';
      console.log(`    ${f.path}${tag}`);
    }
  }
  console.log(
    `\nThe guide files make the workflow conversational (no slash command needed). Commit all generated files.`,
  );
  return written;
}
