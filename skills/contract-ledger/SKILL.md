---
name: contract-ledger
description: Use when grounding agent work with @mean-weasel/contract-ledger: creating task contracts, acceptance criteria, todos, verifiers, failure modes, receipts, audit trails, closeout exports, or repeated improvement loops.
---

# Contract Ledger

Use Contract Ledger when work needs an explicit definition of done that an agent can audit later. It is best for small, bounded tasks: one bug, route, UX gap, coverage slice, package/release step, or loop iteration.

## Setup

Run commands from the repository or project directory being audited. The ledger lives at `.contracts/ledger.sqlite` in that directory.

Prefer an installed binary when available:

```bash
contract version
```

For one-off use:

```bash
npm exec --package @mean-weasel/contract-ledger -- contract version
```

When working inside the Contract Ledger source repo, use:

```bash
npm run dev -- version
```

## Workflow

1. Create a draft contract before implementation:

```bash
contract init "Fix billing settings regression" --intent "Canceled users cannot access premium export" --scope "Billing settings"
```

Capture the printed `ctr_...` id.

2. Add closeout criteria and todos. Criteria should be evidence-shaped, not vague preferences:

```bash
contract accept ctr_xxx
crit_id=$(contract criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command)
contract todo-add ctr_xxx "Verify premium export is hidden"
```

3. Add verifiers for proof that can be rerun. Use `--` before child commands:

```bash
ver_id=$(contract verifier-add-command ctr_xxx billing-tests -- npm test -- billing)
```

4. Add plausible failure modes early. These are the ways the work could look done while still being wrong:

```bash
contract failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
```

5. Record receipts as evidence is gathered. Prefer command receipts for reproducible checks:

```bash
contract receipt-run ctr_xxx --criterion "$crit_id" --verifier "$ver_id" -- npm test -- billing
```

Use manual receipts only for evidence that cannot be rerun, and include concrete paths, URLs, commands, screenshots, or residual risk:

```bash
contract receipt-add ctr_xxx --criterion "$crit_id" --summary "Reviewed browser smoke at /billing; export hidden for canceled user" --status pass
```

6. Resolve failure modes only after evidence addresses them:

```bash
contract failure-modes-list ctr_xxx
contract failure-modes-resolve fm_xxx --status ruled_out
```

7. Export and close:

```bash
contract export ctr_xxx
contract close ctr_xxx
```

If closeout is blocked, treat the printed problems as the remaining definition of done. Add proof, resolve failure modes, or explicitly defer with residual risk, then close again.

## Loop Pattern

For repeated loops such as route triage, coverage expansion, UX gaps, or Limner-style visual checks:

- Keep each contract atomic enough for one agent pass.
- Create the next contract when a receipt discovers a new issue; do not silently expand the current scope.
- Record command verifiers for tests/builds/smoke checks and manual receipts for artifacts that cannot be rerun.
- Export each closed contract so later agents start from recorded evidence.

## Closeout Discipline

Before claiming done:

- Every required criterion is satisfied, deferred, or rejected with evidence.
- Every required verifier has a passing receipt or an explicit residual risk.
- Every required failure mode is ruled out, accepted with residual risk, or split into a new contract.
- `contract close ctr_xxx` succeeds.
- The final response mentions the contract id, important receipts, and any residual risk.

Do not close a contract on confidence alone. The ledger is the source of truth.
