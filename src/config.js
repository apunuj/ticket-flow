import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv from 'ajv';
import { tools as RENDERERS } from './render/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'config.schema.json');

const DEFAULT_STATES = {
  backlog: 'Backlog',
  inProgress: 'In Progress',
  inReview: 'In Review',
  done: 'Done',
};

// Fill in defaults the JSON-schema can't safely create (nested objects that may be absent).
function normalize(config) {
  config.backend = config.backend || {};
  config.backend.states = { ...DEFAULT_STATES, ...(config.backend.states || {}) };
  config.git = config.git || {};
  config.git.branchPattern = config.git.branchPattern || '{prefix-lower}-{number}-{slug}';
  config.git.mergeStrategy = config.git.mergeStrategy || 'merge';
  config.conventions = config.conventions || [];
  config.review = config.review || {};
  config.review.conventionChecks = config.review.conventionChecks || [];
  config.orchestrate = config.orchestrate || {};
  // `tools: all` means "every tool this version of ticket-flow supports" — it stays literal in
  // the YAML so a tool added in a later release is picked up on the next build, with nothing to
  // remember. Everything downstream sees a plain array.
  if (config.tools === 'all') config.tools = Object.keys(RENDERERS);
  config.output = config.output || {};
  config.output.dir = config.output.dir || '.';
  config.output.inlineArtifacts = config.output.inlineArtifacts !== false;
  return config;
}

export function parseConfig(text) {
  const config = YAML.parse(text);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  const validate = ajv.compile(schema);
  const valid = validate(config || {});
  if (!valid) {
    const errors = (validate.errors || []).map((e) => `  ${e.instancePath || '/'} ${e.message}`);
    const err = new Error(`Invalid config:\n${errors.join('\n')}`);
    err.validation = validate.errors;
    throw err;
  }
  return normalize(config);
}

export function loadConfig(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Config not found: ${file}. Run \`ticket-flow init\` to create one.`);
  }
  return parseConfig(fs.readFileSync(file, 'utf8'));
}
