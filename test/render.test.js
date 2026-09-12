import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { renderAll, build, wireOpencodeInstructions } from '../src/build.js';
import { SKILLS } from '../src/compose/composer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseConfig = () =>
  parseConfig(fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8'));

function renderFor(backendType) {
  const cfg = baseConfig();
  cfg.backend.type = backendType;
  return renderAll(cfg);
}

for (const backend of ['linear', 'jira']) {
  test(`[${backend}] renders all skills for all tools`, () => {
    const cfg = baseConfig();
    const skills = renderFor(backend).filter((f) => f.kind === 'skill');
    assert.equal(
      skills.length,
      SKILLS.length * cfg.tools.length,
      `expect ${SKILLS.length} skills × ${cfg.tools.length} tools`,
    );
  });

  test(`[${backend}] emits an always-on guide for copilot/cursor/opencode, an overview skill for claude/codex`, () => {
    const files = renderFor(backend);

    const copilotGuide = files.find((f) => f.tool === 'copilot' && f.kind === 'guide');
    assert.ok(copilotGuide, 'copilot has an always-on guide');
    assert.equal(copilotGuide.path, '.github/instructions/ticket-flow.instructions.md');
    assert.match(copilotGuide.content, /applyTo:\s*["']\*\*["']/, "copilot guide is always-on (applyTo: '**')");
    assert.match(copilotGuide.content, /do _not_ need to type the slash command/);
    for (const skill of SKILLS) assert.ok(copilotGuide.content.includes(skill), `guide maps ${skill}`);

    const opencodeGuide = files.find((f) => f.tool === 'opencode' && f.kind === 'guide');
    assert.ok(opencodeGuide, 'opencode has an always-on guide');
    assert.equal(opencodeGuide.path, '.opencode/ticket-flow.md');
    assert.match(opencodeGuide.content, /\.opencode\/command\/next-ticket\.md/, 'points at the command file');

    const cursorGuide = files.find((f) => f.tool === 'cursor' && f.kind === 'guide');
    assert.ok(cursorGuide, 'cursor has an always-on guide');
    assert.equal(cursorGuide.path, '.cursor/rules/ticket-flow.mdc');
    assert.match(cursorGuide.content, /alwaysApply: true/, 'cursor rule is always-on');
    assert.match(cursorGuide.content, /\.cursor\/commands\/next-ticket\.md/, 'points at the command file');

    // claude and codex both pick a phase from its skill description, so neither needs an
    // always-on guide — each gets a discovery/overview skill instead.
    for (const [tool, overviewPath] of [
      ['claude', '.claude/skills/ticket-flow/SKILL.md'],
      ['codex', '.agents/skills/ticket-flow/SKILL.md'],
    ]) {
      const overview = files.find((f) => f.tool === tool && f.kind === 'overview');
      assert.ok(overview, `${tool} gets an overview skill for discovery/education`);
      assert.equal(overview.path, overviewPath);
      assert.match(overview.content, /name: ticket-flow/);
      assert.ok(
        !files.some((f) => f.tool === tool && f.kind === 'guide'),
        `${tool} has no always-on guide file — its skills auto-invoke from their description`,
      );
    }
  });

  test(`[${backend}] no host-specific or unresolved tokens leak`, () => {
    for (const f of renderFor(backend)) {
      assert.ok(!f.content.includes('mcp__'), `${f.path} leaks a host-prefixed mcp__ tool name`);
      assert.ok(!f.content.includes('{{'), `${f.path} has an unrendered handlebars token`);
      assert.ok(!f.content.includes('[[unknown'), `${f.path} references an unknown op`);
    }
  });

  test(`[${backend}] tool-specific arg syntax`, () => {
    const files = renderFor(backend);
    // copilot, cursor and codex all lack positional substitution — a literal $1 would reach
    // the agent unexpanded and be read as part of the ticket id.
    for (const f of files) {
      if (['copilot', 'cursor', 'codex'].includes(f.tool)) {
        assert.ok(!/\$1\b/.test(f.content), `${f.path} (${f.tool}) must not use positional $1`);
      }
    }
    const exec = (tool) => files.find((f) => f.tool === tool && f.path.includes('execute-ticket'));
    assert.match(exec('copilot').content, /\$\{input:ticket\}/, 'copilot uses ${input:ticket}');
    for (const tool of ['cursor', 'codex']) {
      assert.match(exec(tool).content, /<ticket-id>/, `${tool} uses the <ticket-id> placeholder`);
    }
  });

  test(`[${backend}] code-review tail differs by tool`, () => {
    const files = renderFor(backend);
    const claudeReview = files.find((f) => f.tool === 'claude' && f.path.includes('review-ticket'));
    const opencodeReview = files.find((f) => f.tool === 'opencode' && f.path.includes('review-ticket'));
    assert.match(claudeReview.content, /built-in \*\*code-review\*\* skill/, 'claude delegates');
    assert.match(opencodeReview.content, /no built-in code-review/, 'opencode inlines the checklist');

    const cursorReview = files.find((f) => f.tool === 'cursor' && f.path.includes('review-ticket'));
    const codexReview = files.find((f) => f.tool === 'codex' && f.path.includes('review-ticket'));
    assert.match(cursorReview.content, /Cursor has no built-in code-review/, 'cursor inlines the checklist');
    assert.match(codexReview.content, /built-in \*\*`\/review`\*\*/, 'codex delegates to its own /review');
    assert.doesNotMatch(codexReview.content, /no built-in code-review/, 'codex does not inline the checklist');

    // no tool but claude may point at the Claude-only code-review skill
    for (const f of files.filter((f) => f.tool !== 'claude')) {
      assert.ok(
        !f.content.includes('built-in **code-review** skill'),
        `${f.path} (${f.tool}) must not delegate to a Claude-only skill`,
      );
    }
  });

  test(`[${backend}] output paths are correct per tool`, () => {
    for (const f of renderFor(backend).filter((f) => f.kind === 'skill')) {
      if (f.tool === 'claude') assert.match(f.path, /^\.claude\/skills\/[\w-]+\/SKILL\.md$/);
      if (f.tool === 'copilot') assert.match(f.path, /^\.github\/prompts\/[\w-]+\.prompt\.md$/);
      if (f.tool === 'opencode') assert.match(f.path, /^\.opencode\/command\/[\w-]+\.md$/);
      if (f.tool === 'cursor') assert.match(f.path, /^\.cursor\/commands\/[\w-]+\.md$/);
      if (f.tool === 'codex') assert.match(f.path, /^\.agents\/skills\/[\w-]+\/SKILL\.md$/);
    }
  });
}

test('build() wires opencode.json instructions (create, idempotent, and merge)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-flow-'));
  try {
    const cfg = baseConfig();
    cfg.tools = ['opencode'];

    // fresh create
    build(cfg, { outputDir: dir });
    const jsonPath = path.join(dir, 'opencode.json');
    assert.ok(fs.existsSync(jsonPath), 'opencode.json created');
    assert.ok(fs.existsSync(path.join(dir, '.opencode', 'ticket-flow.md')), 'guide file written');
    let parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(parsed.instructions, ['./.opencode/ticket-flow.md']);

    // idempotent — second build does not duplicate the entry
    const again = wireOpencodeInstructions(dir);
    assert.equal(again.action, 'already wired');
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(parsed.instructions.filter((i) => i === './.opencode/ticket-flow.md').length, 1);

    // merge — preserves a user's existing instructions
    fs.writeFileSync(jsonPath, JSON.stringify({ instructions: ['./house-rules.md'] }, null, 2));
    const merged = wireOpencodeInstructions(dir);
    assert.equal(merged.action, 'merged');
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(parsed.instructions, ['./house-rules.md', './.opencode/ticket-flow.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fix-ticket renders as a PR-feedback remediation skill', () => {
  const fix = renderFor('linear').find((f) => f.tool === 'claude' && f.path.includes('fix-ticket'));
  assert.ok(fix, 'fix-ticket is rendered');
  assert.match(fix.content, /gh pr checks/, 'inspects CI');
  assert.match(fix.content, /review comments|review threads/i, 'inspects review feedback');
  assert.match(fix.content, /Confirm scope/i, 'gates on confirmed scope');
});

test('review and merge hand off to fix-ticket', () => {
  const files = renderFor('linear');
  const review = files.find((f) => f.tool === 'claude' && f.path.includes('review-ticket'));
  const merge = files.find((f) => f.tool === 'claude' && f.path.includes('merge-ticket'));
  assert.match(review.content, /fix-ticket/, 'review-ticket suggests fix-ticket on needs-changes');
  assert.match(merge.content, /fix-ticket/, 'merge-ticket offers the fix-ticket hand-off');
});

test('[linear] groups by milestone; [jira] groups by sprint + transitions', () => {
  const linNext = renderFor('linear').find((f) => f.path.includes('next-ticket') && f.tool === 'claude');
  const jiraNext = renderFor('jira').find((f) => f.path.includes('next-ticket') && f.tool === 'claude');
  const jiraMerge = renderFor('jira').find((f) => f.path.includes('merge-ticket') && f.tool === 'claude');
  assert.match(linNext.content, /milestone/);
  assert.match(jiraNext.content, /sprint/);
  assert.match(jiraMerge.content, /transition/);
});

test('config validation rejects an unknown backend', () => {
  assert.throws(() => parseConfig('project:\n  name: X\n  ticketPrefix: X\nbackend:\n  type: bogus\n  project: X\ngit:\n  baseBranch: main\ntest:\n  command: x\ntools:\n  - claude\n'));
});
