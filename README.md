# Contract Ledger

SQLite-backed local CLI contracts for grounding agent work in explicit
definitions of done, verifiers, receipts, failure modes, and audit logs.

## Install

```bash
npm install
npm run build
```

## Local Usage

During development, run the CLI with `npm run dev --`:

```bash
npm run dev -- init "Fix billing settings regression" --intent "Canceled users cannot access premium export" --scope "Billing settings"
npm run dev -- accept ctr_xxx
npm run dev -- criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command
npm run dev -- todo-add ctr_xxx "Verify premium export is hidden"
npm run dev -- verifier-add-command ctr_xxx billing-tests npm test -- billing
npm run dev -- failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
npm run dev -- receipt-add ctr_xxx --summary "Reviewed command output and browser state" --status pass
npm run dev -- receipt-run ctr_xxx node -e "console.log('proof')"
npm run dev -- export ctr_xxx
npm run dev -- close ctr_xxx
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

## Design

The current design lives in
`docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`.
