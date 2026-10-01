import { createHash } from 'node:crypto';
import { invalid, pointer } from './errors.js';

// Reject unpaired UTF-16 surrogates: UTF-8 encoding would silently replace them.
export function assertUnicode(text, path = '/') {
  if (typeof text !== 'string') invalid('INVALID_TEXT', path, 'Expected a string');
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('INVALID_UNICODE', path, 'Unpaired Unicode surrogate');
    } else if (n >= 0xdc00 && n <= 0xdfff) invalid('INVALID_UNICODE', path, 'Unpaired Unicode surrogate');
  }
}
export function canonicalBody(body) {
  assertUnicode(body);
  return body.replace(/\r\n?/g, '\n');
}
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const hashBody = (body) => sha256(canonicalBody(body));

// Build text directly: constructing a sorted JS object would reorder integer keys.
export function canonicalJSON(value) {
  const ancestors = new Set();
  function encode(v, path, depth) {
    if (depth > 256) invalid('INVALID_JSON', path || '/', 'JSON nesting exceeds 256 levels');
    if (v === null) return 'null';
    if (typeof v === 'string') {
      assertUnicode(v, path || '/');
      return JSON.stringify(v);
    }
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object') invalid('INVALID_JSON', path || '/', 'Expected finite JSON values');
    if (ancestors.has(v)) invalid('INVALID_JSON', path || '/', 'Cyclic JSON value');
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) {
      invalid('INVALID_JSON', path || '/', 'Expected a plain JSON object');
    }
    const keys = Reflect.ownKeys(v).filter(k => !(array && k === 'length'));
    if (keys.some(k => typeof k !== 'string')) invalid('INVALID_JSON', path || '/', 'Symbol keys are not JSON');
    for (const key of keys) {
      const desc = Object.getOwnPropertyDescriptor(v, key);
      if (!desc.enumerable || !('value' in desc)) invalid('INVALID_JSON', path + '/' + pointer(key), 'Expected an enumerable data property');
      assertUnicode(key, path + '/' + pointer(key));
    }
    ancestors.add(v);
    let result;
    if (array) {
      if (keys.length !== v.length || keys.some((k, i) => k !== String(i))) {
        invalid('INVALID_JSON', path || '/', 'Sparse arrays and extra array properties are not JSON');
      }
      result = '[' + v.map((item, i) => encode(item, path + '/' + i, depth + 1)).join(',') + ']';
    } else {
      result = '{' + keys.sort().map(k => JSON.stringify(k) + ':' + encode(v[k], path + '/' + pointer(k), depth + 1)).join(',') + '}';
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value, '', 0);
}
export function hashStructured(record) {
  canonicalJSON(record); // Validate even the excluded field; never invoke toJSON/getters.
  const value = record && !Array.isArray(record) && typeof record === 'object'
    ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))
    : record;
  return sha256(canonicalJSON(value));
}
