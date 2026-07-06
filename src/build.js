import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from './backends/index.js';
import { getTool } from './render/index.js';
import { renderForTool, renderDoc, PKG_ROOT } from './compose/composer.js';

export const MANIFEST_FILE = '.ticket-flow.manifest.json';
export const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'),
).version;

// Render every configured skill for every configured tool, against the configured backend.
// Returns [{ tool, kind, path, content }] without touching disk.
export function renderAll(config) {
  const backend = getBackend(config.backend.type);
  const out = [];
  for (const toolId of config.tools) {
    const tool = getTool(toolId);
    for (const file of renderForTool({ config, backend, tool })) {
      out.push({ tool: toolId, kind: file.kind, path: file.path, content: file.content, note: file.note });
    }
  }
  return out;
}

const OPENCODE_INSTRUCTION = './.opencode/ticket-flow.md';

// Wire the opencode workflow guide into opencode's always-on context via the `instructions`
// array in opencode.json — create-or-merge so an existing user config is never clobbered.
// Returns { path, action } describing what happened (or null if nothing to do).
export function wireOpencodeInstructions(root) {
  const jsonPath = path.join(root, 'opencode.json');
  const jsoncPath = path.join(root, 'opencode.jsonc');

  // Avoid creating a second, conflicting config next to an existing .jsonc.
  if (!fs.existsSync(jsonPath) && fs.existsSync(jsoncPath)) {
    return { path: 'opencode.jsonc', action: 'manual: add "' + OPENCODE_INSTRUCTION + '" to instructions' };
  }

  if (fs.existsSync(jsonPath)) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      return { path: 'opencode.json', action: 'manual: unparseable — add "' + OPENCODE_INSTRUCTION + '" to instructions' };
    }
    const list = Array.isArray(cfg.instructions) ? cfg.instructions : [];
    if (list.includes(OPENCODE_INSTRUCTION)) return { path: 'opencode.json', action: 'already wired' };
    cfg.instructions = [...list, OPENCODE_INSTRUCTION];
    fs.writeFileSync(jsonPath, JSON.stringify(cfg, null, 2) + '\n');
    return { path: 'opencode.json', action: 'merged' };
  }

  const fresh = {
    $schema: 'https://opencode.ai/config.json',
    instructions: [OPENCODE_INSTRUCTION],
  };
  fs.writeFileSync(jsonPath, JSON.stringify(fresh, null, 2) + '\n');
  return { path: 'opencode.json', action: 'created' };
}

// Add a remote MCP server into a tool's JSON config under `key`, keyed by `name`.
// Create-or-merge, non-clobbering: never overwrites an existing entry for that server,
// and preserves every other key. Returns { action }.
export function mergeMcpServer(filePath, key, name, server) {
  const existed = fs.existsSync(filePath);
  let cfg = {};
  if (existed) {
    try {
      cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return { action: `manual: unparseable — add "${name}" under "${key}"` };
    }
  }
  cfg[key] = cfg[key] || {};
  if (cfg[key][name]) return { action: 'already configured' };
  cfg[key][name] = server;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n');
  return { action: existed ? 'merged' : 'created' };
}

// Render and write to disk under outputDir (defaults to config.output.dir).
export function build(config, { outputDir } = {}) {
  const root = path.resolve(outputDir || config.output.dir || '.');
  const backend = getBackend(config.backend.type);
  const files = renderAll(config);
  for (const f of files) {
    const dest = path.join(root, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  const written = files.map((f) => ({ tool: f.tool, kind: f.kind, path: f.path, note: f.note }));

  // opencode's always-on guide needs a config reference; wire it in (create-or-merge).
  if (config.tools.includes('opencode')) {
    const w = wireOpencodeInstructions(root);
    if (w) written.push({ tool: 'opencode', kind: 'config', path: w.path, note: w.action });
  }

  // Scaffold the backend's remote MCP server into each tool's MCP config (create-or-merge,
  // non-clobbering) so connecting the backend is a one-time approval, not manual setup.
  for (const toolId of config.tools) {
    const spec = getTool(toolId).mcpFile?.(backend);
    if (!spec) continue;
    const r = mergeMcpServer(path.join(root, spec.path), spec.key, spec.name, spec.server);
    written.push({ tool: toolId, kind: 'mcp', path: spec.path, note: `MCP: ${r.action}` });
  }

  // Team onboarding reference at the repo root — tool-agnostic, one per repo.
  const doc = renderDoc({ config, backend });
  fs.writeFileSync(path.join(root, 'TICKET-FLOW.md'), doc);
  written.push({ tool: '(repo)', kind: 'doc', path: 'TICKET-FLOW.md', note: 'team onboarding reference' });

  // Manifest of the files this build OWNS — rendered output only. Merged tool configs
  // (opencode.json, .mcp.json) contain user state and are never pruned or overwritten
  // wholesale, so they stay out. `upgrade` prunes against it; `doctor` reads its version.
  const owned = written
    .filter((f) => ['skill', 'guide', 'overview', 'doc'].includes(f.kind))
    .map((f) => f.path);
  fs.writeFileSync(
    path.join(root, MANIFEST_FILE),
    JSON.stringify({ version: PKG_VERSION, files: owned }, null, 2) + '\n',
  );
  written.push({ tool: '(repo)', kind: 'manifest', path: MANIFEST_FILE, note: 'build manifest (read by upgrade/doctor)' });

  return written;
}
