import YAML from 'yaml';

// Emit a YAML frontmatter block from an ordered object (insertion order preserved).
export function frontmatter(obj) {
  const clean = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  return '---\n' + YAML.stringify(clean).trimEnd() + '\n---\n';
}

// A "> Usage: `/name <hint>`" line for tools that have no argument-hint frontmatter field.
// `prefix` is how the tool starts a skill (Codex uses `$name`, not `/name`).
export function usageLine(meta, prefix = '/') {
  const hint = meta['argument-hint'];
  return hint ? `> Usage: \`${prefix}${meta.name} ${hint}\`\n\n` : '';
}
