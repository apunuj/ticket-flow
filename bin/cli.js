#!/usr/bin/env node
import { init } from '../src/cli/init.js';
import { runBuild } from '../src/cli/build.js';
import { check } from '../src/cli/check.js';

const HELP = `ticket-flow — portable ticket-driven workflow skills for Claude Code, Copilot, and opencode

Usage:
  ticket-flow init [--force]              Write a ticket-flow.config.yaml to start from
  ticket-flow build [--config <p>] [--out <dir>]   Generate the skills for your configured tools
  ticket-flow check [--config <p>]        Validate config + report backend/tool requirements

Lifecycle the generated skills drive:
  next-ticket → describe-ticket → execute-ticket → review-ticket → merge-ticket
`;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--config') flags.configPath = argv[++i];
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '-h' || a === '--help') flags.help = true;
  }
  return flags;
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

try {
  if (flags.help || !cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
  } else if (cmd === 'init') {
    init(flags);
  } else if (cmd === 'build') {
    runBuild(flags);
  } else if (cmd === 'check') {
    check(flags);
  } else {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
