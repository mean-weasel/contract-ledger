# Getting Started

Contract Ledger is a local CLI for turning agent work into explicit contracts,
verifiers, receipts, and audit records. It stores each project's ledger at
`.contracts/ledger.sqlite` and writes generated exports under `.contracts/`.

## Install

Install the published npm package when you want the `contract` command available
on your machine:

```bash
npm install --global @mean-weasel/contract-ledger
contract version
```

Run it once without a global install:

```bash
npx @mean-weasel/contract-ledger version
npx @mean-weasel/contract-ledger init "Route checkout errors" --intent "Every failed checkout route has a reproduced error and a verified fix"
```

Use npm exec when you need the binary name exactly as installed by the package:

```bash
npm exec --package @mean-weasel/contract-ledger -- contract version
```

For repository development, install dependencies and use the source-backed CLI:

```bash
npm install
npm run build
npm run dev -- version
```

## First Contract

Run these commands from the project directory you want to audit. The first write
creates `.contracts/ledger.sqlite`; later commands reuse that file.

```bash
contract init "Fix billing settings regression" --intent "Canceled users cannot access premium export" --scope "Billing settings"
contract accept ctr_xxx
```

`contract init` prints a contract id such as `ctr_xxx`. Use that id in the
remaining commands. `contract accept` moves the contract out of draft state so
criteria, verifiers, receipts, and closeout gates can describe real work.

## Add Closeout Criteria

Criteria state the evidence required before the work can be closed.

```bash
crit_id=$(contract criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command)
contract criteria-set-status "$crit_id" --status satisfied
contract todo-add ctr_xxx "Verify premium export is hidden"
```

Use `--requires command` for test, build, lint, smoke, or script evidence. Leave
criteria pending until a receipt proves them, or mark them deferred/rejected with
a rationale and residual risk.

## Register And Run Verifiers

Command verifiers record the command that should be used as evidence. Put `--`
before the child command so its flags are not parsed as Contract Ledger flags.

```bash
ver_id=$(contract verifier-add-command ctr_xxx billing-tests -- npm test -- billing)
contract receipt-run ctr_xxx --criterion "$crit_id" --verifier "$ver_id" -- npm test -- billing
```

`receipt-run` executes the child command, captures its result, and writes a
receipt linked to the contract. If you have already inspected outside evidence,
record a manual receipt instead:

```bash
contract receipt-add ctr_xxx --criterion "$crit_id" --verifier "$ver_id" --summary "Reviewed test output and browser state" --status pass
```

## Disprove Known Failure Modes

Failure modes force the closeout to address plausible ways the work could look
done while still being wrong.

```bash
contract failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
contract failure-modes-list ctr_xxx
```

Resolve each required failure mode before closeout, or leave an explicit
accepted risk.

```bash
contract failure-modes-resolve fm_xxx --status ruled_out
```

## Export And Close

Export produces a Markdown view of the contract and recorded evidence. Closeout
only succeeds when required criteria, verifiers, receipts, and failure modes are
in an acceptable state.

```bash
contract export ctr_xxx
contract close ctr_xxx
```

If closeout is blocked, the CLI prints the missing proof. Add or fix receipts,
resolve failure modes, and run `contract close ctr_xxx` again.

## Agent Read Commands

Agents can inspect the ledger before deciding what to do next:

```bash
contract status
contract show ctr_xxx
contract next ctr_xxx
contract audit-log ctr_xxx
```

`contract show` returns the contract, criteria, todos, verifiers, failure modes,
receipts, and closeout problems as JSON. `contract next` returns the remaining
actions needed before closeout. `contract audit-log` returns event history with
command invocation linkage.

## Agent Skill

The npm package includes a Codex skill at `skills/contract-ledger/SKILL.md`.
Install it into the default Codex skills directory with:

```bash
contract skill-install
```

Use `--target-dir <path>` for a custom skill directory and `--overwrite` to
replace an existing installed copy.

## Adapter Hooks

Register custom verifier adapters when tools like Limner need structured
acceptance metadata without being hard-coded into the core CLI:

```bash
contract adapter-add custom-limner \
  --kind visual_fidelity \
  --source-type github \
  --source-name neonwatty/limner \
  --source-url https://github.com/neonwatty/limner \
  --repo-url https://github.com/neonwatty/limner \
  --docs-url https://github.com/neonwatty/limner#readme \
  --artifact-patterns-json '[".limner/runs/*/manifest.json"]' \
  --skill-refs-json '[{"kind":"codex-skill","name":"limner-contract-verifier","recommended":true,"url":"https://github.com/neonwatty/limner/tree/main/skills/limner-contract-verifier"}]' \
  --requires-judgment
contract verifier-add-adapter ctr_xxx custom-limner "Visual compare" --config-json '{"target":"checkout-mobile"}'
```

Adapter references are intentionally lightweight. Store source and documentation
links in the ledger so agents can discover where the tool lives, but keep full
usage instructions in the linked docs, repository, package, plugin, or skill.
Sub-agent routing is not adapter metadata; record those decisions in contracts,
verifiers, and receipts.

Adapter registration, adapter listing, and adapter-backed verifier creation are
audited in `.contracts/ledger.sqlite`.

## Package And GitHub Release Path

Contract Ledger is packaged as `@mean-weasel/contract-ledger` on npm. The npm
package exposes the `contract` binary, includes the compiled `dist/` files and
README, and is verified before release with:

```bash
npm run check
npm pack --dry-run
```

GitHub CI runs the same check and dry-run package verification on pushes and
pull requests. Publishing is handled by a gated GitHub Release workflow using
npm trusted publishing and provenance. It publishes to npm after an explicit
GitHub Release or manual `publish-npm` dispatch, and it does not publish to
GitHub Packages.

Maintainer handoff details, expected `npm pack` contents, and release stops are
documented in `docs/package-and-release.md`.
