# Contract Ledger

SQLite-backed local CLI contracts for grounding agent work in explicit
definitions of done, verifiers, receipts, failure modes, and audit logs.

## Install

From npm:

```bash
npm install --global @mean-weasel/contract-ledger
contract version
```

Run without a global install:

```bash
npx @mean-weasel/contract-ledger version
npm exec --package @mean-weasel/contract-ledger -- contract version
```

For local development:

```bash
npm install
npm run build
```

## First Use

Create a contract from any project directory. The first command creates
`.contracts/ledger.sqlite` in that directory; keep running `contract` from the
same directory to keep using the same ledger.

```bash
contract init "Fix billing settings regression" --intent "Canceled users cannot access premium export" --scope "Billing settings"
contract accept ctr_xxx
crit_id=$(contract criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command)
contract criteria-set-status "$crit_id" --status satisfied
contract todo-add ctr_xxx "Verify premium export is hidden"
ver_id=$(contract verifier-add-command ctr_xxx billing-tests -- npm test -- billing)
contract failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
contract receipt-run ctr_xxx --criterion "$crit_id" --verifier "$ver_id" -- npm test -- billing
contract export ctr_xxx
contract close ctr_xxx
```

For one-off use without installing globally, replace `contract` with:

```bash
npx @mean-weasel/contract-ledger
```

The full first-use flow, including what each command records in the ledger, is
documented in `docs/getting-started.md`.

## Local Development Usage

During development, run the CLI with `npm run dev --`:

```bash
npm run dev -- init "Fix billing settings regression" --intent "Canceled users cannot access premium export" --scope "Billing settings"
npm run dev -- accept ctr_xxx
crit_id=$(npm run --silent dev -- criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command)
npm run dev -- criteria-set-status "$crit_id" --status satisfied
npm run dev -- todo-add ctr_xxx "Verify premium export is hidden"
ver_id=$(npm run --silent dev -- verifier-add-command ctr_xxx billing-tests -- npm test -- billing)
npm run dev -- failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
npm run dev -- receipt-add ctr_xxx --criterion "$crit_id" --verifier "$ver_id" --summary "Reviewed command output and browser state" --status pass
npm run dev -- receipt-run ctr_xxx -- node -e "console.log('proof')"
npm run dev -- export ctr_xxx
npm run dev -- close ctr_xxx
```

Use `--` before child commands for `receipt-run` and
`verifier-add-command`. That pass-through marker keeps child flags such as
`node -e` or nested separators such as `npm test -- billing` attached to the
child command instead of being parsed as Contract Ledger options.

`receipt-run` can also link command evidence directly to closeout gates:

```bash
npm run dev -- receipt-run ctr_xxx --criterion crit_xxx --verifier ver_xxx -- npm test -- billing
```

Read-only helpers:

```bash
npm run dev -- adapter-list
npm run dev -- profile-list
npm run dev -- failure-modes-list ctr_xxx
npm run dev -- audit-weak-closeouts
```

After building, the installed binary is `contract`:

```bash
npm run build
contract version
```

The ledger is stored at `.contracts/ledger.sqlite` in the current working
directory. Generated artifacts and exports also live under `.contracts/`, which
is ignored by git by default.

## Package And Release

Package readiness checks:

```bash
npm run check
npm pack --dry-run
```

GitHub CI runs the same check and dry-run pack verification on pushes and pull
requests. npm publishing is gated through the GitHub Release workflow, which
uses npm trusted publishing and provenance. The workflow only publishes after an
explicit GitHub Release or a manual dispatch that confirms `publish-npm`; it
does not publish to GitHub Packages.

Operator handoff steps and expected `npm pack` contents are documented in
`docs/package-and-release.md`.

## Docs

- `docs/getting-started.md`: install options, first-use CLI flow, and what gets
  written to `.contracts/ledger.sqlite`.
- `docs/loops.md`: repeated improvement loop examples for route/Ralph work,
  coverage expansion, UX gaps, and Limner visual verification.
- `docs/package-and-release.md`: npm package contents, GitHub CI, trusted
  publishing, and release handoff.
- `examples/loop-conveyors.md`: copyable conveyor templates that map each loop
  to contracts, criteria, verifiers, failure modes, receipts, and closeout.

## Design

The current design lives in
`docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`.
