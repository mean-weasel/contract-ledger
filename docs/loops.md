# Loop And Conveyor Examples

Contract Ledger is useful when agent work repeats over many small findings. A
loop is the repeated improvement cycle: find a gap, create a contract, verify
the fix, record a receipt, and close or reopen with evidence. A conveyor is the
operating pattern that keeps those loops uniform across agents and days.

Use these examples as documentation patterns, not as a formal acronym or a new
process name that needs separate approval.

## Route Loop With Ralph

Use a route loop when Ralph or another triage agent walks application routes and
turns every broken path into a bounded contract.

Contract:

- Title: `Ralph route loop: fix checkout error route`
- Intent: every checkout error route has a reproduced failure, a verified fix,
  and an exported closeout receipt.
- Scope: one route family, such as `/checkout/*`, so the contract stays small
  enough for one agent pass.

Criteria:

- The failing route is reproduced with the route, auth state, and input payload
  recorded.
- The fix is implemented and the route returns the expected status, redirect, or
  rendered state.
- Regression coverage exists for the route behavior.
- The final export names any route still deferred to a later contract.

Verifiers:

- A command verifier runs the targeted route or integration tests, for example
  `npm test -- checkout-routes`.
- A smoke verifier runs the local app and probes the route directly.
- A manual receipt can be used only for Ralph's triage note or screenshot, not
  as a replacement for the required command verifier.

Failure modes:

- The route works in the happy auth state but fails for expired sessions.
- The server returns success while the browser renders the old error.
- Ralph's route inventory skipped a nested route or locale-specific path.
- A broad test command passed without executing the targeted route case.

Receipts:

- `receipt-run` captures the targeted test command and links it to the route
  criterion.
- A manual receipt summarizes Ralph's reproduced route, payload, and screenshot
  or log path.
- If a smoke check finds a new related route, record a failing receipt and open
  the next contract instead of hiding it in the current closeout.

Closeout:

- Close only after every required criterion has a passing receipt and each
  failure mode is ruled out, accepted with residual risk, or split into a new
  route loop contract.
- Export the contract and attach the receipt summary to the pull request so the
  next Ralph pass can start from recorded evidence instead of rediscovery.

## Coverage Expansion Loop

Use a coverage loop when agents are repeatedly raising test coverage in a risky
area without turning the work into a vague "add more tests" task.

Contract:

- Title: `Expand coverage for invoice proration`
- Intent: the target module has meaningful branch and regression coverage for
  the named behavior.
- Scope: one module, component, or workflow that can be reviewed in one pass.

Criteria:

- The baseline coverage number or uncovered branch list is recorded before
  changes.
- New tests cover the named behavior and at least one previous miss.
- The existing check suite still passes.
- Remaining uncovered branches are listed as deferred, rejected, or assigned to
  the next contract.

Verifiers:

- A command verifier runs the focused test file.
- A command verifier runs the coverage report or the repository check script.
- A receipt records the before and after coverage evidence, including the report
  path or terminal summary.

Failure modes:

- Coverage rises through shallow assertions that do not verify behavior.
- A focused test passes while the full suite fails.
- Generated files or unreachable branches inflate the coverage denominator.
- The next agent cannot tell which uncovered branch remains.

Receipts:

- `receipt-run` captures the focused test result.
- `receipt-run` captures the full check or coverage command.
- A manual receipt summarizes the baseline, final coverage, and deferred branch
  decisions when the coverage tool output is too large for a concise closeout.

Closeout:

- Close only when coverage criteria have passing receipts and unresolved gaps are
  explicitly deferred with residual risk.
- Use the export as the seed for the next coverage loop, so the next contract
  starts with known misses instead of rescanning everything.

## UX Gap And Limner Visual Verification Loop

Use a UX gap loop when repeated visual or interaction findings need stronger
proof than "looks better." Limner-style verification can be the visual verifier
when a reference app, screenshot set, or perceptual diff target exists.

Contract:

- Title: `Resolve onboarding UX gap: mobile plan picker`
- Intent: the target screen matches the expected user flow and visual reference
  on mobile and desktop.
- Scope: one UX gap, screen, or interaction state.

Criteria:

- The UX gap is described with viewport, state, and user action.
- The interaction works with keyboard, pointer, and the required responsive
  viewport.
- Limner or an equivalent visual verifier compares the result to the accepted
  reference.
- Any intentional visual difference is recorded as an amendment or residual
  risk, not hidden in the receipt.

Verifiers:

- A command verifier runs the component or end-to-end test for the interaction.
- A Limner verifier, or a command wrapping the Limner-style visual comparison,
  captures the reference, candidate, diff score, and artifact paths.
- A browser smoke verifier records that text is readable and controls do not
  overlap at the target viewport.

Failure modes:

- Desktop passes while mobile text overlaps or a control is off screen.
- The visual diff passes because the reference is stale.
- The interaction is visually correct but inaccessible by keyboard.
- The receipt links a screenshot without recording viewport and state.

Receipts:

- `receipt-run` captures the interaction test.
- A Limner receipt records the visual comparison result and artifact paths.
- A manual receipt may summarize human UX review, but closeout still depends on
  the command or visual verifier receipts.

Closeout:

- Close after required receipts prove the interaction and visual criteria, and
  failure modes are ruled out or accepted with explicit residual risk.
- If the visual verifier exposes a new UX gap, record it as a failing receipt
  and create the next loop contract instead of expanding the current scope.
