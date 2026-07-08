#!/usr/bin/env node
import { runInit } from '../src/cli/init.js';
import { runBuild } from '../src/cli/build.js';
import { check } from '../src/cli/check.js';
import { doctor } from '../src/cli/doctor.js';
import { upgrade } from '../src/cli/upgrade.js';

const HELP = `ticket-flow — portable ticket-driven workflow skills for Claude Code, Copilot, and opencode

Usage:
  ticket-flow init [--force] [--defaults]  Set up ticket-flow.config.yaml (interactive; --defaults to skip prompts)
  ticket-flow build [--config <p>] [--out <dir>]   Generate the skills for your configured tools
  ticket-flow upgrade [--force]           Regenerate after a new ticket-flow version: migrate config, prune stale files (--force to overwrite uncommitted hand edits)
  ticket-flow doctor [--config <p>] [--out <dir>]  Preflight checklist: config, git, gh, generated files, MCP
  ticket-flow check [--config <p>]        Validate config + report backend/tool requirements

Lifecycle the generated skills drive:
  next-ticket → describe-ticket → execute-ticket → review-ticket → merge-ticket
  (fix-ticket addresses review comments / failing CI; loops back from review or merge)
  (orchestrate-ticket runs the whole lifecycle across one or more tickets with sub-agents)
`;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--defaults' || a === '--yes' || a === '-y') flags.defaults = true;
    else if (a === '--config') flags.configPath = argv[++i];
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '-h' || a === '--help') flags.help = true;
  }
  return flags;
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

async function main() {
  if (flags.help || !cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
  } else if (cmd === 'init') {
    await runInit(flags);
  } else if (cmd === 'build') {
    runBuild(flags);
  } else if (cmd === 'upgrade') {
    upgrade(flags);
  } else if (cmd === 'check') {
    check(flags);
  } else if (cmd === 'doctor') {
    doctor(flags);
  } else {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
