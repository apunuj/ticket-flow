import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { parseConfig, loadConfig } from '../src/config.js';

// A minimal config with every required field and nothing optional.
const valid = () => ({
  project: { name: 'My Project', ticketPrefix: 'PROJ' },
  backend: { type: 'linear', project: 'My Project' },
  git: { baseBranch: 'main' },
  test: { command: 'npm test' },
  tools: ['claude'],
});
const parse = (obj) => parseConfig(YAML.stringify(obj));

test('parses a minimal valid config', () => {
  const cfg = parse(valid());
  assert.equal(cfg.project.ticketPrefix, 'PROJ');
  assert.equal(cfg.backend.type, 'linear');
  assert.deepEqual(cfg.tools, ['claude']);
});

test('fills defaults the schema cannot create', () => {
  const cfg = parse(valid());
  assert.deepEqual(cfg.backend.states, {
    backlog: 'Backlog',
    inProgress: 'In Progress',
    inReview: 'In Review',
    done: 'Done',
  });
  assert.equal(cfg.git.branchPattern, '{prefix-lower}-{number}-{slug}');
  assert.equal(cfg.git.mergeStrategy, 'merge');
  assert.deepEqual(cfg.conventions, []);
  assert.deepEqual(cfg.review.conventionChecks, []);
  assert.equal(cfg.output.dir, '.');
});

// APU-787: inline artifact echo is on unless explicitly disabled.
test('output.inlineArtifacts defaults to true when omitted', () => {
  const cfg = parse(valid());
  assert.equal(cfg.output.inlineArtifacts, true);
});

test('output.inlineArtifacts: explicit false is respected', () => {
  const o = valid();
  o.output = { inlineArtifacts: false };
  const cfg = parse(o);
  assert.equal(cfg.output.inlineArtifacts, false);
});

test('output.inlineArtifacts is true when the whole output block is absent', () => {
  const o = valid();
  delete o.output;
  const cfg = parse(o);
  assert.equal(cfg.output.inlineArtifacts, true);
});

test('merges partial states over the defaults', () => {
  const o = valid();
  o.backend.states = { inReview: 'Code Review' };
  const cfg = parse(o);
  assert.equal(cfg.backend.states.inReview, 'Code Review', 'override wins');
  assert.equal(cfg.backend.states.backlog, 'Backlog', 'unspecified default kept');
});

test('allows an omitted ticketPrefix — read from ticket ids at runtime', () => {
  const o = valid();
  delete o.project.ticketPrefix;
  const cfg = parse(o);
  assert.equal(cfg.project.ticketPrefix, undefined);
  assert.equal(cfg.project.name, 'My Project');
});

test('allows an omitted backend.project — resolved at runtime', () => {
  const o = valid();
  delete o.backend.project;
  const cfg = parse(o);
  assert.equal(cfg.backend.project, undefined);
  assert.equal(cfg.backend.type, 'linear');
});

const rejects = (mutate, label) =>
  test(`rejects: ${label}`, () => {
    const o = valid();
    mutate(o);
    assert.throws(() => parse(o), /Invalid config/, label);
  });

rejects((o) => delete o.project, 'missing project');
rejects((o) => delete o.backend, 'missing backend');
rejects((o) => delete o.git, 'missing git');
rejects((o) => delete o.test, 'missing test');
rejects((o) => delete o.tools, 'missing tools');
rejects((o) => (o.project.ticketPrefix = '1PROJ'), 'ticketPrefix starting with a digit');
rejects((o) => (o.project.ticketPrefix = 'PR-OJ'), 'ticketPrefix with a hyphen');
rejects((o) => (o.backend.type = 'github'), 'backend.type not in enum');
rejects((o) => (o.git.mergeStrategy = 'fast-forward'), 'mergeStrategy not in enum');
rejects((o) => (o.tools = []), 'empty tools (minItems)');
rejects((o) => (o.tools = ['vim']), 'unknown tool id');
rejects((o) => (o.tools = ['claude', 'claude']), 'duplicate tools (uniqueItems)');
rejects((o) => (o.unexpected = true), 'unknown top-level key (additionalProperties)');
rejects((o) => (o.backend.foo = 'x'), 'unknown backend key (additionalProperties)');

test('parseConfig on empty input fails required validation', () => {
  assert.throws(() => parseConfig(''), /Invalid config/);
});

test('the validation message lists each offending path', () => {
  const o = valid();
  delete o.project;
  delete o.tools;
  try {
    parse(o);
    assert.fail('expected a throw');
  } catch (e) {
    assert.match(e.message, /project/);
    assert.match(e.message, /tools/);
    assert.ok(Array.isArray(e.validation), 'carries the raw ajv errors');
  }
});

test('loadConfig throws a helpful error when the file is missing', () => {
  assert.throws(
    () => loadConfig('/no/such/ticket-flow.config.yaml'),
    /Config not found.*ticket-flow init/s,
  );
});

test('loadConfig reads and parses a real file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cfg-'));
  try {
    const file = path.join(dir, 'ticket-flow.config.yaml');
    fs.writeFileSync(file, YAML.stringify(valid()));
    const cfg = loadConfig(file);
    assert.equal(cfg.project.name, 'My Project');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
