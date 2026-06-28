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

test('renderForTool tags skills, and only copilot/opencode get a guide', () => {
  const claude = renderForTool(env('claude'));
  assert.equal(claude.length, SKILLS.length);
  assert.ok(claude.every((f) => f.kind === 'skill'), 'claude emits skills only');

  for (const toolId of ['copilot', 'opencode']) {
    const files = renderForTool(env(toolId));
    const skills = files.filter((f) => f.kind === 'skill');
    const guides = files.filter((f) => f.kind === 'guide');
    assert.equal(skills.length, SKILLS.length);
    assert.equal(guides.length, 1, `${toolId} emits exactly one guide`);
  }
});

test('renderExtras is empty for a tool with no extras hook', () => {
  assert.deepEqual(renderExtras(env('claude')), []);
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
