import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, detectDefaults, assembleConfig, configToYaml } from '../src/cli/init.js';
import { check } from '../src/cli/check.js';
import { runBuild } from '../src/cli/build.js';
import { parseConfig } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'templates', 'ticket-flow.config.yaml'), 'utf8');
const EXAMPLE = fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');

// Swallow CLI stdout/stderr so the test reporter stays readable.
function silence(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

// Run fn inside a throwaway dir as cwd, restoring cwd afterwards.
function inTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cli-'));
  const cwd0 = process.cwd();
  process.chdir(dir);
  try {
    return fn(dir);
  } finally {
    process.chdir(cwd0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('init writes the config template into the cwd', () => {
  inTmp((dir) => {
    const dest = silence(() => init());
    assert.equal(dest, path.join(dir, 'ticket-flow.config.yaml'));
    assert.equal(fs.readFileSync(dest, 'utf8'), TEMPLATE);
  });
});

test('init without --force does not overwrite an existing config', () => {
  inTmp(() => {
    fs.writeFileSync('ticket-flow.config.yaml', '# mine, do not touch\n');
    silence(() => init());
    assert.equal(fs.readFileSync('ticket-flow.config.yaml', 'utf8'), '# mine, do not touch\n');
  });
});

test('init --force overwrites with the template', () => {
  inTmp(() => {
    fs.writeFileSync('ticket-flow.config.yaml', '# stale\n');
    silence(() => init({ force: true }));
    assert.equal(fs.readFileSync('ticket-flow.config.yaml', 'utf8'), TEMPLATE);
  });
});

test('detectDefaults returns sane, schema-compatible defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-detect-'));
  try {
    const d = detectDefaults(dir);
    assert.match(d.ticketPrefix, /^[A-Z][A-Z0-9]*$/, 'prefix matches the schema pattern');
    assert.ok(d.projectName.length > 0);
    assert.ok(d.baseBranch.length > 0);
    assert.equal(typeof d.testCommand, 'string');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectDefaults picks up a Make test target (no package.json)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-detect-'));
  try {
    fs.writeFileSync(path.join(dir, 'Makefile'), 'test:\n\techo hi\n');
    assert.equal(detectDefaults(dir).testCommand, 'make test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assembleConfig + configToYaml produce a schema-valid config', () => {
  const yaml = configToYaml(
    assembleConfig({
      projectName: 'Acme',
      ticketPrefix: 'ACME',
      backendType: 'jira',
      backendProject: 'ACME',
      baseBranch: 'develop',
      testCommand: 'make test',
      tools: ['claude', 'opencode'],
    }),
  );
  const cfg = parseConfig(yaml);
  assert.equal(cfg.project.ticketPrefix, 'ACME');
  assert.equal(cfg.backend.type, 'jira');
  assert.deepEqual(cfg.tools, ['claude', 'opencode']);
  assert.equal(cfg.git.mergeStrategy, 'merge', 'normalize fills the omitted defaults');
});

test('check returns the parsed config for a valid file', () => {
  inTmp(() => {
    fs.writeFileSync('ticket-flow.config.yaml', EXAMPLE);
    const cfg = silence(() => check({ configPath: 'ticket-flow.config.yaml' }));
    assert.equal(cfg.project.name, 'XYZ App');
    assert.equal(cfg.backend.type, 'linear');
  });
});

test('check throws on a missing config file', () => {
  inTmp(() => {
    assert.throws(() => silence(() => check({ configPath: 'nope.yaml' })), /Config not found/);
  });
});

const JIRA_CONFIG =
  'project: { name: Acme, ticketPrefix: ACME }\n' +
  'backend: { type: jira, project: ACME }\n' +
  'git: { baseBranch: main }\n' +
  'test: { command: make test }\n' +
  'tools: [claude]\n';

test('check reports the no-attachment note for a backend without PR attachments', () => {
  inTmp(() => {
    fs.writeFileSync('ticket-flow.config.yaml', JIRA_CONFIG);
    const cfg = silence(() => check({ configPath: 'ticket-flow.config.yaml' }));
    assert.equal(cfg.backend.type, 'jira');
  });
});

test('check still returns when gh/git are absent from PATH', () => {
  inTmp(() => {
    fs.writeFileSync('ticket-flow.config.yaml', EXAMPLE);
    const savedPath = process.env.PATH;
    process.env.PATH = ''; // forces the has() lookups to fail -> "MISSING" branch
    try {
      const cfg = silence(() => check({ configPath: 'ticket-flow.config.yaml' }));
      assert.equal(cfg.project.name, 'XYZ App');
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

test('runBuild renders to --out and reports every written file', () => {
  inTmp((dir) => {
    fs.writeFileSync('ticket-flow.config.yaml', EXAMPLE);
    const outDir = path.join(dir, 'generated');
    const written = silence(() =>
      runBuild({ configPath: 'ticket-flow.config.yaml', out: outDir }),
    );
    // 18 skills (6×3) + 3 tool extras (claude overview, copilot + opencode guides)
    // + opencode.json wiring + 3 MCP configs + TICKET-FLOW.md
    assert.equal(written.length, 26);
    assert.ok(fs.existsSync(path.join(outDir, '.claude/skills/next-ticket/SKILL.md')));
    assert.ok(fs.existsSync(path.join(outDir, '.claude/skills/ticket-flow/SKILL.md')));
    assert.ok(fs.existsSync(path.join(outDir, '.github/instructions/ticket-flow.instructions.md')));
    assert.ok(fs.existsSync(path.join(outDir, '.mcp.json')));
    assert.ok(fs.existsSync(path.join(outDir, '.vscode/mcp.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'opencode.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'TICKET-FLOW.md')));
  });
});
