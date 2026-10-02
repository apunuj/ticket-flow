# Contributing to Ticket-Flow

Thanks for your interest in improving Ticket-Flow. This guide covers how to get
set up, run the tests, and submit changes.

## Prerequisites

- Node.js 18 or newer
- git

## Getting started

```bash
git clone https://github.com/apunuj/ticket-flow.git
cd ticket-flow
npm install
npm test
```

The test suite is the ground truth for behavior. The full test suite should pass
on a clean checkout before you start.

## Development workflow

- Run the full suite with `npm test`.
- Run with coverage using `npm run test:coverage`.
- Exercise the CLI locally without publishing:

  ```bash
  node bin/cli.js init
  node bin/cli.js build
  node bin/cli.js upgrade
  node bin/cli.js check
  node bin/cli.js doctor
  ```

## Project layout

- `bin/cli.js` — CLI entry point and command routing.
- `src/cli/` — `init`, `build`, `check`, `doctor`, and `upgrade` command implementations.
- `src/backends/` — Linear and Jira adapters. Add new backends here.
- `src/render/` — per-tool renderers (Claude Code, Codex, Copilot, Cursor, opencode). Adding
  one here is all a new agent needs: `tools: all` configs and `ticket-flow add` pick it up.
- `src/compose/` — composes canonical skill templates into rendered output.
- `skills/` — canonical Handlebars skill templates shared across all tools.
- `schema/config.schema.json` — JSON Schema for `ticket-flow.config.yaml`.
- `templates/` and `examples/` — starter and reference configs.
- `test/` — Node built-in test runner suites, one per source area.

## Guidelines

- Keep skill templates backend-neutral. Concrete Linear or Jira instructions
  belong in the backend adapters, not in the shared templates.
- Do not hardcode project details (name, ticket prefix, states, branch pattern)
  in generated output. They come from `ticket-flow.config.yaml`.
- Add or update tests for any behavior change. New backends and renderers should
  come with their own test coverage.
- If you change the config shape, update `schema/config.schema.json`, the
  `templates/` and `examples/` configs, and the README together.
- Keep changes to generated files and `TICKET-FLOW.md` in sync with the
  templates that produce them.

## Submitting changes

1. Fork the repo and create a branch off `master`.
2. Make your change with accompanying tests.
3. Run `npm test` and confirm everything passes.
4. Add a bullet under `## [Unreleased]` in `CHANGELOG.md`.
5. Open a pull request describing the change and the motivation. CI runs the
   test suite on Node 18, 20, and 22.

## Releases

GitHub Releases must describe the same version and package contents as npm.
Creating a GitHub release for an existing npm version does not authorize a new
npm version or a new npm publication.

To add a missing GitHub release for an already-published npm version:

1. Read that exact version's npm metadata and download its published tarball.
2. Verify every packaged file against the intended Git source snapshot and
   check the package version. Run the corresponding test suite.
3. Tag the verified snapshot as `vX.Y.Z`. If the source was never committed,
   record that the commit was reconstructed from the published package rather
   than claiming it was the original publication commit.
4. Create the GitHub Release at that tag and attach the existing npm tarball
   with its SHA-256 checksum. Verify the uploaded archive matches npm byte for byte.
5. Keep later implementation changes under Unreleased. A new npm version needs
   its own explicit release scope and authorization.

Historical note: npm 0.7.0 was published on 2026-09-30 before its workflow changes
were committed to GitHub. Its GitHub tag is a verified source reconstruction.
APU-1102's portable helpers remain unreleased and are not part of npm 0.7.0.

## Reporting bugs

Open an issue at https://github.com/apunuj/ticket-flow/issues with steps to
reproduce, what you expected, and what happened. Include your Node version and,
when relevant, a minimal `ticket-flow.config.yaml`.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
