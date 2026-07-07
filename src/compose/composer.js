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
  'fix-ticket',
  'merge-ticket',
  'orchestrate-ticket',
];

// The always-on "trigger map" template, rendered once per tool into that tool's
// auto-loaded instructions location so the workflow is invocable conversationally,
// not only via slash commands. Body-only (no skill frontmatter).
const GUIDE_TEMPLATE = 'workflow-guide.md.hbs';

function buildContext(config, backend, tool, rawMeta) {
  // Illustrative ticket prefix for examples/hints. Uses the configured prefix when present,
  // else a neutral placeholder — ticketPrefix is optional, and real ids are read at runtime.
  const egPrefix = (config.project && config.project.ticketPrefix) || 'PROJ';
  return {
    ...config,
    // ticket/project argument token, tool-specific (e.g. $1 vs ${input:ticket})
    arg: tool.argToken(rawMeta),
    artifact: { sentinel: ARTIFACT_SENTINEL },
    // example prefix for illustrative ticket ids in descriptions, hints, and sample output
    eg: { prefixUpper: egPrefix.toUpperCase(), prefixLower: egPrefix.toLowerCase() },
    // merge config.backend (type/project/states) with the adapter's public facts
    backend: {
      ...config.backend,
      id: backend.id,
      displayName: backend.displayName,
      groupingNoun: backend.groupingNoun,
      groupingNounPlural: backend.groupingNounPlural,
      capabilities: backend.capabilities,
      requires: backend.requires,
    },
  };
}

function makeEnv(config, backend, tool, rawMeta) {
  const hb = Handlebars.create();
  // argMode: all skills iterate over several tickets, so backend ops reference the
  // current ticket generically instead of the whole argument string.
  const opTicket = rawMeta && rawMeta.argMode === 'all' ? '<ticket-id>' : tool.argToken(rawMeta);
  const opCtx = { config, ticket: opTicket, backend };

  // {{op "getTicket" state="inReview"}} -> backend-specific natural-language instruction
  hb.registerHelper('op', (name, options) =>
    new Handlebars.SafeString(backend.op(name, (options && options.hash) || {}, opCtx)),
  );
  // {{state "inReview"}} -> the configured display name for that lifecycle state
  hb.registerHelper('state', (name) => {
    const states = (config.backend && config.backend.states) || {};
    return states[name] || name;
  });
  // {{#if (and a b)}} — every argument truthy (the trailing Handlebars options object is dropped)
  hb.registerHelper('and', (...args) => args.slice(0, -1).every(Boolean));
  hb.registerHelper('lower', (s) => String(s == null ? '' : s).toLowerCase());
  hb.registerHelper('upper', (s) => String(s == null ? '' : s).toUpperCase());
  // exactly one trailing period, whether or not the config string carried its own
  hb.registerHelper('sentence', (s) => String(s == null ? '' : s).replace(/\.?\s*$/, '.'));
  hb.registerHelper('titlecase', (s) => {
    const str = String(s == null ? '' : s);
    return str.charAt(0).toUpperCase() + str.slice(1);
  });
  // {{ask "question"}} and {{codeReview depth=...}} -> tool-specific guidance
  hb.registerHelper('ask', (question) => new Handlebars.SafeString(tool.ask(question)));
  hb.registerHelper('codeReview', (options) =>
    new Handlebars.SafeString(tool.codeReview((options && options.hash) || {}, { config })),
  );
  // {{skillRef "execute-ticket"}} -> tool-specific pointer (slash command + procedure file)
  // used by the workflow guide. Falls back to a bare slash command for tools that don't define it.
  hb.registerHelper('skillRef', (name) =>
    new Handlebars.SafeString(tool.skillRef ? tool.skillRef(name) : `\`/${name}\``),
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

// Render the canonical workflow guide (the conversational trigger map) for one tool.
// Returns the rendered markdown body; the tool renderer wraps it with the right
// frontmatter and output path via tool.extras().
export function renderGuide({ config, backend, tool }) {
  const file = path.join(SKILLS_DIR, GUIDE_TEMPLATE);
  const bodyTpl = fs.readFileSync(file, 'utf8');
  const hb = makeEnv(config, backend, tool, {});
  const ctx = buildContext(config, backend, tool, {});
  return hb.compile(bodyTpl, { noEscape: true })(ctx).trim() + '\n';
}

// Tool-level "extra" files beyond the per-skill commands — currently the always-on
// workflow guide. A tool opts in by implementing tool.extras({ guide, config, backend }).
export function renderExtras({ config, backend, tool }) {
  if (typeof tool.extras !== 'function') return [];
  const guide = renderGuide({ config, backend, tool });
  return tool.extras({ guide, config, backend }) || [];
}

// A neutral pseudo-tool so the tool-agnostic onboarding doc can use the shared helpers.
const DOC_TOOL = { id: 'doc', argToken: () => '<ticket>', skillRef: (name) => `\`/${name}\`` };

// Render the repo-level team onboarding reference (TICKET-FLOW.md) — backend-aware,
// tool-agnostic. One file per repo, not per tool.
export function renderDoc({ config, backend }) {
  const file = path.join(SKILLS_DIR, 'onboarding-doc.md.hbs');
  const tpl = fs.readFileSync(file, 'utf8');
  const hb = makeEnv(config, backend, DOC_TOOL, {});
  const ctx = buildContext(config, backend, DOC_TOOL, {});
  return hb.compile(tpl, { noEscape: true })(ctx).trim() + '\n';
}

// Render every configured skill (kind 'skill') plus any tool-level extras (kind 'guide')
// for one (backend, tool) pair.
export function renderForTool({ config, backend, tool }) {
  const skills = SKILLS.map((skill) => ({
    kind: 'skill',
    ...renderSkill(skill, { config, backend, tool }),
  }));
  const extras = renderExtras({ config, backend, tool }).map((f) => ({ kind: 'guide', ...f }));
  return [...skills, ...extras];
}
