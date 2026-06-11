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
- `docs/package-and-release.md`
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

- publish a GitHub Release, or
- run the workflow manually and type `publish-npm`.

The workflow uses npm trusted publishing through GitHub OIDC and publishes with
provenance:

```bash
npm publish --provenance --access public
```

It does not publish to GitHub Packages. It also does not use local npm tokens
or checked-in publishing credentials.

## Operator Handoff

Before the first npm publish, an npm package owner must:

1. Confirm the `@mean-weasel` npm organization or scope owns the package name.
2. Configure npm trusted publishing for the GitHub repository
   `mean-weasel/contract-ledger` and the `Release` workflow.
3. Confirm the GitHub `npm-production` environment reviewers and protection
   rules match the release policy.
4. Run `npm run check` and `npm pack --dry-run` locally and inspect the package
   file list.
5. Create a GitHub Release or manually dispatch the release workflow with
   `publish-npm`.

Do not publish from a workstation unless the GitHub trusted publishing path is
unavailable and the operator has approved a different release policy.
