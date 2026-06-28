import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from './backends/index.js';
import { getTool } from './render/index.js';
import { renderForTool } from './compose/composer.js';

// Render every configured skill for every configured tool, against the configured backend.
// Returns [{ tool, path, content }] without touching disk.
export function renderAll(config) {
  const backend = getBackend(config.backend.type);
  const out = [];
  for (const toolId of config.tools) {
    const tool = getTool(toolId);
    for (const file of renderForTool({ config, backend, tool })) {
      out.push({ tool: toolId, path: file.path, content: file.content });
    }
  }
  return out;
}

// Render and write to disk under outputDir (defaults to config.output.dir).
export function build(config, { outputDir } = {}) {
  const root = path.resolve(outputDir || config.output.dir || '.');
  const files = renderAll(config);
  for (const f of files) {
    const dest = path.join(root, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  return files.map((f) => ({ tool: f.tool, path: f.path }));
}
