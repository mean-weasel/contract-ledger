# Package and Loop Docs

## Objective

Prepare Contract Ledger for npm/GitHub package consumption and document how the ledger supports repeated agent improvement loops, including a route/Ralph-loop style example.

## Original Request

"Make a plan using Goalbuddy prep boards... for getting this into GitHub packaging and using NPM... including examples like this one for a route loop. That should go in the documentation, landing page, probably, etc."

## Intake Summary

- Input shape: `specific`
- Audience: maintainers and early users of Contract Ledger
- Authority: `requested`
- Proof type: `artifact`
- Completion proof: a final Judge/PM receipt maps implemented package/release readiness and docs examples back to this charter, with `npm run check`, `npm pack --dry-run`, and docs/landing-page review evidence passing.
- Goal oracle: package readiness plus documentation evidence: npm/GitHub publish path is encoded in repo files, install/use docs are clear, and loop examples show how to use the audit ledger for repeated coverage/UX/route improvement loops.
- Likely misfire: polishing generic package/docs text while failing to create a publishable npm package or failing to explain why the ledger helps iterative agent loops.
- Blind spots considered: npm provenance/trusted publishing credentials, package scope ownership, GitHub Packages versus npmjs, landing page location, examples becoming marketing copy rather than executable ledger workflows.
- Existing plan facts: package metadata, CI, release workflow, npm trusted publishing/provenance, README/docs/landing examples, and loop examples such as route/Ralph loops should be included.

## Goal Oracle

The oracle for this goal is:

`npm run check` passes, `npm pack --dry-run` shows the intended publish payload, release/packaging docs or workflow are present, and documentation includes concrete Contract Ledger loop examples for npm usage, route/Ralph-loop work, test coverage expansion, UX gaps, and Limner-style visual verification.

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Complete the first publish-and-explain tranche: discover package/docs surfaces, implement the largest safe packaging slice, implement the documentation/landing-page examples, verify package contents and tests, and audit whether the repo is ready for an npm/GitHub packaging handoff.

## Non-Negotiable Constraints

- Preserve the existing TypeScript CLI behavior and audit integrity.
- Do not publish to npm or GitHub Packages without explicit operator approval and credentials.
- Prefer npmjs as the primary public install path; treat GitHub Packages as optional unless the operator chooses it.
- Use npm trusted publishing/provenance where feasible instead of long-lived npm tokens.
- Documentation must describe the ledger as an evidence spine, not as an omniscient judge.
- Loop examples must include at least one route/Ralph-loop style conveyor and at least one UX/Limner-style verification example.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker package when docs, packaging, or examples still need safe local follow-up work.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice. Worker tasks should produce publish readiness, user-facing docs, or executable examples rather than isolated wording changes unless those changes are the verified slice.

## Canonical Board

Machine truth lives at:

`docs/goals/package-and-loop-docs/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/package-and-loop-docs/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Work only on the active board task.
5. Assign Scout, Judge, Worker, or PM according to the task.
6. Write a compact task receipt.
7. Update the board.
8. If safe local work remains, choose the next largest reversible Worker package and continue unless blocked.
9. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
