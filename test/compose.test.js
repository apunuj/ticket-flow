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
  and,
  sentence,
  renderSkill,
  renderGuide,
  renderDoc,
  renderForTool,
  renderExtras,
  DOC_TOOL,
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

// APU-795 (T11, finding 10): the onboarding doc lists tools by human display name, not the
// bare config id — "Claude Code" / "GitHub Copilot", never "**claude**".
test('renderDoc shows tool display names, not bare ids', () => {
  const doc = renderDoc({ config, backend: getBackend(config.backend.type) });
  assert.match(doc, /Claude Code/, 'claude display name');
  assert.match(doc, /GitHub Copilot/, 'copilot display name');
  assert.doesNotMatch(doc, /\*\*claude\*\*|\*\*copilot\*\*/, 'no bare tool ids rendered in bold');
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

// APU-787: artifact visibility convention — inline echo after every write, artifact mirrored
// to the PR, verdict on the PR. Backend-neutral: asserted for both linear and jira renders.
const exampleRaw = fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');
const configFor = (type) =>
  type === 'linear' ? config : parseConfig(exampleRaw.replace('type: linear', `type: ${type}`));
const envType = (type, toolId = 'claude') => ({
  config: configFor(type), backend: getBackend(type), tool: getTool(toolId),
});

for (const type of ['linear', 'jira']) {
  test(`[${type}] artifact writes instruct an inline echo of the updated sections`, () => {
    for (const skill of ['execute-ticket', 'describe-ticket']) {
      const out = renderSkill(skill, envType(type)).content;
      assert.match(
        out,
        /render the updated artifact sections/i,
        `${skill} echoes the artifact inline after each write`,
      );
      assert.match(out, /never need to open the ticket/i, `${skill} states the visibility rationale`);
      assert.match(out, /final message/i, `${skill} requires the render in the turn's final message`);
      assert.match(
        out,
        /after all backend writes and tool calls/i,
        `${skill} sequences the render after backend writes and tool calls`,
      );
      assert.match(
        out,
        /render the user cannot see does not count/i,
        `${skill} states the visibility corollary`,
      );
    }
  });

  test(`[${type}] output.inlineArtifacts: false suppresses the echo but keeps the upsert`, () => {
    const quietRaw = exampleRaw
      .replace('type: linear', `type: ${type}`)
      .replace(/inlineArtifacts: true.*/, 'inlineArtifacts: false');
    const quiet = parseConfig(quietRaw);
    assert.equal(quiet.output.inlineArtifacts, false, 'fixture toggles the knob');
    const out = renderSkill('execute-ticket', {
      config: quiet, backend: getBackend(type), tool: getTool('claude'),
    }).content;
    assert.doesNotMatch(out, /render the updated artifact sections/i, 'echo suppressed');
    assert.doesNotMatch(
      out,
      /after all backend writes and tool calls/i,
      'final-message placement rule suppressed too',
    );
    assert.match(out, /\*\*Update the work artifact\.\*\*/, 'upsert instruction still present');
  });

  test(`[${type}] describe-ticket restates the refined story list unconditionally`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    assert.match(out, /always, even when the clarifications were trivial/i);
  });

  test(`[${type}] describe-ticket sequences writes before the render — never render-then-write`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    assert.match(out, /writes first, render last/i);
  });

  test(`[${type}] execute-ticket mirrors the work artifact into the PR body and keeps it synced`, () => {
    const out = renderSkill('execute-ticket', envType(type)).content;
    assert.match(out, /## Work artifact/, 'PR body carries a Work artifact section');
    assert.match(out, /gh pr edit/, 'sync rule refreshes the section while the PR is open');
  });

  test(`[${type}] review-ticket records the verdict on the PR, not just the ticket`, () => {
    const out = renderSkill('review-ticket', envType(type)).content;
    assert.match(out, /gh pr comment/, 'verdict lands on the PR');
  });
}

// APU-791: a real run emitted the artifact render mid-turn, before the artifact-write/
// branch-checkout tool calls — agent harnesses only reliably display a turn's final text,
// so the user saw nothing. Every phase must end on the render, never a bare receipt pointing
// at earlier, possibly-hidden text. Backend-neutral: asserted for both linear and jira renders.
for (const type of ['linear', 'jira']) {
  test(`[${type}] every phase ends with the artifact render, never a bare receipt`, () => {
    for (const skill of ['describe-ticket', 'execute-ticket', 'review-ticket', 'fix-ticket', 'merge-ticket']) {
      const out = renderSkill(skill, envType(type)).content;
      assert.match(out, /bare receipt/i, `${skill} names the anti-pattern`);
      assert.match(out, /turn's final message/i, `${skill} requires ending on the final-message render`);
    }

    const quietRaw = exampleRaw
      .replace('type: linear', `type: ${type}`)
      .replace(/inlineArtifacts: true.*/, 'inlineArtifacts: false');
    const quiet = parseConfig(quietRaw);
    const blankRuns = (s) => [...s.matchAll(/\n{3,}/g)].length;
    for (const skill of ['describe-ticket', 'execute-ticket', 'review-ticket', 'fix-ticket', 'merge-ticket']) {
      const loudOut = renderSkill(skill, envType(type)).content;
      const quietOut = renderSkill(skill, {
        config: quiet, backend: getBackend(type), tool: getTool('claude'),
      }).content;
      assert.doesNotMatch(
        quietOut,
        /bare receipt/i,
        `${skill}: final-message rule suppressed with inlineArtifacts: false`,
      );
      assert.doesNotMatch(
        quietOut,
        /turn's final message/i,
        `${skill}: no final-message mandate survives in quiet mode`,
      );
      assert.ok(
        blankRuns(quietOut) <= blankRuns(loudOut),
        `${skill}: suppression leaves no extra blank-line runs (quiet ${blankRuns(quietOut)} vs loud ${blankRuns(loudOut)})`,
      );
    }
    const quietDescribe = renderSkill('describe-ticket', {
      config: quiet, backend: getBackend(type), tool: getTool('claude'),
    }).content;
    assert.doesNotMatch(
      quietDescribe,
      /writes first, render last/i,
      'sequencing corollary suppressed with inlineArtifacts: false',
    );
  });
}

// APU-788: the multi-PR batch playbook — patterns proven on a real 4-PR batch folded into
// the orchestrate skill. Backend-neutral: asserted for both linear and jira renders.
for (const type of ['linear', 'jira']) {
  test(`[${type}] orchestrate-ticket briefs bind sub-agents to the ratified plan and a structured return`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(out, /## Sub-agent briefs/, 'briefs are a first-class section');
    assert.match(out, /override/i, 'ratified decisions override the raw ticket text');
    assert.match(out, /never push, open PRs/, 'sub-agent write boundary');
    assert.match(out, /structured return/i, 'briefs require a structured return');
    assert.match(out, /can never reach the user/i, 'product forks stop and return');
  });

  test(`[${type}] orchestrate-ticket verifies independently and reads CI per check`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(out, /exact tip/i, 'test gate re-run on the exact pushed tip');
    assert.match(out, /conclusion individually/i, 'each CI check read, not the watcher exit code');
  });

  test(`[${type}] orchestrate-ticket batches deferred findings and spot-verifies fixes`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(out, /deferred-findings/, 'one deferred-findings ticket per batch');
    assert.match(out, /create/i, 'created on first use via the createTicket op');
    assert.match(out, /spot-verif/i, 'planner spot-verifies each applied fix');
  });

  test(`[${type}] orchestrate-ticket carries the stacked-PR escape hatch and dormant-vs-live merges`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(out, /rebase --onto/, 'stack then rebase onto the base branch');
    assert.match(out, /deploys inert/i, 'flag-gated dormant changes may merge on standing authority');
    assert.match(out, /live production behavior/i, 'live changes always get an explicit confirm');
  });

  test(`[${type}] workflow guide carries the verify-after-everything and deferred-findings bullets`, () => {
    const guide = renderGuide(envType(type));
    assert.match(guide, /exact pushed tip/i, 'orchestrator re-runs the gate on the pushed tip');
    assert.match(guide, /conclusion individually/i, 'per-check CI reading');
    assert.match(guide, /deferred-findings/, 'residuals accumulate in one batch ticket');
  });
}

// PR #13 review N3: the 'and' subexpression helper, directly. Handlebars appends its
// options object as the last argument; the helper drops it before checking truthiness.
test('and helper: every argument truthy, options object dropped', () => {
  const opts = {}; // stands in for the Handlebars options object
  assert.equal(and('opus', 'sonnet', opts), true, 'two truthy strings');
  assert.equal(and('opus', '', opts), false, 'empty string is falsy');
  assert.equal(and('', '', opts), false, 'both empty');
  assert.equal(and(undefined, 'sonnet', opts), false, 'missing key (undefined)');
  assert.equal(and('opus', undefined, opts), false, 'missing key on the other side');
  assert.equal(and(null, 'sonnet', opts), false, 'null is falsy');
  assert.equal(and(0, 'sonnet', opts), false, 'zero is falsy');
  assert.equal(and('opus', opts), true, 'single truthy argument');
  assert.equal(and(false, opts), false, 'single falsy argument');
});

// APU-795 fix-loop N2: the sentence helper normalizes terminal punctuation — unpunctuated
// gains a single ".", a trailing "." collapses to one, and "?"/"!" are preserved (never "?.").
test('sentence helper: normalizes terminal punctuation', () => {
  assert.equal(sentence('Migrations are reversible'), 'Migrations are reversible.', 'unpunctuated → .');
  assert.equal(sentence('Migrations are reversible.'), 'Migrations are reversible.', 'trailing . → single .');
  assert.equal(sentence('Migrations are reversible..'), 'Migrations are reversible.', 'collapses a run of periods');
  assert.equal(sentence('Is it reversible?'), 'Is it reversible?', 'trailing ? preserved, no added period');
  assert.equal(sentence('Ship it!'), 'Ship it!', 'trailing ! preserved, no added period');
  assert.equal(sentence('Trailing space   '), 'Trailing space.', 'trims trailing whitespace then adds .');
  assert.equal(sentence(''), '.', 'empty input → .');
  assert.equal(sentence(null), '.', 'null input → .');
});

// APU-792: the Planner/Implementer model split is a cost/quality decision the operator
// owns — resolve it interactively, never silently. Resolution order: explicit per-run
// instruction > config (both models) > ask. Backend-neutral: asserted for linear and jira.
const orchestrateEnv = (type, orchestrateBlock = '', toolId = 'claude') => {
  const raw = exampleRaw.replace('type: linear', `type: ${type}`) + orchestrateBlock;
  return { config: parseConfig(raw), backend: getBackend(type), tool: getTool(toolId) };
};
const FULL_SPLIT = '\norchestrate:\n  plannerModel: opus\n  implementerModel: sonnet\n';

for (const type of ['linear', 'jira']) {
  test(`[${type}] configured split (both models) renders pinned models and does not ask`, () => {
    const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, FULL_SPLIT)).content;
    assert.match(out, /Planner[^\n]*`opus`/, 'planner model named in the configured prose');
    assert.match(out, /Implementer[^\n]*`sonnet`/, 'implementer model named in the configured prose');
    assert.match(out, /without asking/i, 'configured path proceeds without the question');
    assert.doesNotMatch(out, /All-strongest/, 'no preset question in the configured render');
    assert.doesNotMatch(out, /do not proceed until/i, 'no ask gate in the configured render');
  });

  test(`[${type}] partial config (one model) still asks the full preset question`, () => {
    for (const partial of [
      '\norchestrate:\n  plannerModel: opus\n',
      '\norchestrate:\n  implementerModel: sonnet\n',
    ]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, partial)).content;
      assert.match(out, /\*\*All-strongest\*\*/, 'full preset question renders');
      assert.match(out, /do not proceed until the user has answered/i, 'ask gate present');
      assert.doesNotMatch(out, /Configured split/, 'configured prose absent on partial config');
    }
  });

  // PR #13 review B2: the interaction contract's "exactly two classes" claim is only true
  // mid-run — the model-split ask (unconfigured runs) and the persist offer are neither class.
  test(`[${type}] interaction contract scopes the two-question claim to mid-run`, () => {
    for (const block of ['', FULL_SPLIT]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block)).content;
      assert.match(
        out,
        /Exactly two classes of questions reach the user \*\*mid-run\*\*/,
        'two-question claim scoped to mid-run',
      );
    }
  });

  // PR #13 review N1: empty strings are not models — "" for either key must fall to ask.
  test(`[${type}] empty-string models render the ask path, not the configured path`, () => {
    for (const block of [
      '\norchestrate:\n  plannerModel: ""\n  implementerModel: ""\n',
      '\norchestrate:\n  plannerModel: ""\n  implementerModel: sonnet\n',
      '\norchestrate:\n  plannerModel: opus\n  implementerModel: ""\n',
    ]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block)).content;
      assert.match(out, /do not proceed until the user has answered/i, 'ask gate present');
      assert.doesNotMatch(out, /Configured split/, 'configured prose absent on empty models');
    }
  });

  test(`[${type}] no configured split → preset question with all four options, gated`, () => {
    const out = renderSkill('orchestrate-ticket', orchestrateEnv(type)).content;
    assert.match(out, /\*\*Split\*\*[^\n]*recommended/i, 'Split preset, marked recommended');
    assert.match(out, /\*\*All-strongest\*\*/, 'All-strongest preset');
    assert.match(out, /\*\*Budget\*\*/, 'Budget preset');
    assert.match(out, /\*\*Custom\*\*/, 'Custom preset');
    assert.match(out, /per-phase overrides/i, 'Custom allows per-phase overrides');
    assert.match(out, /do not proceed until the user has answered/i, 'hard ask gate');
    assert.match(
      out,
      /explicit per-run instruction > config > ask/i,
      'resolution order stated',
    );
  });

  // T4 (US-3): persisting the choice is an offer at run end, never a mid-run or silent write.
  test(`[${type}] persist offer is tied to run completion in every resolution path`, () => {
    for (const block of ['', FULL_SPLIT]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block)).content;
      assert.match(out, /after the run completes/i, 'persist gated on run completion');
      assert.match(out, /final boundary summary/i, 'anchored to the final boundary summary');
      assert.match(out, /back on the base branch/i, 'anchored to being back on the base branch');
      assert.match(out, /never edit the config mid-run/i, 'no mid-run config edits');
      assert.match(out, /never write .*silently/i, 'no silent write-back');
    }
  });

  // T7 (US-6): an explicit per-run instruction beats config, skips the question, lasts one
  // run, is never persisted, and is flagged in the kickoff summary — in every render.
  test(`[${type}] per-run override rule present in configured and unconfigured renders`, () => {
    for (const block of ['', FULL_SPLIT]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block)).content;
      assert.match(out, /configured values included/i, 'override beats configured values');
      assert.match(out, /this run only/i, 'override lasts one run');
      assert.match(out, /skips any model-split question/i, 'override skips the question');
      assert.match(out, /never written back to config/i, 'override is never persisted');
      assert.match(
        out,
        /kickoff summary must flag it as a one-run override/i,
        'kickoff summary flags the override',
      );
    }
  });

  // T6 (US-5): the preset question rides each tool's ask machinery ({{ask}}: AskUserQuestion
  // on claude, plain present-and-wait elsewhere); pinning the model on the sub-agent spawn is
  // stated tool-neutrally, since skill bodies carry no per-tool conditionals.
  test(`[${type}] preset question uses the tool's ask machinery; pinning degrades gracefully`, () => {
    const claude = renderSkill('orchestrate-ticket', orchestrateEnv(type)).content;
    assert.match(claude, /AskUserQuestion/, 'claude asks via AskUserQuestion');
    for (const toolId of ['copilot', 'opencode']) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, '', toolId)).content;
      assert.match(out, /present the options and wait/i, `${toolId} asks and waits in plain prose`);
      assert.doesNotMatch(out, /AskUserQuestion/, `${toolId} never names claude machinery`);
    }
    for (const toolId of ['claude', 'copilot', 'opencode']) {
      for (const block of ['', FULL_SPLIT]) {
        const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block, toolId)).content;
        assert.match(
          out,
          /pin the resolved model on each sub-agent spawn where your tool supports it/i,
          `${toolId}: model pinned on the spawn where supported`,
        );
        assert.match(
          out,
          /otherwise record the chosen split/i,
          `${toolId}: graceful degradation still records intent`,
        );
      }
    }
  });

  // T5 (US-4): both summaries name the model that ran each phase, in every resolution path.
  test(`[${type}] kickoff and boundary summaries name the model per phase`, () => {
    for (const block of ['', FULL_SPLIT]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block)).content;
      assert.match(out, /kickoff summary/i, 'run opens with a kickoff summary');
      assert.match(
        out,
        /kickoff summary and every boundary summary must name which model ran each phase/i,
        'both summaries carry the per-phase model',
      );
      assert.match(
        out,
        /Boundary summary[^\n]*model that ran each phase/i,
        'the per-ticket boundary-summary step itself names the model',
      );
    }
  });
}

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

// APU-793: self-contained asks + guaranteed visibility for every gate question.
// The `ask` helper's optional context= appends a tool-neutral clause MANDATING that the
// context be displayed in the message body immediately before the question — context never
// rides inside the (mobile-truncating, mid-turn-swallowable) question string. The clause is
// additive on all three tools; the per-tool ask machinery is unchanged. Backend-neutral.
for (const type of ['linear', 'jira']) {
  test(`[${type}] {{ask}} context= renders the display mandate on every tool`, () => {
    for (const toolId of ['claude', 'copilot', 'opencode']) {
      const out = renderSkill('fix-ticket', envType(type, toolId)).content;
      assert.match(
        out,
        /in the message body immediately before this question/i,
        `${toolId}: ask context renders the display mandate`,
      );
      assert.match(out, /asking without displaying it is non-compliant/i, `${toolId}: the mandate has teeth`);
      assert.match(out, /keep the question text itself short/i, `${toolId}: short-question corollary`);
      if (toolId === 'claude') {
        assert.match(out, /AskUserQuestion/, 'claude asks via AskUserQuestion');
      } else {
        assert.match(out, /present the options and wait/i, `${toolId}: present-and-wait prose`);
        assert.doesNotMatch(out, /AskUserQuestion/, `${toolId}: never names claude machinery`);
      }
    }
  });

  test(`[${type}] merge asks are self-contained`, () => {
    const out = renderSkill('merge-ticket', envType(type)).content;
    assert.match(out, /in the message body immediately before this question/i, 'display mandate present');
    assert.match(
      out,
      /the unaddressed blocking findings from the review verdict/i,
      'needs-changes ask lists the findings',
    );
    assert.match(out, /each failing or pending check by name/i, 'CI ask names each check');
    assert.match(
      out,
      /the unresolved review threads and any CHANGES_REQUESTED decision/i,
      'threads ask lists the threads',
    );
    assert.match(out, /the per-branch candidate list/i, 'branch-deletion ask carries the candidate set');
    assert.match(
      out,
      /even on the pre-authorized path, display that exact per-branch set/i,
      'pre-authorized deletes still display the set',
    );
  });

  test(`[${type}] execute commit confirm is self-contained`, () => {
    const out = renderSkill('execute-ticket', envType(type)).content;
    assert.match(out, /in the message body immediately before this question/i, 'display mandate present');
    assert.match(
      out,
      /the full proposed commit message — its title and body/i,
      'commit confirm carries the full message',
    );
  });

  test(`[${type}] describe step 3 displays with teeth`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    assert.match(
      out,
      /omitting or burying them mid-turn is non-compliant/i,
      'step 3 mandates displaying all three parts',
    );
    assert.match(
      out,
      /the step-3 output — the summary/i,
      'step-4 clarifying ask carries the step-3 output as context',
    );
  });

  test(`[${type}] describe always stops for plan ratification`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    assert.match(out, /there is no trivial-clarifications escape/i, 'the ratification STOP has no escape');
    assert.match(out, /ratif/i, 'a ratification gate exists');
    assert.doesNotMatch(
      out,
      /STOP again for confirmation unless the clarifications were trivial/i,
      "5a's trivial-clarifications escape is removed",
    );
    // the pinned restatement phrase (APU-787) survives untouched
    assert.match(out, /always, even when the clarifications were trivial/i, 'restatement phrase intact');
  });

  test(`[${type}] describe quiet mode keeps the stories+plan floor`, () => {
    const quietRaw = exampleRaw
      .replace('type: linear', `type: ${type}`)
      .replace(/inlineArtifacts: true.*/, 'inlineArtifacts: false');
    const quiet = parseConfig(quietRaw);
    const out = renderSkill('describe-ticket', {
      config: quiet, backend: getBackend(type), tool: getTool('claude'),
    }).content;
    // the unconditional floor survives quiet mode
    assert.match(out, /the confirmed user stories and the plan's task summary/i, 'floor names stories + plan');
    assert.match(out, /the ticket URL alone is never the whole answer/i, 'floor rejects a bare URL');
    // the conditional/inline floors are suppressed, so their banned phrases are absent
    assert.doesNotMatch(out, /turn's final message/i);
    assert.doesNotMatch(out, /bare receipt/i);
    assert.doesNotMatch(out, /render the updated artifact sections/i);
    assert.doesNotMatch(out, /after all backend writes and tool calls/i);
    assert.doesNotMatch(out, /writes first, render last/i);
  });

  test(`[${type}] review verdict floor holds loud and quiet`, () => {
    for (const inlineOn of [true, false]) {
      const raw = inlineOn
        ? exampleRaw.replace('type: linear', `type: ${type}`)
        : exampleRaw
            .replace('type: linear', `type: ${type}`)
            .replace(/inlineArtifacts: true.*/, 'inlineArtifacts: false');
      const out = renderSkill('review-ticket', {
        config: parseConfig(raw), backend: getBackend(type), tool: getTool('claude'),
      }).content;
      assert.match(
        out,
        /the verdict line and every blocking finding \/ uncovered acceptance criterion/i,
        `inline=${inlineOn}: verdict floor states verdict + findings`,
      );
      assert.match(
        out,
        /never a pointer back at earlier output/i,
        `inline=${inlineOn}: floor rejects a pointer`,
      );
      if (!inlineOn) {
        assert.doesNotMatch(out, /turn's final message/i, 'quiet: no suppressed banned phrase');
        assert.doesNotMatch(out, /bare receipt/i, 'quiet: no suppressed banned phrase');
      }
    }
  });

  test(`[${type}] orchestrate bubbles are self-contained and the plan is ratified before the artifact write`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    // class 1 now folds in plan ratification and mandates relaying the Planner's output
    assert.match(out, /Product clarifications and plan ratification/i, 'class 1 folds in ratification');
    assert.match(
      out,
      /sub-agent output is invisible to the user unless you relay it/i,
      'the bubble must relay the Planner output',
    );
    // the lifecycle bubble carries the Planner's summary/stories/ACs as ask context
    assert.match(
      out,
      /the Planner's summary, user stories, and acceptance criteria, plus the clarifying questions/i,
      'bubble ask carries the Planner output as context',
    );
    // a ratification STOP exists and precedes the lifecycle artifact write
    assert.match(
      out,
      /display the refined user stories and the execution plan and STOP for the user to ratify/i,
      'lifecycle stops for ratification',
    );
    const ratifyIdx = out.indexOf('Only after ratification');
    assert.ok(ratifyIdx !== -1, 'explicit post-ratification gate present');
    const writeIdx = out.indexOf('**Update the work artifact.**', ratifyIdx);
    assert.ok(writeIdx > ratifyIdx, 'ratification precedes the lifecycle artifact write');
    // pinned invariants stay green
    assert.match(
      out,
      /Exactly two classes of questions reach the user \*\*mid-run\*\*/,
      'two-classes claim intact',
    );
    assert.match(out, /do not proceed until the user has answered/i, 'model-split ask gate intact');
  });

  test(`[${type}] arg-guard repeats the recovered id and asks when ambiguous`, () => {
    // the shared partial (rendered via describe): repeat the recovered id, ask when ambiguous
    const describe = renderSkill('describe-ticket', envType(type)).content;
    assert.match(describe, /repeat that id in the final message/i, 'unambiguous recovery repeats the id');
    assert.match(describe, /the candidate ticket ids you found/i, 'ambiguous recovery asks with candidates');
    assert.match(
      describe,
      /in the message body immediately before this question/i,
      'the ambiguous ask displays its candidates',
    );
    // orchestrate's inline multi-ticket guard mirrors the recovered-id parity
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(orch, /repeat them in the final message/i, 'inline guard repeats the recovered ids');
    assert.match(orch, /the candidate ids displayed/i, 'inline guard displays candidates when ambiguous');
  });

  test(`[${type}] changed skills leak no claude machinery to copilot/opencode`, () => {
    const changed = [
      'fix-ticket', 'merge-ticket', 'execute-ticket', 'describe-ticket', 'review-ticket', 'orchestrate-ticket',
    ];
    for (const toolId of ['copilot', 'opencode']) {
      for (const skill of changed) {
        const out = renderSkill(skill, envType(type, toolId)).content;
        assert.doesNotMatch(out, /AskUserQuestion/, `${skill}/${toolId}: no claude-only ask machinery`);
        assert.match(out, /present the options and wait/i, `${skill}/${toolId}: present-and-wait prose`);
      }
    }
  });

  // Fix loop N1: on claude the ask output ends with the bare question, so a ?-terminated
  // question followed by the display-mandate clause produced "…did you mean?. Display".
  // The helper swallows its leading period after terminal punctuation — on every tool.
  test(`[${type}] display-mandate clause never doubles terminal punctuation`, () => {
    for (const toolId of ['claude', 'copilot', 'opencode']) {
      for (const skill of SKILLS) {
        const out = renderSkill(skill, envType(type, toolId)).content;
        assert.doesNotMatch(out, /[?!.]\. Display /, `${skill}/${toolId}: clean junction before the clause`);
      }
    }
  });

  // Fix loop N2: the ratification STOP is explicitly unconditional on the zero-questions
  // path too — "after answers" alone read vacuous when there was nothing to ask.
  test(`[${type}] ratification STOP is explicit on the zero-questions path`, () => {
    for (const skill of ['describe-ticket', 'orchestrate-ticket']) {
      const out = renderSkill(skill, envType(type)).content;
      assert.match(
        out,
        /even when there were no clarifying questions/i,
        `${skill}: ratification holds with zero questions`,
      );
    }
  });

  // Fix loop N3: pin describe's ordering positionally, mirroring the orchestrate pin —
  // ratify STOP strictly before the artifact write, strictly before the branch checkout.
  test(`[${type}] describe orders ratify STOP before artifact write before branch checkout`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    const ratifyIdx = out.indexOf('Ratify — STOP');
    const writeIdx = out.indexOf('**Update the work artifact.**');
    const checkoutIdx = out.indexOf('Check out the ticket branch');
    assert.ok(ratifyIdx !== -1, 'ratify STOP present');
    assert.ok(writeIdx > ratifyIdx, 'artifact write after the ratify STOP');
    assert.ok(checkoutIdx > writeIdx, 'branch checkout after the artifact write');
  });
}

// APU-795: backend/tool parity leaks. Every backend-specific fact that a shared template
// renders must resolve to the backend's own vocabulary — no Linear terms leak into a Jira
// render (or vice versa). Both backends looped.
for (const type of ['linear', 'jira']) {
  // T1 (finding 1): the priority scale is a backend fact, not a hardcoded Linear scale.
  test(`[${type}] next-ticket renders the backend's own priority scale`, () => {
    const out = renderSkill('next-ticket', envType(type)).content;
    if (type === 'jira') {
      assert.match(out, /Highest > High > Medium > Low > Lowest/, 'jira priority scale');
      assert.doesNotMatch(out, /Urgent > High/, 'no Linear scale leaks into jira');
    } else {
      assert.match(out, /Urgent > High > Medium > Low > None/, 'linear priority scale');
      assert.doesNotMatch(out, /Highest > High/, 'no Jira scale leaks into linear');
    }
  });

  // T2 (finding 4): sprint/group vocabulary — the group's date noun and its closed-status
  // phrasing follow the backend, not Linear's milestone terms.
  test(`[${type}] next-ticket uses the backend's group date noun and closed-status phrasing`, () => {
    const out = renderSkill('next-ticket', envType(type)).content;
    if (type === 'jira') {
      assert.match(out, /end date/, 'jira sprints carry an end date');
      assert.doesNotMatch(out, /target date|target-date/, 'no Linear target-date term in jira');
      assert.doesNotMatch(out, /completed\/cancelled/, 'no Linear closed phrasing in jira');
      assert.match(out, /status is closed/, 'jira closed-sprint phrasing');
      // N1: the group date noun is a variable — the sort tiebreak must not render "a end date".
      assert.doesNotMatch(out, /\ba end\b/i, 'no "a end" article regression on jira');
    } else {
      assert.match(out, /target date/, 'linear milestones carry a target date');
      assert.doesNotMatch(out, /end date/, 'no Jira end-date term in linear');
      assert.match(out, /status is completed or cancelled/, 'linear closed phrasing');
    }
    // N1: article-free tiebreak scans on both backends.
    assert.match(out, /ascending; those lacking one sort last/, 'tiebreak reworded to avoid the article');
    assert.doesNotMatch(out, /without a (target|end) date/i, 'no articled date-noun phrasing survives');
  });

  // T3 (finding 5): retrospective PR discovery goes through the getAttachedPR op, so Jira
  // points at the development panel / remote links rather than Linear-style attachments.
  test(`[${type}] describe retrospective discovers the PR via the getAttachedPR op`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    assert.doesNotMatch(
      out,
      /attachments, and comments for linked PR/,
      'the old hardcoded attachment-scan bullet is gone',
    );
    if (type === 'jira') {
      assert.match(out, /development panel|remote link/i, 'jira discovers via dev panel / remote links');
      assert.doesNotMatch(out, /attachments\/links/, 'no Linear attachment phrasing leaks into jira');
    } else {
      assert.match(out, /attachments\/links/, 'linear legitimately reads attachments/links (capability true)');
    }
  });

  // T5 (finding 8): a half-configured split (exactly one model set) reads as "No complete
  // configured split (both roles must be set)" — the old bare "No configured split" implied
  // nothing was set even when one role was pinned.
  test(`[${type}] half-config orchestrate names the incomplete split explicitly`, () => {
    for (const partial of [
      '\norchestrate:\n  plannerModel: opus\n',
      '\norchestrate:\n  implementerModel: sonnet\n',
    ]) {
      const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, partial)).content;
      assert.match(
        out,
        /No complete configured split \(both roles must be set\)/i,
        'partial config names the incomplete split',
      );
    }
    // the both-set path still renders the "**Configured split.**" prose (capital C)
    const both = renderSkill('orchestrate-ticket', orchestrateEnv(type, FULL_SPLIT)).content;
    assert.match(both, /\*\*Configured split\.\*\*/, 'both-set path keeps the configured-split prose');
  });

  // T10 (finding 9): the artifact-write partial's trailing newline split the orchestrate
  // lifecycle's "— and check out the ticket branch per …" onto its own dangling line. The
  // clause must stay on the artifact-write line.
  test(`[${type}] orchestrate keeps the branch-checkout clause on the artifact-write line`, () => {
    const out = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.doesNotMatch(
      out,
      /^\s*— and check out the ticket branch per/m,
      'no dangling continuation line',
    );
    const line = out.split('\n').find((l) => /and check out the ticket branch per/.test(l));
    assert.ok(line, 'the branch-checkout clause renders');
    assert.match(line, /\*\*Update the work artifact\.\*\*/, 'shares the line with the artifact-write text');
    // APU-791/793 pins unaffected by the newline change
    assert.match(out, /\*\*Update the work artifact\.\*\*/, 'artifact-write phrase pin intact');
  });

  // T9 (finding 6): a review conventionCheck that already ends in a period renders with one
  // period, not two — the sentence helper normalizes terminal punctuation.
  test(`[${type}] review conventionChecks render one period even when the item is punctuated`, () => {
    const raw = exampleRaw
      .replace('type: linear', `type: ${type}`)
      .replace('"Database migrations are backwards-compatible"', '"Migrations are reversible."');
    const cfg = parseConfig(raw);
    const out = renderSkill('review-ticket', {
      config: cfg, backend: getBackend(type), tool: getTool('claude'),
    }).content;
    assert.match(out, /Migrations are reversible\./, 'the punctuated check renders');
    assert.doesNotMatch(out, /reversible\.\./, 'no doubled period');
  });

  // T7 (finding 3): spawning degrades tool-neutrally — a tool with no sub-agent primitive
  // runs each role in the main loop, role-switching between phases. Present in every render.
  test(`[${type}] orchestrate carries a tool-neutral no-subagent degrade in every render`, () => {
    for (const toolId of ['claude', 'copilot', 'opencode']) {
      for (const block of ['', FULL_SPLIT]) {
        const out = renderSkill('orchestrate-ticket', orchestrateEnv(type, block, toolId)).content;
        assert.match(
          out,
          /no sub-agent primitive.*run (each|the) (role|phase).*yourself|role-switch/i,
          `${toolId}: tool-neutral no-subagent degrade present`,
        );
        // the pin-on-spawn degrade (a distinct line) still stands
        assert.match(
          out,
          /pin the resolved model on each sub-agent spawn where your tool supports it/i,
          `${toolId}: pin-on-spawn line intact`,
        );
        assert.match(out, /otherwise record the chosen split/i, `${toolId}: pin-on-spawn fallback intact`);
      }
    }
  });
}

// APU-795 (T13, AC-7): parity sweep — no backend's vocabulary leaks into the other's
// renders, across every skill and every tool. Guards against a future template hardcoding a
// backend-specific term where a fact belongs.
for (const type of ['linear', 'jira']) {
  test(`[${type}] parity sweep: no cross-backend vocabulary leaks in any skill/tool render`, () => {
    for (const skill of SKILLS) {
      for (const toolId of ['claude', 'copilot', 'opencode']) {
        const out = renderSkill(skill, envType(type, toolId)).content;
        if (type === 'jira') {
          assert.doesNotMatch(out, /Urgent > High/, `${skill}/${toolId}: no Linear priority scale`);
          assert.doesNotMatch(out, /target date|target-date/, `${skill}/${toolId}: no Linear target-date term`);
          assert.doesNotMatch(out, /attachments/, `${skill}/${toolId}: no attachment-based PR scan`);
        } else {
          assert.doesNotMatch(out, /Highest > High/, `${skill}/${toolId}: no Jira priority scale`);
          assert.doesNotMatch(out, /end date/, `${skill}/${toolId}: no Jira end-date term`);
        }
      }
    }
  });
}

// Fix loop N4: arg-guard now calls {{ask}}, and DOC_TOOL renders with the same partials —
// a future doc template including arg-guard must not throw on a missing ask.
test('DOC_TOOL carries an ask stub so doc templates survive {{ask}}', () => {
  assert.equal(typeof DOC_TOOL.ask, 'function', 'DOC_TOOL implements ask');
  assert.match(DOC_TOOL.ask('which one?'), /present the options and wait/i, 'present-and-wait prose');
});

// APU-794: resolve contradictions & unsatisfiable rules across the phase skills. Each block
// pins a rule that previously contradicted another rule or could not be satisfied on a real
// execution path. Both backends looped.
for (const type of ['linear', 'jira']) {
  // T1 (finding 1): a well-specified describe (no clarifying questions) must not deadlock on
  // "wait for the user's answers" — the wait is conditional on having asked, and the
  // well-specified branch routes straight to the plan.
  test(`[${type}] describe well-specified path routes to the plan, not a bare wait`, () => {
    const out = renderSkill('describe-ticket', envType(type)).content;
    // the well-specified branch names the plan (5b), not a bare "skip to step 5"
    assert.match(out, /skip to step 5b/i, 'well-specified branch names the plan (5b)');
    // the STOP-and-wait opener is conditional on having asked clarifying questions
    assert.match(
      out,
      /if you asked clarifying questions, STOP and wait for their answers/i,
      'the wait is conditional on having asked questions',
    );
    assert.match(
      out,
      /if everything was well-specified, proceed directly to the plan/i,
      'the well-specified branch proceeds directly to the plan',
    );
    // no unconditional bare "STOP. Wait for the user's answers." opener survives
    assert.doesNotMatch(
      out,
      /\*\*STOP\.\*\* Wait for the user's answers\./,
      'the unconditional bare-wait opener is gone',
    );
    // the ratify STOP (APU-793) still holds unconditionally
    assert.match(out, /there is no trivial-clarifications escape/i, 'ratify gate intact');
  });

  // T2 (finding 7): the final-message render mandate is scoped to turns that actually
  // updated the work artifact — a retrospective describe (which writes no artifact) must
  // not be commanded to render one.
  test(`[${type}] final-message render mandate is scoped to artifact-updating turns`, () => {
    for (const skill of ['execute-ticket', 'review-ticket', 'merge-ticket', 'describe-ticket']) {
      const out = renderSkill(skill, envType(type)).content;
      assert.match(
        out,
        /In any turn that updated the work artifact, the artifact render must land/i,
        `${skill}: render mandate scoped to artifact-updating turns`,
      );
      // APU-791 pins preserved
      assert.match(out, /turn's final message/i, `${skill}: turn's final message pin intact`);
      assert.match(out, /after all backend writes and tool calls/i, `${skill}: sequencing pin intact`);
      assert.match(out, /bare receipt/i, `${skill}: bare-receipt pin intact`);
    }
  });

  // T2b (finding 2): merge's render lands after step 5's writes but cleanup (steps 6–7) may
  // continue in the same turn under pre-authorization. A merge-local scope sentence resolves
  // the "end on the render" rule against that continuation — re-render at the turn's true end.
  test(`[${type}] merge scopes the render to the close-out write-turn and re-renders after same-turn cleanup`, () => {
    const out = renderSkill('merge-ticket', envType(type)).content;
    assert.match(
      out,
      /ends the write-turn that closed the ticket/i,
      'merge-local scope names the close-out write-turn',
    );
    assert.match(
      out,
      /re-render .*at that turn's true end/i,
      'same-turn cleanup re-renders at the turn true end',
    );
    // the shared final-message pins still hold on merge
    assert.match(out, /turn's final message/i, 'turn-final-message pin intact');
    assert.match(out, /bare receipt/i, 'bare-receipt pin intact');
  });

  // T3a (finding 3, R1): orchestrate resolves review depth itself (default high, per-run
  // override); review-ticket's "always ask" carries the carve-out for a resolved depth.
  test(`[${type}] orchestrate resolves review depth itself; review-ticket carves it out (R1)`, () => {
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    // R1 verbatim in orchestrate's rendered prose
    assert.match(
      orch,
      /orchestrate resolves review depth itself — default high; a per-run instruction in the invocation can override/i,
      'R1 encoded verbatim in orchestrate',
    );
    const review = renderSkill('review-ticket', envType(type)).content;
    // the always-ask still stands, but with a carve-out for an orchestrator-resolved depth
    assert.match(review, /Ask for review depth — always/i, 'review still asks by default');
    assert.match(
      review,
      /unless an orchestrator has already resolved depth/i,
      'review carves out the orchestrator-resolved depth',
    );
  });

  // T3b (finding 4): merge confirmation is not an unconditional hard gate — it is waivable
  // per the dormant-vs-live rule; the lifecycle merge opener is no longer a bare "Confirm".
  test(`[${type}] orchestrate merge confirmation is waivable per dormant-vs-live, not "regardless"`, () => {
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.doesNotMatch(
      orch,
      /stop the run regardless/i,
      'hard-gates line no longer claims merge confirmation stops the run regardless',
    );
    assert.match(
      orch,
      /merge confirmation \(waivable/i,
      'hard-gates line marks merge confirmation waivable',
    );
    assert.doesNotMatch(
      orch,
      /5\. \*\*Merge\.\*\* Confirm with the user, then follow/,
      'lifecycle merge opener is no longer an unconditional confirm',
    );
    // dormant/live pins survive
    assert.match(orch, /distinguish dormant from live/i, 'dormant-vs-live pin intact');
    assert.match(orch, /alters live production behavior always gets an explicit confirm/i, 'live-confirm pin intact');
  });

  // T3c (finding 5): the stacking escape hatch is reconciled with "one phase of one ticket
  // at a time" and named as a hard gate that stops the run.
  test(`[${type}] orchestrate reconciles the stacking hatch with one-phase-at-a-time`, () => {
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(
      orch,
      /except under the approved stacking hatch/i,
      'one-phase rule carries the stacking-hatch exception',
    );
    assert.match(
      orch,
      /stacking approval/i,
      'hard-gates line names stacking approval a gate',
    );
    // the rebase --onto pin survives
    assert.match(orch, /git rebase --onto origin\//, 'rebase --onto pin intact');
  });

  // T3d (finding 9): under orchestration the delegation contract's embedded-write exception
  // does not apply — the orchestrator keeps every write.
  test(`[${type}] orchestrate overrides the delegation embedded-write exception`, () => {
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(
      orch,
      /embedded-write exception does not apply under orchestration/i,
      'orchestrate voids the embedded-write exception',
    );
    assert.match(orch, /keeps every .*write|keep every .*write/i, 'orchestrator keeps every write');
    // pins survive
    assert.match(orch, /never push, open PRs/i, 'sub-agent no-push pin intact');
    assert.match(orch, /Delegation contract/, 'delegation contract pin intact');
  });

  // T3e (finding 10, R2): the persist offer fires ONLY when the split came from the
  // interactive ask — never after a per-run override, never for a config-pinned split.
  test(`[${type}] orchestrate persist offer fires only when the split came from the interactive ask (R2)`, () => {
    const orch = renderSkill('orchestrate-ticket', envType(type)).content;
    assert.match(
      orch,
      /the persist offer fires only when the split came from the interactive ask — never after a per-run override, never for a config-pinned split/i,
      'R2 encoded verbatim in orchestrate',
    );
    assert.doesNotMatch(
      orch,
      /When the run's split is not already pinned in config, offer to save/i,
      'the old not-already-pinned trigger is gone',
    );
    // pinned phrases survive
    assert.match(orch, /after the run completes/i, 'after-run-completes pin intact');
    assert.match(orch, /final boundary summary/i, 'final-boundary-summary pin intact');
    assert.match(orch, /back on the base branch/i, 'base-branch pin intact');
    assert.match(orch, /Never edit the config mid-run/i, 'never-edit-mid-run pin intact');
  });

  // T4 (finding 11): on resume, a clean tree with an open PR means the ship already ran, so
  // the entry point routes to step 5 (attach/notify/state), not step 4 (push/open); and the
  // step-5 writes each carry an idempotency rider so a resume posts no duplicate.
  test(`[${type}] execute resume routes to step 5 and step-5 writes are idempotent`, () => {
    const out = renderSkill('execute-ticket', envType(type)).content;
    // the clean-tree + open-PR entry point points at step 5, not the mispointed step 4
    assert.match(
      out,
      /the ship already happened\. Skip to step 5/i,
      'clean-tree+PR resume routes to step 5',
    );
    assert.doesNotMatch(
      out,
      /the ship already happened\. Skip to step 4/i,
      'the step-4 mispointer is gone',
    );
    // idempotency riders on each step-5 write. attachPR's idempotency is now op-level
    // (T14/Q2): the skip clause lives in the adapter op, so it renders on BOTH backends
    // (Linear "attached", Jira "linked") without a template rider.
    assert.match(
      out,
      /skip if the same PR is already (attached|linked)/i,
      'attachPR op-level idempotency clause',
    );
    assert.match(out, /skip if a shipping note already exists/i, 'shipping-note rider');
    assert.match(
      out,
      /idempotent(ly)? in place|updated in place/i,
      'artifact-write is idempotent in place',
    );
  });

  // T5 (finding 8): the execute commit confirm is conditional — it fires only when the
  // message phrasing or file attribution isn't obvious (the Stop-and-ask cases), not on every
  // commit. Self-containment (full message + display mandate) is preserved.
  test(`[${type}] execute commit confirm fires only when phrasing/attribution isn't obvious`, () => {
    const out = renderSkill('execute-ticket', envType(type)).content;
    assert.match(
      out,
      /when the commit message('s)? phrasing or (the )?file attribution isn't obvious/i,
      'commit confirm is gated on non-obvious phrasing/attribution',
    );
    // preserved self-containment pins (APU-793)
    assert.match(
      out,
      /the full proposed commit message — its title and body/i,
      'commit confirm still carries the full message',
    );
    assert.match(
      out,
      /in the message body immediately before this question/i,
      'display mandate preserved',
    );
  });

  // T6 (finding 12): next-ticket cosmetics — "final" dropped from the blocked-list sentence
  // (there is only one such list), and step 8's recommendation instruction aligned with the
  // Output-shape "Recommend:" format so the two read as one coherent instruction.
  test(`[${type}] next-ticket blocked-list and recommendation wording are reconciled`, () => {
    const out = renderSkill('next-ticket', envType(type)).content;
    assert.doesNotMatch(
      out,
      /a final "blocked, not yet actionable" list/i,
      '"final" dropped from the blocked-list sentence',
    );
    assert.match(
      out,
      /a "blocked, not yet actionable" list/i,
      'the blocked-list sentence survives without "final"',
    );
    // step 8 speaks in terms of the Output-shape Recommend: line
    assert.match(
      out,
      /End with a single `Recommend:` line/i,
      'step 8 aligns with the Output-shape Recommend: format',
    );
  });
}

// APU-796: docs-drift sweep on the generated prose. Both backends looped.
for (const type of ['linear', 'jira']) {
  // Findings 2+3: the orchestrate description and the onboarding orchestrate row scope the
  // bubbling to mid-run — an unqualified "bubble questions to the user" over-claims, since the
  // kickoff model-split ask and the run-end persist offer are neither mid-run class.
  test(`[${type}] orchestrate-ticket description scopes its bubbles to mid-run`, () => {
    const f = renderSkill('orchestrate-ticket', envType(type));
    // the frontmatter block is everything between the opening and closing `---`; the
    // description is YAML-folded across several lines, so scope the assertion to the block.
    const fm = f.content.split('\n---', 1)[0];
    assert.match(fm, /^description:/m, 'frontmatter carries a description');
    assert.match(fm, /mid-run/, 'description scopes the bubbles to mid-run');
  });

  test(`[${type}] onboarding orchestrate row names mid-run bubbling plus the kickoff model-split`, () => {
    const doc = renderDoc({ config: configFor(type), backend: getBackend(type) });
    const row = doc.split('\n').find((l) => /orchestrate-ticket/.test(l) && /Planner/.test(l));
    assert.ok(row, 'onboarding doc has the orchestrate-ticket phase row');
    assert.match(row, /mid-run/, 'orchestrate row scopes bubbling to mid-run');
    assert.match(row, /model-split/, 'row names the kickoff model-split choice');
  });

  // Finding 4: the workflow is not literally five phases (fix-ticket + orchestrate-ticket
  // exist), so neither the guide nor the onboarding doc claims a fixed phase count.
  test(`[${type}] neither the workflow guide nor the onboarding doc claims a fixed phase count`, () => {
    const guide = renderGuide(envType(type));
    const doc = renderDoc({ config: configFor(type), backend: getBackend(type) });
    assert.doesNotMatch(guide, /five-phase/i, 'guide drops the phase count');
    assert.doesNotMatch(doc, /five-phase/i, 'onboarding doc drops the phase count');
  });

  // Finding 9 (onboarding): the "invoke a phase directly" list must name every phase — it was
  // missing fix-ticket and orchestrate-ticket.
  test(`[${type}] onboarding invoke-directly list names fix-ticket and orchestrate-ticket`, () => {
    const doc = renderDoc({ config: configFor(type), backend: getBackend(type) });
    const line = doc.split('\n').find((l) => /Invoke a phase directly/.test(l));
    assert.ok(line, 'the invoke-directly line renders');
    assert.match(line, /\/fix-ticket/, 'invoke-directly list names fix-ticket');
    assert.match(line, /\/orchestrate-ticket/, 'invoke-directly list names orchestrate-ticket');
  });
}
