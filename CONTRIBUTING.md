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

GitHub Releases are the release entry point. Publish from a committed, tested tag;
do not run `npm publish` from a local working tree.

1. Update `package.json`, both root versions in `package-lock.json`, and CHANGELOG.
   Use a new npm version; published versions cannot be replaced.
2. Open and merge a release PR after the Node 18/20/22 CI matrix passes.
3. Create a `vX.Y.Z` tag at that merged commit and publish its GitHub Release.
   The tag must match the committed package and lockfile versions. Prereleases
   are not published by this workflow.
4. Watch `.github/workflows/release.yml`. It tests the tagged source on Node
   18/20/22, attaches the npm tarball and SHA-256 checksum to the release, and
   publishes that same tarball to npm using OIDC trusted publishing.
5. Verify the GitHub release assets, npm version, and installed-package smoke.
   A GitHub release page alone does not prove that npm publishing succeeded.

One-time npm setup: configure a GitHub Actions trusted publisher for package
`ticket-flow`, repository `apunuj/ticket-flow`, workflow filename `release.yml`,
with publishing allowed and no environment restriction. No npm token is stored
in GitHub. See [npm's trusted publishing setup](https://docs.npmjs.com/trusted-publishers/).

Historical note: npm 0.7.0 was published on 2026-09-30 before its workflow changes
were committed to GitHub. Version 0.8.0 reconciles those skills with APU-1102's
portable helpers. There is no historical `v0.7.0` Git tag to recreate accurately.

## Reporting bugs

Open an issue at https://github.com/apunuj/ticket-flow/issues with steps to
reproduce, what you expected, and what happened. Include your Node version and,
when relevant, a minimal `ticket-flow.config.yaml`.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
