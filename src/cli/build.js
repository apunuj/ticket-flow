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
      console.log(`    ${f.path}${f.note ? `  (${f.note})` : ''}`);
    }
  }
  console.log(`
Next steps:
  1. Commit the generated files so the skills travel with the repo.
  2. Connect your ${config.backend.type} MCP server + run \`gh auth login\` (see TICKET-FLOW.md).
  3. Try it now — ask your assistant: "what should I work on next?"  (or run /next-ticket)

Run \`ticket-flow check\` anytime to validate your setup.`);
  return written;
}
