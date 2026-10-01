import fs from 'node:fs';
import Ajv from 'ajv';
import { assertRecord, schemaDiagnostics } from './validate.js';
import { canonicalJSON, sha256 } from './hash.js';
import { ContractError, invalid } from './errors.js';

export const DEFAULT_PART_BYTES = 12 * 1024;
const marker = 'Ticket Flow record v1\n';
const schema = JSON.parse(fs.readFileSync(new URL('../../schema/feature/transport.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(JSON.parse(fs.readFileSync(new URL('../../schema/feature/common.schema.json', import.meta.url), 'utf8')));
ajv.addSchema(schema);
const validators = Object.fromEntries(Object.keys(schema.definitions).map(name =>
  [name, ajv.compile({ $ref: 'feature-transport-v1#/definitions/' + name })]));
function check(name, value, path) {
  canonicalJSON(value);
  const errors = schemaDiagnostics(validators[name], value, path);
  if (errors.length) throw new ContractError(errors);
}
// Physical identity excludes optional display URL and parent context.
const refKey = ref => canonicalJSON([ref.backend, ref.workspaceId, ref.objectKind, ref.objectId]);
const partId = part => sha256(canonicalJSON([part.recordId, part.revisionId, part.index, part.hash]));

export function encodePart(part) {
  const json = canonicalJSON(part);
  const runs = json.match(/\x60+/g) || [];
  const fence = String.fromCharCode(96).repeat(runs.reduce((n, run) => Math.max(n, run.length + 1), 3));
  return marker + fence + 'json\n' + json + '\n' + fence + '\n';
}
export function decodePart(text, path = '/part') {
  if (typeof text !== 'string' || !text.startsWith(marker)) invalid('MALFORMED_PART', path, 'Missing record marker');
  const match = text.slice(marker.length).match(/^(\x60{3,})json\n([^\n]*)\n\1\n$/);
  if (!match) invalid('MALFORMED_PART', path, 'Expected one complete fenced JSON part');
  let part;
  try { part = JSON.parse(match[2]); }
  catch { invalid('MALFORMED_PART', path, 'Invalid JSON in part wrapper'); }
  check('part', part, path);
  if (encodePart(part) !== text) invalid('MALFORMED_PART', path, 'Part wrapper must use the exact canonical encoding');
  return part;
}
function wrap(payload, index, count, record) {
  const part = { schemaVersion: 1, recordId: record.recordId, revisionId: record.revisionId,
    index, count, hash: sha256(payload), payload };
  part.partId = partId(part);
  const text = encodePart(part);
  return { part, text, bytes: Buffer.byteLength(text, 'utf8') };
}
function split(chars, count, record, budget) {
  const result = [];
  for (let offset = 0; offset < chars.length;) {
    // A UTF-8 code point consumes at least one byte, bounding each binary search.
    let low = 1, high = Math.min(chars.length - offset, budget), best;
    while (low <= high) {
      const size = Math.floor((low + high) / 2);
      const candidate = wrap(chars.slice(offset, offset + size).join(''), result.length, count, record);
      if (candidate.bytes <= budget) { best = { ...candidate, size }; low = size + 1; }
      else high = size - 1;
    }
    if (!best) invalid('PART_BUDGET', '/maxPartBytes', 'Budget cannot fit the complete wrapper and one Unicode code point');
    result.push(best);
    offset += best.size;
  }
  return result;
}
export function packRecord(input) {
  check('pack', input, '');
  const { record, references = [], maxPartBytes = DEFAULT_PART_BYTES, partRefs, previousDescriptor } = input;
  assertRecord(record, references);
  const text = canonicalJSON(record), chars = Array.from(text);
  if (previousDescriptor) {
    for (const field of ['recordId', 'featureId', 'recordType']) {
      if (previousDescriptor[field] !== record[field]) invalid('PREVIOUS_IDENTITY', '/previousDescriptor/' + field, 'Previous descriptor must belong to this record');
    }
    if (previousDescriptor.revisionId === record.revisionId && previousDescriptor.hash !== sha256(text)) {
      invalid('REVISION_REUSED', '/record/revisionId', 'Changed content requires a new immutable revision ID');
    }
  }
  let count = 1, chunks;
  // Count-width changes can enlarge wrappers. Repack until the count is exact.
  for (;;) {
    chunks = split(chars, count, record, maxPartBytes);
    if (chunks.length === count) break;
    count = chunks.length;
  }
  const draftDescriptor = { schemaVersion: 1, recordId: record.recordId, revisionId: record.revisionId,
    featureId: record.featureId, recordType: record.recordType, hash: sha256(text),
    parts: chunks.map(({ part }) => ({ index: part.index, partId: part.partId, hash: part.hash })) };
  let descriptor = null;
  if (partRefs !== undefined) {
    if (partRefs.length !== chunks.length) invalid('REFERENCE_COUNT', '/partRefs', 'Supply exactly one tracker reference per part in index order');
    const seen = new Set();
    for (const [i, ref] of partRefs.entries()) {
      const key = refKey(ref);
      if (seen.has(key)) invalid('REFERENCE_DUPLICATE', '/partRefs/' + i, 'Part references must identify different tracker objects');
      seen.add(key);
    }
    descriptor = { ...draftDescriptor, parts: draftDescriptor.parts.map((entry, i) => ({ ...entry, ref: structuredClone(partRefs[i]) })) };
    check('descriptor', descriptor, '/descriptor');
  }
  return { parts: chunks.map(({ part, text, bytes }) => ({ partId: part.partId, text, bytes })), draftDescriptor, descriptor };
}
export function unpackRecord(input) {
  check('unpack', input, '');
  const { descriptor, parts, references = [] } = input;
  if (parts.length !== descriptor.parts.length) invalid('PART_SET_INVALID', '/parts', 'Missing or unexpected parts');
  const expected = new Map(), ids = new Set();
  for (const [i, entry] of descriptor.parts.entries()) {
    if (entry.index !== i) invalid('DESCRIPTOR_ORDER', '/descriptor/parts/' + i + '/index', 'Descriptor entries must be in contiguous zero-based order');
    const key = refKey(entry.ref);
    if (expected.has(key) || ids.has(entry.partId)) invalid('PART_DUPLICATE', '/descriptor/parts/' + i, 'Repeated part identity or tracker reference');
    expected.set(key, entry); ids.add(entry.partId);
  }
  const seen = new Set(), chunks = new Array(parts.length);
  for (const [i, fetched] of parts.entries()) {
    const path = '/parts/' + i, key = refKey(fetched.ref), entry = expected.get(key);
    if (!entry || canonicalJSON(fetched.ref) !== canonicalJSON(entry.ref)) invalid('PART_UNEXPECTED', path + '/ref', 'Part reference is not listed exactly in descriptor');
    if (seen.has(key)) invalid('PART_DUPLICATE', path, 'Repeated fetched part');
    seen.add(key);
    const part = decodePart(fetched.text, path + '/text');
    if (part.recordId !== descriptor.recordId || part.revisionId !== descriptor.revisionId ||
        part.count !== parts.length || part.index !== entry.index || part.partId !== entry.partId) {
      invalid('PART_IDENTITY', path, 'Part identity, revision, index or count does not match descriptor');
    }
    if (sha256(part.payload) !== part.hash || part.hash !== entry.hash) invalid('PART_HASH_MISMATCH', path, 'Decoded chunk hash does not match part and descriptor');
    if (partId(part) !== part.partId) invalid('PART_IDENTITY', path, 'Part ID does not identify its immutable content');
    chunks[part.index] = part.payload;
  }
  const text = chunks.join('');
  if (sha256(text) !== descriptor.hash) invalid('RECORD_HASH_MISMATCH', '/descriptor/hash', 'Aggregate bytes do not match descriptor hash');
  let record;
  try { record = JSON.parse(text); }
  catch { invalid('MALFORMED_RECORD', '/record', 'Reassembled payload is not JSON'); }
  if (canonicalJSON(record) !== text) invalid('MALFORMED_RECORD', '/record', 'Reassembled payload is not canonical record JSON');
  assertRecord(record, references);
  for (const field of ['recordId', 'revisionId', 'featureId', 'recordType']) {
    if (record[field] !== descriptor[field]) invalid('RECORD_IDENTITY', '/record/' + field, 'Decoded record differs from descriptor identity');
  }
  return record;
}
