import path from 'node:path';
import { loadConfig } from '../config.js';
import { build } from '../build.js';
import { getTool } from '../render/index.js';

export function runBuild({ configPath, out } = {}) {
  const cfgPath = path.resolve(configPath || 'ticket-flow.config.yaml');
  const config = loadConfig(cfgPath);
  const written = build(config, { outputDir: out });

  const byTool = {};
  for (const f of written) (byTool[f.tool] ||= []).push(f);

  // How each configured tool starts a phase: `/next-ticket`, or e.g. `$next-ticket in Codex`
  // for a tool with its own syntax.
  const shortcuts = [...new Set(config.tools.map((id) => {
    const t = getTool(id);
    return t.invoke ? `${t.invoke('next-ticket')} in ${t.displayName}` : '/next-ticket';
  }))];

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
  2. On first launch, approve the scaffolded ${config.backend.type} MCP server + run \`gh auth login\` (see TICKET-FLOW.md).
  3. Try it now — ask your assistant: "what should I work on next?"  (or run ${shortcuts.join(', or ')})

Run \`ticket-flow doctor\` anytime to check your setup (config, git, gh, files, MCP).`);
  return written;
}
