// Composes one canonical skill body + config + backend adapter + tool renderer
// into a final, tool-specific command file.
//
// Pipeline per (skill × backend × tool):
//   1. read skills/<skill>.md.hbs, split canonical frontmatter (meta) from the body template
//   2. build a Handlebars env with helpers from the backend (op/state) and the tool (ask/codeReview/arg)
//   3. render the body AND the meta strings against the config context
//   4. hand (meta, body) to the tool renderer, which emits frontmatter + the output path
//
// The canonical bodies carry NO tool- or backend-specific text: backend tool names come from
// the adapter's op(), tool-specific arg/ask/review syntax comes from the renderer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { ARTIFACT_SENTINEL } from '../artifact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(__dirname, '..', '..');
const SKILLS_DIR = path.join(PKG_ROOT, 'skills');
const PARTIALS_DIR = path.join(SKILLS_DIR, 'partials');

export const SKILLS = [
  'next-ticket',
  'describe-ticket',
  'execute-ticket',
  'review-ticket',
  'merge-ticket',
];

function buildContext(config, backend, tool, rawMeta) {
  return {
    ...config,
    // ticket/project argument token, tool-specific (e.g. $1 vs ${input:ticket})
    arg: tool.argToken(rawMeta),
    artifact: { sentinel: ARTIFACT_SENTINEL },
    // merge config.backend (type/project/states) with the adapter's public facts
    backend: {
      ...config.backend,
      id: backend.id,
      displayName: backend.displayName,
      groupingNoun: backend.groupingNoun,
      groupingNounPlural: backend.groupingNounPlural,
      capabilities: backend.capabilities,
    },
  };
}

function makeEnv(config, backend, tool, rawMeta) {
  const hb = Handlebars.create();
  const opCtx = { config, ticket: tool.argToken(rawMeta), backend };

  // {{op "getTicket" state="inReview"}} -> backend-specific natural-language instruction
  hb.registerHelper('op', (name, options) =>
    new Handlebars.SafeString(backend.op(name, (options && options.hash) || {}, opCtx)),
  );
  // {{state "inReview"}} -> the configured display name for that lifecycle state
  hb.registerHelper('state', (name) => {
    const states = (config.backend && config.backend.states) || {};
    return states[name] || name;
  });
  hb.registerHelper('lower', (s) => String(s == null ? '' : s).toLowerCase());
  hb.registerHelper('upper', (s) => String(s == null ? '' : s).toUpperCase());
  hb.registerHelper('titlecase', (s) => {
    const str = String(s == null ? '' : s);
    return str.charAt(0).toUpperCase() + str.slice(1);
  });
  // {{ask "question"}} and {{codeReview depth=...}} -> tool-specific guidance
  hb.registerHelper('ask', (question) => new Handlebars.SafeString(tool.ask(question)));
  hb.registerHelper('codeReview', (options) =>
    new Handlebars.SafeString(tool.codeReview((options && options.hash) || {}, { config })),
  );

  // partials may themselves use the helpers above + the shared context
  for (const file of fs.readdirSync(PARTIALS_DIR)) {
    if (!file.endsWith('.hbs')) continue;
    hb.registerPartial(
      file.replace(/\.hbs$/, ''),
      fs.readFileSync(path.join(PARTIALS_DIR, file), 'utf8'),
    );
  }
  return hb;
}

export function renderSkill(skill, { config, backend, tool }) {
  const file = path.join(SKILLS_DIR, `${skill}.md.hbs`);
  const { data: rawMeta, content: bodyTpl } = matter(fs.readFileSync(file, 'utf8'));

  const hb = makeEnv(config, backend, tool, rawMeta);
  const ctx = buildContext(config, backend, tool, rawMeta);

  // render meta string fields too, so descriptions can use {{project.name}}, {{backend.groupingNoun}} …
  const meta = {};
  for (const [k, v] of Object.entries(rawMeta)) {
    meta[k] = typeof v === 'string' ? hb.compile(v, { noEscape: true })(ctx).trim() : v;
  }

  const body = hb.compile(bodyTpl, { noEscape: true })(ctx).trim() + '\n';
  return tool.wrap({ meta, body, config, backend });
}

// Render every configured skill for one (backend, tool) pair.
export function renderForTool({ config, backend, tool }) {
  return SKILLS.map((skill) => renderSkill(skill, { config, backend, tool }));
}
