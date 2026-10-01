import { invalid } from '../feature/errors.js';

export const MAX_INPUT_BYTES = 16 * 1024 * 1024;

// Shortest legal values from feature-common-v1. Repeated locations are used only
// for a byte lower bound, never as a publishable descriptor or returned refs.
const MIN_TRACKER_REF = Object.freeze({
  backend: 'jira', workspaceId: 'x', parentId: 'x', objectKind: 'issue', objectId: 'x',
});

// The optional limit supports focused byte-boundary checks; the CLI always uses
// MAX_INPUT_BYTES. Call only after normal record and transport validation.
export function assertUnpackInputFits(packed, references, limit = MAX_INPUT_BYTES) {
  const provisional = packed.descriptor === null;
  const descriptor = packed.descriptor ?? {
    ...packed.draftDescriptor,
    parts: packed.draftDescriptor.parts.map(part => ({ ...part, ref: MIN_TRACKER_REF })),
  };
  const request = {
    schemaVersion: 1,
    descriptor,
    parts: packed.parts.map((part, i) => ({ ref: descriptor.parts[i].ref, text: part.text })),
  };
  if (references !== undefined) request.references = references;
  // JSON encoding adds another escaping layer to each fenced part, and tracker
  // references occur twice. Neither body length nor sum(part.bytes) captures it.
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
  if (bytes > limit) {
    invalid('UNPACK_INPUT_LIMIT', '/', 'Compact unpack input requires ' +
      (provisional ? 'at least ' : '') + bytes + ' UTF-8 bytes; limit is ' + limit + ' bytes');
  }
  return bytes;
}
