import claude from './claude.js';
import copilot from './copilot.js';
import opencode from './opencode.js';

export const tools = { claude, copilot, opencode };

export function getTool(id) {
  const t = tools[id];
  if (!t) {
    throw new Error(`Unknown tool "${id}". Available: ${Object.keys(tools).join(', ')}.`);
  }
  return t;
}
