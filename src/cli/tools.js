// `ticket-flow add <tool>` / `remove <tool>` — change which agents the repo generates for
// without hand-editing YAML. The point is switching agents mid-project (your Codex limits run
// out, you move to Claude Code) costing one command instead of a config edit you have to
// remember. Both rewrite the `tools:` list in place, rebuild, and report what changed; `remove`
// also prunes the dropped tool's generated files.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadConfig } from '../config.js';
import { getTool, tools as RENDERERS } from '../render/index.js';
import { build, pruneStale, MANIFEST_FILE } from '../build.js';

export const ALL_TOOL_IDS = Object.keys(RENDERERS);

function manifestFiles(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_FILE), 'utf8')).files || [];
  } catch {
    return []; // no (or unreadable) manifest — nothing known to prune
  }
}

// Rewrite `tools:` to `list`, keeping every comment and unrelated key in the file. Mutating an
// existing sequence node preserves the comment attached to it; replacing the node drops it, so
// that path is only taken when there is no sequence to mutate (`tools: all`, or a fresh key).
export function writeToolsList(cfgPath, list) {
  const doc = YAML.parseDocument(fs.readFileSync(cfgPath, 'utf8'));
  const seq = doc.get('tools', true);
  if (seq && Array.isArray(seq.items)) {
    const have = seq.items.map((n) => (n && n.value !== undefined ? n.value : n));
    for (const id of list) if (!have.includes(id)) seq.add(id);
    for (let i = seq.items.length - 1; i >= 0; i--) {
      const v = seq.items[i] && seq.items[i].value !== undefined ? seq.items[i].value : seq.items[i];
      if (!list.includes(v)) seq.delete(i);
    }
  } else {
    doc.set('tools', list);
  }
  fs.writeFileSync(cfgPath, doc.toString());
}

// Validate requested ids up front so a typo never half-applies: one unknown id aborts the whole
// command with the same "Unknown tool" message the renderer registry raises.
function validate(ids) {
  if (!ids.length) {
    throw new Error(`Name at least one tool. Available: ${ALL_TOOL_IDS.join(', ')}.`);
  }
  for (const id of ids) getTool(id);
}

function resolve({ configPath, out, cwd }) {
  const cfgPath = path.resolve(cwd, configPath || 'ticket-flow.config.yaml');
  const config = loadConfig(cfgPath); // `tools: all` is already expanded to a list here
  const root = path.resolve(cwd, out || config.output.dir || '.');
  return { cfgPath, config, root };
}

// Add one or more tools to the config and generate their files. Idempotent: a tool already
// configured is reported as such and still rebuilt, so a half-written pack repairs itself.
export function runAdd({ tools: requested = [], configPath, out, cwd = process.cwd() } = {}) {
  validate(requested);
  const { cfgPath, config, root } = resolve({ configPath, out, cwd });

  const before = config.tools;
  const added = requested.filter((id) => !before.includes(id));
  const already = requested.filter((id) => before.includes(id));
  const after = [...before, ...added];

  // A config that says `all` already covers every tool, present and future — leave it alone.
  const literal = YAML.parse(fs.readFileSync(cfgPath, 'utf8')).tools;
  if (literal !== 'all' && added.length) writeToolsList(cfgPath, after);

  const written = build({ ...config, tools: after }, { outputDir: root });
  return { added, already, tools: after, written, all: literal === 'all' };
}

// Drop one or more tools from the config and delete the files they owned. Refuses to empty the
// list — a config with no tools renders nothing and fails schema validation on the next load.
export function runRemove({ tools: requested = [], configPath, out, cwd = process.cwd() } = {}) {
  validate(requested);
  const { cfgPath, config, root } = resolve({ configPath, out, cwd });

  const before = config.tools;
  const removed = requested.filter((id) => before.includes(id));
  const absent = requested.filter((id) => !before.includes(id));
  const after = before.filter((id) => !requested.includes(id));

  if (!after.length) {
    throw new Error(
      `Refusing to remove every tool — ${before.join(', ')} would leave nothing to generate. ` +
        'Keep at least one, or delete ticket-flow.config.yaml to uninstall.',
    );
  }

  const prevFiles = manifestFiles(root);
  // `tools: all` is expanded here on purpose: dropping one tool from "everything" has to become
  // an explicit list, or the next build would silently re-add it.
  if (removed.length) writeToolsList(cfgPath, after);

  const written = build({ ...config, tools: after }, { outputDir: root });
  const pruned = removed.length ? pruneStale(root, prevFiles) : [];
  return { removed, absent, tools: after, written, pruned };
}

// Files a given tool contributed to this build — used to report what `add` actually created.
function filesFor(written, ids) {
  return written.filter((f) => ids.includes(f.tool)).map((f) => f.path);
}

export function add(flags = {}) {
  const res = runAdd(flags);
  for (const id of res.already) console.log(`  ${id} — already configured`);
  if (res.all) {
    console.log('  config is `tools: all` — every tool is generated already, config unchanged');
  }
  for (const p of filesFor(res.written, res.added)) console.log(`  + ${p}`);
  console.log(
    res.added.length
      ? `\nAdded ${res.added.join(', ')}. Tools: ${res.tools.join(', ')}.`
      : `\nNothing to add. Tools: ${res.tools.join(', ')}.`,
  );
  console.log('Commit the new files so the workflow travels with the repo.');
  return res;
}

export function remove(flags = {}) {
  const res = runRemove(flags);
  for (const id of res.absent) console.log(`  ${id} — not configured, nothing to remove`);
  for (const p of res.pruned) console.log(`  - ${p}`);
  console.log(
    res.removed.length
      ? `\nRemoved ${res.removed.join(', ')}. Tools: ${res.tools.join(', ')}.`
      : `\nNothing to remove. Tools: ${res.tools.join(', ')}.`,
  );
  if (res.removed.length) {
    console.log(
      'Its MCP config was left in place — those files hold your own settings, so remove the ' +
        'server entry by hand if you want it gone.',
    );
  }
  return res;
}
