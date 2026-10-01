import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('release guard accepts the matching stable version and rejects version drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-release-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(new URL('../scripts/check-release.mjs', import.meta.url), path.join(dir, 'scripts/check-release.mjs'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.8.0' }));
    const lock = { version: '0.8.0', packages: { '': { version: '0.8.0' } } };
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    const run = tag => spawnSync(process.execPath, [path.join(dir, 'scripts/check-release.mjs')], {
      env: { ...process.env, RELEASE_TAG: tag }, encoding: 'utf8',
    });
    assert.equal(run('v0.8.0').status, 0);
    for (const tag of ['v0.7.0', '0.8.0', 'v0.8.0-beta.1', '']) {
      assert.notEqual(run(tag).status, 0, 'reject tag ' + tag);
    }
    lock.packages[''].version = '0.7.0';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    assert.match(run('v0.8.0').stderr, /Lockfile root version must match/);
    lock.version = '0.7.0';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    assert.match(run('v0.8.0').stderr, /Lockfile version must match/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
