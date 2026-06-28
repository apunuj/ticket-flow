import linear from './linear.js';
import jira from './jira.js';

export const backends = { linear, jira };

export function getBackend(type) {
  const b = backends[type];
  if (!b) {
    throw new Error(`Unknown backend "${type}". Available: ${Object.keys(backends).join(', ')}.`);
  }
  return b;
}
