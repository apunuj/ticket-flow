import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { renderAll } from '../src/build.js';
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
    const files = renderFor(backend);
    assert.equal(files.length, SKILLS.length * 3, 'expect 5 skills × 3 tools');
  });

  test(`[${backend}] no host-specific or unresolved tokens leak`, () => {
    for (const f of renderFor(backend)) {
      assert.ok(!f.content.includes('mcp__'), `${f.path} leaks a host-prefixed mcp__ tool name`);
      assert.ok(!f.content.includes('{{'), `${f.path} has an unrendered handlebars token`);
      assert.ok(!f.content.includes('[[unknown'), `${f.path} references an unknown op`);
    }
  });

  test(`[${backend}] tool-specific arg syntax`, () => {
    for (const f of renderFor(backend)) {
      if (f.tool === 'copilot') {
        assert.ok(!/\$1\b/.test(f.content), `${f.path} (copilot) must not use positional $1`);
      }
    }
    const copilotExec = renderFor(backend).find(
      (f) => f.tool === 'copilot' && f.path.includes('execute-ticket'),
    );
    assert.match(copilotExec.content, /\$\{input:ticket\}/, 'copilot uses ${input:ticket}');
  });

  test(`[${backend}] code-review tail differs by tool`, () => {
    const files = renderFor(backend);
    const claudeReview = files.find((f) => f.tool === 'claude' && f.path.includes('review-ticket'));
    const opencodeReview = files.find((f) => f.tool === 'opencode' && f.path.includes('review-ticket'));
    assert.match(claudeReview.content, /built-in \*\*code-review\*\* skill/, 'claude delegates');
    assert.match(opencodeReview.content, /no built-in code-review/, 'opencode inlines the checklist');
    assert.ok(
      !opencodeReview.content.includes('built-in **code-review** skill'),
      'opencode must not delegate to a Claude-only skill',
    );
  });

  test(`[${backend}] output paths are correct per tool`, () => {
    for (const f of renderFor(backend)) {
      if (f.tool === 'claude') assert.match(f.path, /^\.claude\/skills\/[\w-]+\/SKILL\.md$/);
      if (f.tool === 'copilot') assert.match(f.path, /^\.github\/prompts\/[\w-]+\.prompt\.md$/);
      if (f.tool === 'opencode') assert.match(f.path, /^\.opencode\/command\/[\w-]+\.md$/);
    }
  });
}

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
