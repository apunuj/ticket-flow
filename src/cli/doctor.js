import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { getBackend } from '../backends/index.js';
import { getTool } from '../render/index.js';
import { renderAll, MANIFEST_FILE, PKG_VERSION } from '../build.js';
import { renderDoc } from '../compose/composer.js';

// Diagnostics: each check returns { status: 'ok'|'warn'|'fail', label, detail?, fix? }.
const ok = (label, detail) => ({ status: 'ok', label, detail });
const warn = (label, detail, fix) => ({ status: 'warn', label, detail, fix });
const fail = (label, detail, fix) => ({ status: 'fail', label, detail, fix });

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', ...opts }).trim();
}

export function checkConfig(cfgPath) {
  try {
    const config = loadConfig(cfgPath);
    const detail = `${config.project.name} · ${config.backend.type} · ${config.tools.join(', ')}`;
    return { ...ok('config valid', detail), config };
  } catch (e) {
    return fail('config', e.message.split('\n')[0], 'fix ticket-flow.config.yaml, or run `ticket-flow init`');
  }
}

export function checkGitRepo() {
  try {
    sh('git rev-parse --is-inside-work-tree');
    return ok('git repository');
  } catch {
    return fail('git repository', 'not a git repo', 'run `git init`');
  }
}

export function checkGitRemote() {
  try {
    return ok('git remote', sh('git remote get-url origin'));
  } catch {
    return warn('git remote', 'no `origin` remote', 'add a GitHub remote so PRs work');
  }
}

export function checkGh() {
  try {
    sh('gh --version');
  } catch {
    return fail('gh CLI', 'not installed', 'install the GitHub CLI: https://cli.github.com');
  }
  try {
    sh('gh auth status');
    return ok('gh authenticated');
  } catch {
    return fail('gh authenticated', 'not logged in', 'run `gh auth login`');
  }
}

// Re-render the deterministic files and compare to disk — reports missing or drifted output.
export function checkDrift(config, root) {
  const expected = renderAll(config).map((f) => [f.path, f.content]);
  expected.push(['TICKET-FLOW.md', renderDoc({ config, backend: getBackend(config.backend.type) })]);

  const missing = [];
  const drifted = [];
  for (const [rel, content] of expected) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) missing.push(rel);
    else if (fs.readFileSync(p, 'utf8') !== content) drifted.push(rel);
  }
  if (missing.length)
    return fail('generated files', `${missing.length} missing (e.g. ${missing[0]})`, 'run `ticket-flow build`');
  if (drifted.length)
    return warn('generated files', `${drifted.length} out of date (e.g. ${drifted[0]})`, 're-run `ticket-flow build`');
  return ok('generated files', `${expected.length} present & current`);
}

// Compare the build manifest's version against the running package — a mismatch means
// the generated pack predates this ticket-flow release.
export function checkVersion(root) {
  const p = path.join(root, MANIFEST_FILE);
  if (!fs.existsSync(p))
    return warn('generation version', 'no build manifest found', 'run `ticket-flow upgrade`');
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (m.version === PKG_VERSION) return ok('generation version', `current (${PKG_VERSION})`);
    return warn(
      'generation version',
      `generated with ${m.version}, running ${PKG_VERSION}`,
      'run `ticket-flow upgrade`',
    );
  } catch {
    return warn('generation version', 'unreadable build manifest', 'run `ticket-flow upgrade`');
  }
}

// Verify the backend's MCP server is scaffolded into each configured tool's config.
export function checkMcp(config, root) {
  const backend = getBackend(config.backend.type);
  const missing = [];
  for (const toolId of config.tools) {
    const spec = getTool(toolId).mcpFile?.(backend);
    if (!spec) continue;
    const p = path.join(root, spec.path);
    let present = false;
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        present = !!(j[spec.key] && j[spec.key][spec.name]);
      } catch {
        /* unparseable -> treat as missing */
      }
    }
    if (!present) missing.push(`${toolId} (${spec.path})`);
  }
  if (missing.length)
    return warn('backend MCP configured', `not found for: ${missing.join(', ')}`, 'run `ticket-flow build`');
  return ok('backend MCP configured', `${backend.displayName} scaffolded for ${config.tools.join(', ')}`);
}

// A half-configured orchestrate split (exactly one model set) silently falls back to asking
// every run — warn and name the missing role. Empty string counts as unset, mirroring the
// render `and` helper, which treats "" as falsy. Both set or both unset is fine.
export function checkOrchestrate(config) {
  const o = (config && config.orchestrate) || {};
  const plannerSet = Boolean(o.plannerModel);
  const implementerSet = Boolean(o.implementerModel);
  if (plannerSet === implementerSet) {
    return ok(
      'orchestrate split',
      plannerSet ? `Planner ${o.plannerModel} · Implementer ${o.implementerModel}` : 'unset — asked per run',
    );
  }
  const missing = plannerSet ? 'implementerModel' : 'plannerModel';
  const set = plannerSet ? 'plannerModel' : 'implementerModel';
  return warn(
    'orchestrate split',
    `only ${set} set — ${missing} missing (falls back to asking each run)`,
    'set both orchestrate models or neither',
  );
}

const SYM = { ok: '✓', warn: '!', fail: '✗' };

export function doctor({ configPath, out } = {}) {
  const cfgPath = path.resolve(configPath || 'ticket-flow.config.yaml');
  const cfg = checkConfig(cfgPath);
  const results = [cfg];

  // git/gh checks run against your working repo; drift/MCP checks against the output dir.
  results.push(checkGitRepo(), checkGitRemote(), checkGh());
  if (cfg.config) {
    const root = path.resolve(out || cfg.config.output.dir || '.');
    results.push(checkDrift(cfg.config, root), checkMcp(cfg.config, root), checkVersion(root));
    results.push(checkOrchestrate(cfg.config));
  }

  console.log('ticket-flow doctor\n');
  for (const r of results) {
    console.log(` ${SYM[r.status]} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.status !== 'ok' && r.fix) console.log(`     → ${r.fix}`);
  }
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log(
    `\n${fails ? `${fails} blocking issue(s)` : 'No blocking issues'}${warns ? `, ${warns} warning(s)` : ''}.`,
  );
  return results;
}
