# Package And Release

Contract Ledger is packaged for npm as `@mean-weasel/contract-ledger`.
The package exposes the `contract` binary and keeps CLI behavior identical to
local development builds.

## Install

Global install:

```bash
npm install --global @mean-weasel/contract-ledger
contract version
```

One-off execution without a global install:

```bash
npx @mean-weasel/contract-ledger version
npm exec --package @mean-weasel/contract-ledger -- contract version
```

Local repository development:

```bash
npm install
npm run build
npm run dev -- version
```

## Package Verification

Run the full check suite before any release:

```bash
npm run check
npm pack --dry-run
```

The dry run must include:

- `package.json`
- `README.md`
- `docs/getting-started.md`
- `docs/loops.md`
- `docs/package-and-release.md`
- `examples/loop-conveyors.md`
- `skills/contract-ledger/SKILL.md`
- `dist/cli.js`
- `dist/index.js`
- the supporting compiled `dist/**/*.js` modules imported by the CLI

Stop the release if `npm pack --dry-run` omits the CLI entrypoint or includes
unintended local state such as `.contracts/`, tests, source TypeScript, or
GoalBuddy planning files.

## GitHub CI

`.github/workflows/ci.yml` runs on GitHub pull requests and pushes to `main`.
It installs with `npm ci`, runs `npm run check`, and verifies package contents
with `npm pack --dry-run`.

## npm Release

`.github/workflows/release.yml` is gated to explicit operator actions:

- push a `v*` tag that matches `package.json`, or
- run the workflow manually and type `publish-npm`.

The workflow uses npm trusted publishing through GitHub OIDC and publishes with
provenance:

```bash
npm publish --provenance --access public
```

It does not publish to GitHub Packages. It also does not use local npm tokens
or checked-in publishing credentials.

Use new release tags from the current package version onward. The early
`v0.1.0` tag was part of the first publish setup and should not be reused or
force-moved.

## Operator Handoff

Before an npm publish, an npm package owner must:

1. Confirm the `@mean-weasel` npm organization or scope owns the package name.
2. Configure npm trusted publishing for the GitHub repository
   `mean-weasel/contract-ledger` and the `Release` workflow.
3. Run `npm run check` and `npm pack --dry-run` locally and inspect the package
   file list.
4. Publish by pushing a version tag that matches `package.json`, for example
   `v0.1.3`, or manually dispatch the release workflow with `publish-npm`.

Do not publish from a workstation unless the GitHub trusted publishing path is
unavailable and the operator has approved a different release policy.
