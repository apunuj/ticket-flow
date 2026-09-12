import claude from './claude.js';
import codex from './codex.js';
import copilot from './copilot.js';
import cursor from './cursor.js';
import opencode from './opencode.js';

export const tools = { claude, codex, copilot, cursor, opencode };

export function getTool(id) {
  const t = tools[id];
  if (!t) {
    throw new Error(`Unknown tool "${id}". Available: ${Object.keys(tools).join(', ')}.`);
  }
  return t;
}
