# Loop Conveyor Templates

These examples are documentation templates for repeated agent improvement work.
Replace ids such as `ctr_xxx`, `crit_xxx`, and `ver_xxx` with the values printed
by the CLI.

## Route Loop / Ralph Conveyor

Run this conveyor when Ralph or another route scanner finds a broken route.

Contract:

```bash
contract init "Ralph route loop: fix checkout error route" --intent "Every failed checkout route has reproduced evidence, a verified fix, and a closeout receipt" --scope "/checkout/*"
contract accept ctr_xxx
```

Criteria:

```bash
route_repro=$(contract criteria-add ctr_xxx "Route failure is reproduced with path, auth state, and payload" --requires manual)
route_fixed=$(contract criteria-add ctr_xxx "Route returns the expected status, redirect, or rendered state" --requires command)
route_regression=$(contract criteria-add ctr_xxx "Regression coverage protects the route behavior" --requires command)
```

Verifiers:

```bash
route_tests=$(contract verifier-add-command ctr_xxx checkout-route-tests -- npm test -- checkout-routes)
route_smoke=$(contract verifier-add-command ctr_xxx checkout-route-smoke -- npm run smoke -- /checkout/error)
```

Failure mode checks:

```bash
route_auth_fm=$(contract failure-modes-add ctr_xxx "Route only works for the happy auth state" --why "Ralph may reproduce with a single session" --check "Smoke expired and anonymous sessions")
route_browser_fm=$(contract failure-modes-add ctr_xxx "Browser still renders the old error" --why "Server status can pass while client state is stale" --check "Capture a browser smoke receipt")
```

Receipts:

```bash
contract receipt-add ctr_xxx --criterion "$route_repro" --summary "Ralph reproduced /checkout/error with expired session and payload fixture checkout-expired.json" --status pass
contract receipt-run ctr_xxx --criterion "$route_fixed" --verifier "$route_smoke" -- npm run smoke -- /checkout/error
contract receipt-run ctr_xxx --criterion "$route_regression" --verifier "$route_tests" -- npm test -- checkout-routes
```

Closeout:

```bash
contract failure-modes-resolve "$route_auth_fm" --status ruled_out
contract failure-modes-resolve "$route_browser_fm" --status ruled_out
contract export ctr_xxx
contract close ctr_xxx
```

Close only when every required failure mode has been ruled out, accepted with
residual risk, or split into the next route loop contract.

## Coverage Expansion Conveyor

Run this conveyor when the next agent needs a repeatable coverage improvement
loop instead of a vague "add tests" instruction.

Contract:

```bash
contract init "Expand coverage for invoice proration" --intent "Invoice proration has meaningful branch and regression coverage" --scope "billing/proration"
contract accept ctr_xxx
```

Criteria:

```bash
baseline=$(contract criteria-add ctr_xxx "Baseline coverage and uncovered branches are recorded" --requires manual)
focused=$(contract criteria-add ctr_xxx "New tests cover the named proration behavior" --requires command)
full_check=$(contract criteria-add ctr_xxx "Full check suite passes after coverage changes" --requires command)
```

Verifiers:

```bash
focused_tests=$(contract verifier-add-command ctr_xxx proration-focused-tests -- npm test -- proration)
coverage_report=$(contract verifier-add-command ctr_xxx coverage-report -- npm run coverage -- billing/proration)
repo_check=$(contract verifier-add-command ctr_xxx repo-check -- npm run check)
```

Failure mode checks:

```bash
shallow_assertion_fm=$(contract failure-modes-add ctr_xxx "Coverage rises through shallow assertions" --why "Line coverage can pass without behavior proof" --check "Review assertions against the intent")
full_suite_fm=$(contract failure-modes-add ctr_xxx "Focused tests pass while the repository check fails" --why "Coverage work can break unrelated contracts" --check "Run npm run check")
```

Receipts:

```bash
contract receipt-run ctr_xxx --criterion "$focused" --verifier "$focused_tests" -- npm test -- proration
contract receipt-run ctr_xxx --criterion "$full_check" --verifier "$repo_check" -- npm run check
contract receipt-add ctr_xxx --criterion "$baseline" --verifier "$coverage_report" --summary "Coverage moved from 72% to 84%; tax-exempt branch deferred to ctr_next" --status pass
```

Closeout:

```bash
contract failure-modes-resolve "$shallow_assertion_fm" --status ruled_out
contract failure-modes-resolve "$full_suite_fm" --status ruled_out
contract export ctr_xxx
contract close ctr_xxx
```

Use the exported receipt as the seed for the next coverage contract when a
branch is intentionally deferred.

## UX Gap / Limner Conveyor

Run this conveyor when an agent is closing a visual or interaction UX gap and
needs Limner-style verification evidence.

Contract:

```bash
contract init "Resolve onboarding UX gap: mobile plan picker" --intent "Plan picker is usable and visually matches the accepted reference" --scope "onboarding plan picker"
contract accept ctr_xxx
```

Criteria:

```bash
ux_state=$(contract criteria-add ctr_xxx "UX gap is recorded with viewport, state, and user action" --requires manual)
interaction=$(contract criteria-add ctr_xxx "Plan picker works by keyboard and pointer" --requires command)
visual=$(contract criteria-add ctr_xxx "Limner visual comparison passes against the accepted reference" --requires command)
```

Verifiers:

```bash
interaction_test=$(contract verifier-add-command ctr_xxx plan-picker-interaction -- npm test -- plan-picker)
limner_visual=$(contract verifier-add-command ctr_xxx limner-plan-picker -- npm run limner -- onboarding-plan-picker)
browser_smoke=$(contract verifier-add-command ctr_xxx mobile-browser-smoke -- npm run smoke -- onboarding-plan-picker --viewport mobile)
```

Failure mode checks:

```bash
mobile_overlap_fm=$(contract failure-modes-add ctr_xxx "Desktop passes while mobile controls overlap" --why "The UX gap was reported on a constrained viewport" --check "Run mobile browser smoke")
stale_reference_fm=$(contract failure-modes-add ctr_xxx "Limner reference is stale" --why "A stale reference can make a bad candidate pass" --check "Record reference version in the receipt")
keyboard_access_fm=$(contract failure-modes-add ctr_xxx "Visual state passes but keyboard access fails" --why "Visual proof does not prove interaction accessibility" --check "Run interaction tests")
```

Receipts:

```bash
contract receipt-add ctr_xxx --criterion "$ux_state" --summary "Gap recorded for 390x844 viewport after choosing Team plan" --status pass
contract receipt-run ctr_xxx --criterion "$interaction" --verifier "$interaction_test" -- npm test -- plan-picker
contract receipt-run ctr_xxx --criterion "$visual" --verifier "$limner_visual" -- npm run limner -- onboarding-plan-picker
contract receipt-run ctr_xxx --criterion "$visual" --verifier "$browser_smoke" -- npm run smoke -- onboarding-plan-picker --viewport mobile
```

Closeout:

```bash
contract failure-modes-resolve "$mobile_overlap_fm" --status ruled_out
contract failure-modes-resolve "$stale_reference_fm" --status ruled_out
contract failure-modes-resolve "$keyboard_access_fm" --status ruled_out
contract export ctr_xxx
contract close ctr_xxx
```

If Limner or the browser smoke verifier finds another UX issue, record the
failing receipt and open the next contract instead of widening this one.
