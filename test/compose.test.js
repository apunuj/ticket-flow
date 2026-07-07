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
