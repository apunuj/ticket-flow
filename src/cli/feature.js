import fs from 'node:fs';
import Ajv from 'ajv';
import { canonicalBody, canonicalJSON, hashBody, hashStructured } from '../feature/hash.js';
import { assertRecord, schemaDiagnostics } from '../feature/validate.js';
import { packRecord, unpackRecord } from '../feature/records.js';
import { ContractError, invalid } from '../feature/errors.js';
import { assertUnpackInputFits, MAX_INPUT_BYTES } from './feature-limits.js';
export { MAX_INPUT_BYTES } from './feature-limits.js';

const schema = JSON.parse(fs.readFileSync(new URL('../../schema/feature/helper.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(schema);
const commands = ['hash', 'pack-record', 'unpack-record', 'validate'];
const validators = Object.fromEntries(commands.map(command =>
  [command, ajv.compile({ $ref: 'feature-helper-v1#/definitions/' + command })]));
const HELP = 'Usage: ticket-flow feature <hash|pack-record|unpack-record|validate> --input -\n' +
  'Typed JSON on stdin (schemaVersion: 1); one JSON result on stdout.\n' +
  'Exit 0: valid; 2: invalid input/record; 1: unexpected execution failure.\n' +
  'No tracker access or recovery state. Action gates are not available.\n';

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) invalid('INPUT_LIMIT', '/input', 'JSON input exceeds 16 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function evaluateFeature(command, request) {
  if (!Object.hasOwn(validators, command)) invalid('UNSUPPORTED_COMMAND', '/command', 'Supported helpers: ' + commands.join(', '));
  canonicalJSON(request);
  const errors = schemaDiagnostics(validators[command], request, '');
  if (errors.length) throw new ContractError(errors.map(e => ({ ...e, path: e.path || '/' })));
  const { schemaVersion, ...input } = request;
  if (command === 'hash') {
    return request.kind === 'body'
      ? { hash: hashBody(request.value), canonicalBody: canonicalBody(request.value) }
      : { hash: hashStructured(request.value) };
  }
  if (command === 'pack-record') {
    const packed = packRecord(input);
    assertUnpackInputFits(packed, request.references);
    return packed;
  }
  if (command === 'unpack-record') return { record: unpackRecord(input) };
  assertRecord(request.record, request.references);
  return { recordType: request.record.recordType, recordId: request.record.recordId,
    revisionId: request.record.revisionId, hash: hashStructured(request.record) };
}
export async function runFeature(argv, { readInput = readStdin, writeOutput = text => process.stdout.write(text) } = {}) {
  if (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) {
    writeOutput(HELP); return 0;
  }
  const command = argv[0] || null;
  let output, code;
  try {
    if (!commands.includes(command)) invalid('UNSUPPORTED_COMMAND', '/command', 'Supported helpers: ' + commands.join(', '));
    if (argv.length !== 3 || argv[1] !== '--input' || argv[2] !== '-') {
      invalid('INVALID_ARGUMENTS', '/arguments', 'Expected feature <command> --input -; no other flags are accepted');
    }
    const bytes = await readInput();
    if (bytes.byteLength > MAX_INPUT_BYTES) invalid('INPUT_LIMIT', '/input', 'JSON input exceeds 16 MiB');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { invalid('INVALID_UTF8', '/input', 'Input must be valid UTF-8'); }
    let request;
    try { request = JSON.parse(text); }
    catch { invalid('MALFORMED_JSON', '/input', 'Input must contain exactly one JSON value'); }
    output = { schemaVersion: 1, command, valid: true, result: evaluateFeature(command, request), diagnostics: [] };
    code = 0;
  } catch (error) {
    const expected = error instanceof ContractError;
    output = { schemaVersion: 1, command, valid: false, diagnostics: expected ? error.diagnostics :
      [{ code: 'EXECUTION_FAILED', path: '/', message: error.message || 'Unexpected execution failure' }] };
    code = expected ? 2 : 1;
  }
  writeOutput(JSON.stringify(output) + '\n');
  return code;
}
