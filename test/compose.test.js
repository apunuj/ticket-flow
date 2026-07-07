import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { getBackend } from '../src/backends/index.js';
import { getTool } from '../src/render/index.js';
import {
  SKILLS,
  renderSkill,
  renderGuide,
  renderDoc,
  renderForTool,
  renderExtras,
} from '../src/compose/composer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = parseConfig(fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8'));
const env = (toolId) => ({ config, backend: getBackend(config.backend.type), tool: getTool(toolId) });

test('renderSkill returns the tool-correct path and frontmatter', () => {
  const f = renderSkill('next-ticket', env('claude'));
  assert.equal(f.path, '.claude/skills/next-ticket/SKILL.md');
  assert.match(f.content, /^---\nname: next-ticket/);
});

test('renderSkill exercises the casing + state helpers', () => {
  // next-ticket uses {{upper project.ticketPrefix}} and {{titlecase backend.groupingNoun}}
  const next = renderSkill('next-ticket', env('claude')).content;
  assert.match(next, /XYZ-/, 'upper(ticketPrefix)');
  assert.match(next, /Milestone/, 'titlecase(groupingNoun)');
  // execute-ticket uses {{state "inReview"}}
  const exec = renderSkill('execute-ticket', env('claude')).content;
  assert.match(exec, /In Review/, 'state("inReview")');
});

test('renderSkill threads the tool-specific arg token', () => {
  assert.match(renderSkill('execute-ticket', env('claude')).content, /\$1/);
  assert.match(renderSkill('execute-ticket', env('copilot')).content, /\$\{input:ticket\}/);
});

test('renderForTool tags skills plus each tool extra', () => {
  const claude = renderForTool(env('claude'));
  assert.equal(claude.filter((f) => f.kind === 'skill').length, SKILLS.length);
  const overview = claude.filter((f) => f.kind === 'overview');
  assert.equal(overview.length, 1, 'claude gets one overview skill');
  assert.equal(overview[0].path, '.claude/skills/ticket-flow/SKILL.md');

  for (const toolId of ['copilot', 'opencode']) {
    const files = renderForTool(env(toolId));
    assert.equal(files.filter((f) => f.kind === 'skill').length, SKILLS.length);
    assert.equal(files.filter((f) => f.kind === 'guide').length, 1, `${toolId} emits one guide`);
  }
});

test('renderExtras yields the claude overview skill', () => {
  const extras = renderExtras(env('claude'));
  assert.equal(extras.length, 1);
  assert.equal(extras[0].kind, 'overview');
  assert.match(extras[0].content, /name: ticket-flow/);
});

test('renderDoc produces a backend-aware team reference', () => {
  const doc = renderDoc({ config, backend: getBackend(config.backend.type) });
  assert.match(doc, /Ticket-Flow/);
  assert.match(doc, /Linear/, 'backend display name');
  assert.match(doc, /work artifact/, 'explains where state lives');
  assert.match(doc, /gh auth login/, 'lists the contributor prerequisites');
  for (const skill of SKILLS) assert.ok(doc.includes(skill), `doc mentions ${skill}`);
});

test('renderGuide maps every phase with a tool-specific pointer', () => {
  const guide = renderGuide(env('opencode'));
  for (const skill of SKILLS) assert.ok(guide.includes(skill), `guide names ${skill}`);
  assert.match(guide, /\.opencode\/command\/execute-ticket\.md/, 'points at the opencode command file');
  assert.match(guide, /Linear/, 'backend display name interpolated');
  assert.match(guide, /XYZ-/, 'ticket prefix interpolated');

  const copilotGuide = renderGuide(env('copilot'));
  assert.match(copilotGuide, /\.github\/prompts\/execute-ticket\.prompt\.md/, 'points at the copilot prompt file');
});

// APU-720: malformed arguments and missing backends are caught up front, not mid-flow.
test('ticket-arg skills carry the argument guard; next-ticket does not', () => {
  for (const skill of SKILLS) {
    const out = renderSkill(skill, env('claude')).content;
    if (skill === 'next-ticket') {
      assert.doesNotMatch(out, /Argument guard/, 'next-ticket takes a project, not a ticket id');
    } else {
      assert.match(out, /Argument guard/, `${skill} guards its ticket argument`);
      assert.match(out, /XYZ-<number>/, `${skill} names the configured id shape`);
    }
  }
});

test('every skill states backend fail-fast (preflight) on its first backend call', () => {
  for (const skill of SKILLS) {
    const out = renderSkill(skill, env('claude')).content;
    assert.match(out, /stop and tell the user/i, `${skill} fails fast on a missing/erroring backend`);
  }
});

test('artifact-read separates a missing artifact (recoverable) from a missing backend (stop)', () => {
  const out = renderSkill('execute-ticket', env('claude')).content;
  assert.match(out, /missing work artifact is recoverable; a missing backend is not/i);
});

// APU-721: backend writes are phase gates, not droppable bullets.
test('execute-ticket moves the ticket to In Progress at build start', () => {
  const out = renderSkill('execute-ticket', env('claude')).content;
  assert.match(out, /move the ticket to \*\*In Progress\*\*/, 'configured inProgress state used');
  assert.match(out, /before the first commit/i, 'transition gates the first commit');
});

test('execute-ticket ingests an external plan and creates a missing artifact before building', () => {
  const out = renderSkill('execute-ticket', env('claude')).content;
  assert.match(out, /supplied externally|external plan|plan .*(file|message|orchestrator)/i);
  assert.doesNotMatch(out, /\nResilience:/, 'trailing resilience clause promoted into the build gate');
});

test('describe-ticket gates branch checkout on the planning artifact', () => {
  const out = renderSkill('describe-ticket', env('claude')).content;
  assert.match(out, /Checkpoint[^.]*do not/i, 'checkout blocked until the artifact write is receipted');
});

test('writing skills phrase their backend writes as checkpoints', () => {
  for (const skill of ['describe-ticket', 'execute-ticket', 'review-ticket', 'fix-ticket', 'merge-ticket']) {
    const out = renderSkill(skill, env('claude')).content;
    assert.match(out, /Checkpoint/, `${skill} carries a phase-gate checkpoint`);
  }
});

// APU-722: delegating a phase to a sub-agent must not drop the backend writes.
test('phase skills carry the delegation contract', () => {
  for (const skill of ['describe-ticket', 'execute-ticket', 'review-ticket', 'fix-ticket']) {
    const out = renderSkill(skill, env('claude')).content;
    assert.match(out, /Delegation contract/, `${skill} states the contract`);
    assert.match(out, /sub-agents return data/i, `${skill}: writes stay with the orchestrator`);
  }
});

test('workflow guide covers sub-agents and multiple tickets', () => {
  const guide = renderGuide(env('claude'));
  assert.match(guide, /Sub-agents (&|and) multiple tickets/i);
  assert.match(guide, /per ticket/i, 'lifecycle applies per ticket regardless of who executes');
});

// APU-723: conventions render cleanly — single periods, own lead-in, no stray breaks.
test('conventions render with single periods under their own lead-in', () => {
  const out = renderSkill('execute-ticket', env('claude')).content;
  assert.doesNotMatch(out, /\.\.(\s|$)/, 'no doubled periods from the conventions block (git ranges like a..b are fine)');
  assert.match(out, /project conventions/i, 'conventions have their own lead-in');
  const fix = renderSkill('fix-ticket', env('claude')).content;
  assert.doesNotMatch(fix, /\.\.(\s|$)/, 'fix-ticket too');
});

// APU-724: /orchestrate-ticket — multi-ticket, multi-model orchestration as a first-class skill.
test('orchestrate-ticket renders with multi-ticket args, roles, and the delegation contract', () => {
  assert.ok(SKILLS.includes('orchestrate-ticket'), 'registered in SKILLS');
  const f = renderSkill('orchestrate-ticket', env('claude'));
  assert.equal(f.path, '.claude/skills/orchestrate-ticket/SKILL.md');
  assert.match(f.content, /\$ARGUMENTS/, 'claude takes all args, not just $1');
  assert.match(f.content, /Planner/, 'planner/reviewer role');
  assert.match(f.content, /Implementer/, 'implementer role');
  assert.match(f.content, /Delegation contract/, 'writes stay with the orchestrator');
  assert.match(f.content, /product clarifications/i, 'STOP class 1');
  assert.match(f.content, /judgment calls/i, 'STOP class 2');
  assert.match(f.content, /Blocked-by|dependency order/i, 'dependency ordering');

  const copilot = renderSkill('orchestrate-ticket', env('copilot'));
  assert.match(copilot.content, /\$\{input:tickets\}/, 'copilot named input for the ticket list');
});

// APU-787: every artifact write echoes the updated sections inline in chat, gated by
// output.inlineArtifacts (default true).
test('artifact writes instruct an inline echo of the updated sections', () => {
  for (const skill of ['execute-ticket', 'describe-ticket']) {
    const out = renderSkill(skill, env('claude')).content;
    assert.match(
      out,
      /render the updated artifact sections/i,
      `${skill} echoes the artifact inline after each write`,
    );
    assert.match(out, /never need to open the ticket/i, `${skill} states the visibility rationale`);
  }
});

test('output.inlineArtifacts: false suppresses the echo but keeps the upsert', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');
  const quiet = parseConfig(raw.replace(/^output:\n/m, 'output:\n  inlineArtifacts: false\n'));
  assert.equal(quiet.output.inlineArtifacts, false, 'fixture toggles the knob');
  const out = renderSkill('execute-ticket', {
    config: quiet, backend: getBackend(quiet.backend.type), tool: getTool('claude'),
  }).content;
  assert.doesNotMatch(out, /render the updated artifact sections/i, 'echo suppressed');
  assert.match(out, /\*\*Update the work artifact\.\*\*/, 'upsert instruction still present');
});

test('orchestrate config block is optional, validated, and rendered', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');
  const withModels = raw + '\norchestrate:\n  plannerModel: opus\n  implementerModel: sonnet\n';
  const cfg = parseConfig(withModels);
  assert.equal(cfg.orchestrate.plannerModel, 'opus');
  const out = renderSkill('orchestrate-ticket', {
    config: cfg, backend: getBackend(cfg.backend.type), tool: getTool('claude'),
  }).content;
  assert.match(out, /opus/, 'planner model override rendered');
  assert.match(out, /sonnet/, 'implementer model override rendered');
  // and absent by default
  assert.equal(parseConfig(raw).orchestrate.plannerModel, undefined);
});
