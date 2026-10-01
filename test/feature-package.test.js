import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import { parseConfig } from '../src/config.js';
import { renderDoc, renderGuide } from '../src/compose/composer.js';
import { getBackend } from '../src/backends/index.js';
import { getTool } from '../src/render/index.js';
import { revision, trackerRef } from './fixtures/feature.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
test('all generated host/backend guides pin the actual package helper version', () => {
  const source = fs.readFileSync(path.join(ROOT, 'examples/example.config.yaml'), 'utf8');
  const config = parseConfig(source);
  const command = 'npx --yes --package ticket-flow@' + pkg.version + ' ticket-flow feature';
  for (const backendId of ['linear', 'jira']) {
    const backend = getBackend(backendId);
    for (const toolId of ['claude', 'codex', 'copilot', 'cursor', 'opencode']) {
      const guide = renderGuide({ config, backend, tool: getTool(toolId) });
      assert.ok(guide.includes(command), backendId + '/' + toolId + ': exact version pin');
      assert.match(guide, /no tracker access/i);
      assert.doesNotMatch(guide, /\{\{/);
    }
    assert.ok(renderDoc({ config, backend }).includes(command));
  }
});
test('packed helpers and schemas run without npm cache in a non-Node consumer', { timeout: 60000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-feature-package-'));
  try {
    const consumer = path.join(dir, 'consumer'); fs.mkdirSync(consumer);
    const output = execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(dir, 'empty-cache'), '--pack-destination', dir],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const manifest = JSON.parse(output)[0];
    for (const file of ['src/feature/hash.js', 'src/feature/records.js', 'src/feature/validate.js',
      'src/cli/feature.js', 'src/cli/feature-limits.js', 'schema/feature/common.schema.json', 'schema/feature/record.schema.json',
      'schema/feature/transport.schema.json', 'schema/feature/helper.schema.json', 'schema/feature/README.md',
      'skills/review-plan.md.hbs', 'skills/plan-fix.md.hbs', 'skills/execute-fix.md.hbs']) {
      assert.ok(manifest.files.some(f => f.path === file), 'shipped ' + file);
    }
    assert.ok(!manifest.files.some(f => f.path === 'skills/fix-ticket.md.hbs'), 'legacy skill is not shipped');
    const tarball = path.join(dir, manifest.filename);
    // npm ci caches tarballs, not necessarily registry metadata required by offline
    // npm exec. Isolate the real packed source and the already-installed dependencies
    // instead of depending on a developer's warm registry cache or network access.
    execFileSync('tar', ['-xzf', tarball, '-C', dir]);
    const installed = path.join(dir, 'package');
    fs.cpSync(path.join(ROOT, 'node_modules'), path.join(installed, 'node_modules'), { recursive: true });
    const exec = (command, request) => JSON.parse(execFileSync(process.execPath,
      [path.join(installed, 'bin/cli.js'), 'feature', command, '--input', '-'],
      { cwd: consumer, encoding: 'utf8', input: JSON.stringify(request), maxBuffer: 8 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'] }));
    const record = revision(('Unicode 😀 café\n' + String.fromCharCode(96).repeat(9) + '\n').repeat(500));
    const prepared = exec('pack-record', { schemaVersion: 1, record });
    const partRefs = prepared.result.parts.map(p => trackerRef(p.partId));
    const packed = exec('pack-record', { schemaVersion: 1, record, partRefs }).result;
    const parts = packed.parts.map((p, i) => ({ ref: partRefs[i], text: p.text }));
    assert.deepEqual(exec('unpack-record', { schemaVersion: 1, descriptor: packed.descriptor, parts }).result.record, record);
    assert.equal(exec('validate', { schemaVersion: 1, record }).valid, true);
    assert.equal(exec('hash', { schemaVersion: 1, kind: 'body', value: record.body }).result.hash, record.bodyHash);
    assert.deepEqual(fs.readdirSync(consumer), [], 'consumer receives no package manifest, dependencies, or state');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('CLI success and validation failures conform to the shipped response schema', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/feature/helper.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: true }); ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: 'feature-helper-v1#/definitions/response' });
  for (const request of [{ schemaVersion: 1, kind: 'body', value: 'hi' }, {}]) {
    let out;
    try { out = execFileSync(process.execPath, [path.join(ROOT, 'bin/cli.js'), 'feature', 'hash', '--input', '-'],
      { input: JSON.stringify(request), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { assert.equal(e.status, 2); out = e.stdout; }
    assert.equal(validate(JSON.parse(out)), true, JSON.stringify(validate.errors));
  }
});
