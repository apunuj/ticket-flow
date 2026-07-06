import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { build, MANIFEST_FILE, PKG_VERSION } from '../build.js';

// Optional top-level config blocks introduced after a config may have been generated.
// Each appends a commented snippet, so the config stays valid and the user opts in by
// uncommenting. Detection matches both live and commented-out keys — never append twice.
const CONFIG_MIGRATIONS = [
  {
    key: 'orchestrate',
    snippet: `
# Optional: model split for /orchestrate-ticket (omit to use your tool's defaults).
# orchestrate:
#   plannerModel: ""       # strongest model — plans and reviews
#   implementerModel: ""   # worker model — builds and fixes
`,
  },
];

// Uncommitted modifications among the given repo-relative paths (empty when not a git repo).
function uncommitted(root, rels) {
  if (!rels.length) return [];
  try {
    const out = execSync(`git status --porcelain -- ${rels.map((r) => `"${r}"`).join(' ')}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, ''));
  } catch {
    return []; // not a git repo — no baseline to guard against
  }
}

// Regenerate everything at the current package version:
//   1. drift guard  — abort if owned files carry uncommitted changes (hand edits) unless --force
//   2. build        — rewrite all rendered files + a fresh manifest
//   3. prune        — delete files the previous manifest owned that are no longer rendered
//   4. migrate      — append newly introduced optional config blocks; refresh the version stamp
export function runUpgrade({ configPath, out, cwd = process.cwd(), force = false } = {}) {
  const cfgPath = path.resolve(cwd, configPath || 'ticket-flow.config.yaml');
  const config = loadConfig(cfgPath);
  const root = path.resolve(cwd, out || config.output.dir || '.');

  const manifestPath = path.join(root, MANIFEST_FILE);
  let prev = null;
  if (fs.existsSync(manifestPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      /* unreadable — treat as first upgrade */
    }
  }
  const fromVersion = (prev && prev.version) || '(no manifest — pre-0.3 build)';
  const prevFiles = (prev && prev.files) || [];

  const dirty = uncommitted(root, prevFiles.filter((r) => fs.existsSync(path.join(root, r))));
  if (dirty.length && !force) {
    throw new Error(
      `refusing to overwrite: ${dirty.length} generated file(s) have uncommitted changes (possible hand edits):\n` +
        dirty.map((d) => `  ${d}`).join('\n') +
        '\nCommit or discard them first, or re-run with --force.',
    );
  }

  const written = build(config, { outputDir: root });

  // Prune only what the previous manifest owned and this build no longer renders.
  const current = new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files);
  const pruned = [];
  for (const rel of prevFiles) {
    const abs = path.join(root, rel);
    if (current.has(rel) || !fs.existsSync(abs)) continue;
    fs.rmSync(abs);
    let dir = path.dirname(abs);
    while (dir !== root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
    pruned.push(rel);
  }

  // Config migration: new optional blocks + a current version stamp.
  const migrated = [];
  let yaml = fs.readFileSync(cfgPath, 'utf8');
  for (const m of CONFIG_MIGRATIONS) {
    if (new RegExp(`^\\s*#?\\s*${m.key}:`, 'm').test(yaml)) continue;
    yaml = yaml.replace(/\n*$/, '\n') + m.snippet;
    migrated.push(m.key);
  }
  if (/generated for Ticket-Flow \d+(\.\d+)*/.test(yaml)) {
    yaml = yaml.replace(/generated for Ticket-Flow \d+(\.\d+)*/, `generated for Ticket-Flow ${PKG_VERSION}`);
  } else {
    yaml = `# ticket-flow.config.yaml — generated for Ticket-Flow ${PKG_VERSION}.\n` + yaml;
  }
  fs.writeFileSync(cfgPath, yaml);

  return { fromVersion, toVersion: PKG_VERSION, written, pruned, migrated, forcedOver: force ? dirty : [] };
}

// CLI wrapper: run + report.
export function upgrade(flags = {}) {
  const res = runUpgrade(flags);
  console.log(`ticket-flow upgrade: ${res.fromVersion} → ${res.toVersion}\n`);
  console.log(`  regenerated ${res.written.length} files`);
  if (res.pruned.length) for (const p of res.pruned) console.log(`  pruned ${p} (no longer generated)`);
  if (res.migrated.length) console.log(`  config: added optional block(s): ${res.migrated.join(', ')} (commented — edit to enable)`);
  if (res.forcedOver.length) console.log(`  --force overwrote ${res.forcedOver.length} file(s) that had uncommitted changes`);
  console.log('\nReview the diff and commit. Run `ticket-flow doctor` to confirm.');
  return res;
}
