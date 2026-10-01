import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalBody, canonicalJSON, hashBody, hashStructured } from '../src/feature/hash.js';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
test('body hashing changes only line endings, preserving exact UTF-8 text', () => {
  assert.equal(hashBody('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(canonicalBody('a\r\nb\rc\n'), 'a\nb\nc\n');
  const body = '  café e\u0301 😀\r\n[link](https://example.com)\t\n';
  assert.equal(hashBody(body), sha(body.replace(/\r\n?/g, '\n')));
  assert.notEqual(hashBody('é'), hashBody('e\u0301'));
  assert.notEqual(hashBody('x'), hashBody('x\n'));
  assert.throws(() => hashBody(42), /string/);
});

test('structured JSON sorts all object keys lexically, including numeric keys', () => {
  const value = { z: [{ b: 2, a: 1 }], '2': 2, '10': 10, a: true };
  const text = '{"10":10,"2":2,"a":true,"z":[{"a":1,"b":2}]}';
  assert.equal(canonicalJSON(value), text);
  assert.equal(hashStructured(value), sha(text));
  assert.equal(hashStructured({ b: 2, a: 1 }), hashStructured({ a: 1, b: 2 }));
  assert.notEqual(hashStructured([1, 2]), hashStructured([2, 1]));
  assert.equal(canonicalJSON(JSON.parse('{"__proto__":{"a":1},"constructor":2}')),
    '{"__proto__":{"a":1},"constructor":2}');
});

test('only the record own root hash is excluded; nested hashes retain meaning', () => {
  assert.equal(hashStructured({ a: 1, hash: 'old' }), hashStructured({ a: 1, hash: 'new' }));
  assert.notEqual(hashStructured({ nested: { hash: 'old' } }), hashStructured({ nested: { hash: 'new' } }));
  assert.equal(canonicalJSON({ hash: 'kept', a: 1 }), '{"a":1,"hash":"kept"}');
});

test('non-JSON values, cycles, sparse arrays and unpaired surrogates fail with paths', () => {
  const circular = {}; circular.self = circular;
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), { x: undefined },
    [1, , 3], circular, { nested: '\ud800' }, { ['\udfff']: 1 }]) {
    assert.throws(() => canonicalJSON(value), e => Array.isArray(e.diagnostics)
      && e.diagnostics.every(d => typeof d.path === 'string'));
  }
  assert.throws(() => hashBody('\ud800'), /Unicode/);
  assert.equal(canonicalJSON({ zero: -0, empty: null }), '{"empty":null,"zero":0}');
});
