import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const tag = process.env.RELEASE_TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'Release tag must be a stable vX.Y.Z version');
assert.equal(tag, 'v' + pkg.version, 'Release tag must match package.json');
assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version must match package.json');
console.log('Verified release ' + tag);
