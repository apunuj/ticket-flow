import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { getBackend } from '../backends/index.js';
import { getTool } from '../render/index.js';
import { SKILLS } from '../compose/composer.js';

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function check({ configPath } = {}) {
  const cfgPath = path.resolve(configPath || 'ticketflow.config.yaml');
  const config = loadConfig(cfgPath); // throws with readable errors if invalid
  console.log(`✓ Config valid: ${path.relative(process.cwd(), cfgPath)}`);

  const backend = getBackend(config.backend.type);
  config.tools.forEach((t) => getTool(t)); // validates tool ids

  console.log(`\nProject:  ${config.project.name} (${config.project.ticketPrefix})`);
  console.log(`Backend:  ${backend.displayName} — project "${config.backend.project}"`);
  console.log(`Grouping: by ${backend.groupingNoun}${backend.capabilities.groups ? '' : ' (flat)'}`);
  console.log(`Base:     ${config.git.baseBranch} (merge: ${config.git.mergeStrategy})`);
  console.log(`Tools:    ${config.tools.join(', ')}`);
  console.log(`Skills:   ${SKILLS.join(', ')}`);

  console.log(`\nRequires: ${backend.requires}`);
  console.log(`          \`gh\` CLI authenticated against your GitHub remote.`);

  console.log(`\nEnvironment:`);
  console.log(`  gh CLI: ${has('gh') ? 'found' : 'MISSING — execute/review/merge need it'}`);
  console.log(`  git:    ${has('git') ? 'found' : 'MISSING'}`);

  if (!backend.capabilities.attachments) {
    console.log(
      `\nNote: ${backend.displayName} has no first-class PR "attachment" — the PR is linked via a comment/remote link and stored in the work-artifact comment.`,
    );
  }
  return config;
}
