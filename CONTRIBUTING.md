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

The test suite is the ground truth for behavior. All 99+ tests should pass on a
clean checkout before you start.

## Development workflow

- Run the full suite with `npm test`.
- Run with coverage using `npm run test:coverage`.
- Exercise the CLI locally without publishing:

  ```bash
  node bin/cli.js init
  node bin/cli.js build
  node bin/cli.js check
  node bin/cli.js doctor
  ```

## Project layout

- `bin/cli.js` — CLI entry point and command routing.
- `src/cli/` — `init`, `build`, `check`, and `doctor` command implementations.
- `src/backends/` — Linear and Jira adapters. Add new backends here.
- `src/render/` — per-tool renderers (Claude Code, Copilot, opencode).
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

## Reporting bugs

Open an issue at https://github.com/apunuj/ticket-flow/issues with steps to
reproduce, what you expected, and what happened. Include your Node version and,
when relevant, a minimal `ticket-flow.config.yaml`.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
