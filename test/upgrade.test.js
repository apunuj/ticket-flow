import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { build, MANIFEST_FILE } from '../src/build.js';
import { runUpgrade } from '../src/cli/upgrade.js';
import { checkVersion } from '../src/cli/doctor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const exampleYaml = () => fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-upgrade-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Write a config + git repo so the drift guard has something to diff against.
function scaffold(dir, { yaml = exampleYaml(), git = true } = {}) {
  fs.writeFileSync(path.join(dir, 'ticket-flow.config.yaml'), yaml);
  if (git) {
    // CI runners have no global git identity — set one locally so commits work everywhere.
    execSync(
      'git init -q && git config user.email tf@test && git config user.name tf && git add -A && git commit -qm init',
      { cwd: dir, stdio: 'ignore', shell: true },
    );
  }
}

test('build writes a version-stamped manifest of every generated file', () => {
  withTmp((dir) => {
    const written = build(parseConfig(exampleYaml()), { outputDir: dir });
    const p = path.join(dir, MANIFEST_FILE);
    assert.ok(fs.existsSync(p), 'manifest exists');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(m.version, PKG_VERSION);
    // rendered output is owned; merged tool configs (opencode.json, .mcp.json) are user
    // files and must never be owned (owned = prunable).
    const OWNED_KINDS = ['skill', 'guide', 'overview', 'doc'];
    for (const f of written.filter((w) => OWNED_KINDS.includes(w.kind))) {
      assert.ok(m.files.includes(f.path), `manifest lists ${f.path}`);
    }
    for (const f of written.filter((w) => !OWNED_KINDS.includes(w.kind) && w.kind !== 'manifest')) {
      assert.ok(!m.files.includes(f.path), `merged config ${f.path} is not owned/prunable`);
    }
  });
});

test('upgrade regenerates, reports the version transition, and prunes manifest orphans', () => {
  withTmp((dir) => {
    scaffold(dir);
    build(parseConfig(exampleYaml()), { outputDir: dir });
    // simulate an older version: stale manifest version + an orphan it claims to own
    const p = path.join(dir, MANIFEST_FILE);
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    const orphan = '.claude/skills/retired-skill/SKILL.md';
    fs.mkdirSync(path.join(dir, path.dirname(orphan)), { recursive: true });
    fs.writeFileSync(path.join(dir, orphan), 'old generated skill');
    fs.writeFileSync(p, JSON.stringify({ version: '0.0.1', files: [...m.files, orphan] }));
    execSync('git add -A && git commit -qm snapshot', { cwd: dir, stdio: 'ignore', shell: true });

    const res = runUpgrade({ configPath: path.join(dir, 'ticket-flow.config.yaml'), out: dir, cwd: dir });
    assert.equal(res.fromVersion, '0.0.1');
    assert.equal(res.toVersion, PKG_VERSION);
    assert.ok(res.pruned.includes(orphan), 'orphan pruned');
    assert.ok(!fs.existsSync(path.join(dir, orphan)), 'orphan removed from disk');
    // a user file that was never in the manifest is untouchable
    assert.ok(fs.existsSync(path.join(dir, '.claude/skills/execute-ticket/SKILL.md')));
    const m2 = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(m2.version, PKG_VERSION, 'manifest re-stamped');
  });
});

test('upgrade aborts when generated files carry uncommitted changes; --force proceeds', () => {
  withTmp((dir) => {
    scaffold(dir);
    build(parseConfig(exampleYaml()), { outputDir: dir });
    execSync('git add -A && git commit -qm generated', { cwd: dir, stdio: 'ignore', shell: true });
    const edited = path.join(dir, '.claude/skills/execute-ticket/SKILL.md');
    fs.appendFileSync(edited, '\nHAND EDIT\n');

    assert.throws(
      () => runUpgrade({ configPath: path.join(dir, 'ticket-flow.config.yaml'), out: dir, cwd: dir }),
      /uncommitted|hand edit/i,
      'aborts on uncommitted generated change',
    );
    assert.match(fs.readFileSync(edited, 'utf8'), /HAND EDIT/, 'edit preserved on abort');

    const res = runUpgrade({
      configPath: path.join(dir, 'ticket-flow.config.yaml'), out: dir, cwd: dir, force: true,
    });
    assert.ok(res.toVersion, '--force proceeds');
    assert.doesNotMatch(fs.readFileSync(edited, 'utf8'), /HAND EDIT/, 'regenerated under --force');
  });
});

test('upgrade migrates the config: missing orchestrate block appended, stamp refreshed', () => {
  withTmp((dir) => {
    scaffold(dir, { yaml: '# ticket-flow.config.yaml — generated for Ticket-Flow 0.0.1.\n' + exampleYaml() });
    build(parseConfig(exampleYaml()), { outputDir: dir });
    execSync('git add -A && git commit -qm generated', { cwd: dir, stdio: 'ignore', shell: true });

    const res = runUpgrade({ configPath: path.join(dir, 'ticket-flow.config.yaml'), out: dir, cwd: dir });
    const yaml = fs.readFileSync(path.join(dir, 'ticket-flow.config.yaml'), 'utf8');
    assert.match(yaml, /# orchestrate:/, 'orchestrate block appended as commented snippet');
    assert.match(yaml, new RegExp(`generated for Ticket-Flow ${PKG_VERSION.replace(/\./g, '\\.')}`), 'stamp refreshed');
    assert.ok(res.migrated.includes('orchestrate'), 'migration reported');
    // still parseable and idempotent
    parseConfig(yaml);
    const res2 = runUpgrade({ configPath: path.join(dir, 'ticket-flow.config.yaml'), out: dir, cwd: dir });
    assert.equal(res2.migrated.length, 0, 'second run migrates nothing');
  });
});

test('doctor checkVersion warns when the manifest is from another version', () => {
  withTmp((dir) => {
    build(parseConfig(exampleYaml()), { outputDir: dir });
    assert.equal(checkVersion(dir).status, 'ok');
    const p = path.join(dir, MANIFEST_FILE);
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify({ ...m, version: '0.0.1' }));
    const r = checkVersion(dir);
    assert.equal(r.status, 'warn');
    assert.match(r.fix, /upgrade/);
  });
});
