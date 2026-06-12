# Adapter Manifest References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend adapter records with registry-agnostic source links, documentation links, and optional skill references while keeping sub-agent guidance out of adapter manifests.

**Architecture:** The SQLite `verifier_adapters` table remains the source of truth for adapter descriptors. New columns store small, auditable references to external source/docs/skills, while detailed tool usage stays in docs, repos, packages, plugins, or skills outside the ledger. Existing ledgers migrate in place with default empty values.

**Tech Stack:** TypeScript, Node.js, `better-sqlite3`, Commander, Vitest, SQLite.

---

## Decisions Captured

- Adapters are proof-source descriptors, not mini knowledge bases.
- Adapter source metadata must be registry-agnostic; do not assume npm.
- Adapter records may link to docs, repos, homepages, registries, and optional skill references.
- Adapter records must not contain sub-agent routing guidance. Sub-agent decisions belong to contracts, verifiers, receipts, or planning workflows.
- Skill references are hints only; installed/used skill truth belongs in receipts or audit events.

## File Structure

- Modify `src/db/schema.ts`: add adapter reference columns to schema, seed data, and migration helper.
- Modify `src/db/connection.ts`: run the new migration helper when opening a ledger.
- Modify `src/verifiers/verifiers.ts`: extend adapter input/output types, JSON validation, persistence, list/get helpers, and audit payloads.
- Modify `src/cli.ts`: add CLI options for source/docs/skill reference fields on `adapter-add`.
- Modify `tests/db-audit.test.ts`: assert new columns and seeded Limner references.
- Modify `tests/cli-commands.test.ts`: assert CLI writes reference metadata and validates JSON skill refs.
- Modify `README.md` and `docs/getting-started.md`: document the lean adapter manifest model.
- Modify `docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`: bring the spec in line with this newer adapter-reference decision.

---

### Task 1: Add Adapter Reference Columns And Migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/connection.ts`
- Test: `tests/db-audit.test.ts`

- [ ] **Step 1: Write a failing schema test for adapter reference columns**

Add this test after `openLedger creates all V1 schema tables` in `tests/db-audit.test.ts`:

```ts
  it('verifier_adapters include registry-agnostic source and reference columns', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const columns = ledger.db
          .prepare('pragma table_info(verifier_adapters)')
          .all() as Array<{ name: string; notnull: number }>;
        const byName = new Map(columns.map((column) => [column.name, column]));

        for (const name of [
          'source_type',
          'source_name',
          'source_version',
          'source_url',
          'repo_url',
          'docs_url',
          'homepage_url',
          'registry_url',
          'skill_refs_json',
        ]) {
          expect(byName.get(name)?.notnull).toBe(1);
        }
      } finally {
        ledger.close();
      }
    });
  });
```

- [ ] **Step 2: Run the failing schema test**

Run:

```bash
npm test -- tests/db-audit.test.ts
```

Expected: FAIL because `verifier_adapters` does not yet include the new columns.

- [ ] **Step 3: Add columns to `SCHEMA_SQL`**

In `src/db/schema.ts`, update the `verifier_adapters` table definition:

```sql
create table if not exists verifier_adapters (
  id text primary key,
  name text not null unique,
  version text not null,
  kind text not null,
  status text not null,
  config_schema_json text not null,
  artifact_patterns_json text not null,
  receipt_mapper_json text not null,
  requires_judgment integer not null,
  source_type text not null default '',
  source_name text not null default '',
  source_version text not null default '',
  source_url text not null default '',
  repo_url text not null default '',
  docs_url text not null default '',
  homepage_url text not null default '',
  registry_url text not null default '',
  skill_refs_json text not null default '[]',
  created_at text not null,
  updated_at text not null
);
```

- [ ] **Step 4: Add an idempotent migration helper**

In `src/db/schema.ts`, add this function near `migrateContractScopedSchema`:

```ts
function addColumnIfMissing(db: Database.Database, tableName: string, columnSql: string): void {
  const columnName = columnSql.trim().split(/\s+/)[0];
  if (!tableHasColumn(db, tableName, columnName)) {
    db.prepare(`alter table ${tableName} add column ${columnSql}`).run();
  }
}

export function migrateAdapterManifestReferences(db: Database.Database): void {
  addColumnIfMissing(db, 'verifier_adapters', "source_type text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_name text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_version text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "source_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "repo_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "docs_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "homepage_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "registry_url text not null default ''");
  addColumnIfMissing(db, 'verifier_adapters', "skill_refs_json text not null default '[]'");
}
```

- [ ] **Step 5: Run the migration from `openLedger`**

In `src/db/connection.ts`, update imports and open flow:

```ts
import {
  migrateAdapterManifestReferences,
  migrateContractScopedSchema,
  SCHEMA_SQL,
  seedSql,
} from './schema.js';
```

```ts
  db.exec(SCHEMA_SQL);
  migrateContractScopedSchema(db);
  migrateAdapterManifestReferences(db);
  db.exec(seedSql(clock.now()));
```

- [ ] **Step 6: Run the schema test again**

Run:

```bash
npm test -- tests/db-audit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/connection.ts tests/db-audit.test.ts
git commit -m "feat: add adapter manifest reference columns"
```

---

### Task 2: Seed Built-In Adapter References

**Files:**
- Modify: `src/db/schema.ts`
- Test: `tests/db-audit.test.ts`

- [ ] **Step 1: Write a failing seed-data test**

Replace the adapter query in `seed data includes built-in adapters and acceptance profiles` with:

```ts
        const adapters = ledger.db
          .prepare(
            `
            select
              name,
              source_type,
              source_name,
              repo_url,
              docs_url,
              skill_refs_json
            from verifier_adapters
            order by name
          `,
          )
          .all() as Array<{
          name: string;
          source_type: string;
          source_name: string;
          repo_url: string;
          docs_url: string;
          skill_refs_json: string;
        }>;
```

Then add these assertions before the `finally`:

```ts
        const command = adapters.find((adapter) => adapter.name === 'command');
        const limner = adapters.find((adapter) => adapter.name === 'limner');

        expect(command).toMatchObject({
          source_type: 'builtin',
          source_name: '@mean-weasel/contract-ledger',
        });
        expect(limner).toMatchObject({
          source_type: 'manual',
          source_name: 'limner',
          repo_url: 'https://github.com/neonwatty/limner',
          docs_url: 'https://github.com/neonwatty/limner#readme',
        });
        expect(JSON.parse(limner?.skill_refs_json ?? '[]')).toEqual([]);
```

- [ ] **Step 2: Run the failing seed-data test**

Run:

```bash
npm test -- tests/db-audit.test.ts
```

Expected: FAIL because seeded adapters do not include source/docs values yet.

- [ ] **Step 3: Update `seedSql` insert columns and values**

In `src/db/schema.ts`, extend the seeded `insert or ignore into verifier_adapters` column list:

```sql
    requires_judgment,
    source_type,
    source_name,
    source_version,
    source_url,
    repo_url,
    docs_url,
    homepage_url,
    registry_url,
    skill_refs_json,
    created_at,
    updated_at
```

Set the command adapter values:

```sql
    0,
    'builtin',
    '@mean-weasel/contract-ledger',
    '1',
    '',
    'https://github.com/mean-weasel/contract-ledger',
    'https://github.com/mean-weasel/contract-ledger#readme',
    '',
    'https://www.npmjs.com/package/@mean-weasel/contract-ledger',
    '[]',
    '${now}',
    '${now}'
```

Set the Limner adapter values:

```sql
    1,
    'manual',
    'limner',
    '1',
    '',
    'https://github.com/neonwatty/limner',
    'https://github.com/neonwatty/limner#readme',
    '',
    '',
    '[]',
    '${now}',
    '${now}'
```

- [ ] **Step 4: Run the seed-data test again**

Run:

```bash
npm test -- tests/db-audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts tests/db-audit.test.ts
git commit -m "feat: seed adapter source references"
```

---

### Task 3: Extend Adapter Types And Persistence

**Files:**
- Modify: `src/verifiers/verifiers.ts`
- Test: `tests/cli-commands.test.ts`

- [ ] **Step 1: Write a failing CLI persistence assertion**

In `tests/cli-commands.test.ts`, extend the `adapter-add` argv in `registers adapters and creates adapter-backed verifiers through the CLI`:

```ts
          '--source-type',
          'github',
          '--source-name',
          'neonwatty/limner',
          '--source-version',
          'main',
          '--source-url',
          'https://github.com/neonwatty/limner',
          '--repo-url',
          'https://github.com/neonwatty/limner',
          '--docs-url',
          'https://github.com/neonwatty/limner#readme',
          '--homepage-url',
          'https://example.com/limner',
          '--registry-url',
          'https://github.com/neonwatty/limner/releases',
          '--skill-refs-json',
          '[{"kind":"codex-skill","name":"limner-contract-verifier","recommended":true,"url":"https://github.com/neonwatty/limner/tree/main/skills/limner-contract-verifier"}]',
```

Then update the adapter query:

```ts
          .prepare(
            `
            select
              name,
              kind,
              requires_judgment,
              source_type,
              source_name,
              source_version,
              source_url,
              repo_url,
              docs_url,
              homepage_url,
              registry_url,
              skill_refs_json
            from verifier_adapters
            where id = ?
          `,
          )
          .get(adapterId) as {
          name: string;
          kind: string;
          requires_judgment: number;
          source_type: string;
          source_name: string;
          source_version: string;
          source_url: string;
          repo_url: string;
          docs_url: string;
          homepage_url: string;
          registry_url: string;
          skill_refs_json: string;
        };
```

Update the adapter expectation:

```ts
        expect(adapter).toMatchObject({
          name: 'custom-limner',
          kind: 'visual_fidelity',
          requires_judgment: 1,
          source_type: 'github',
          source_name: 'neonwatty/limner',
          source_version: 'main',
          source_url: 'https://github.com/neonwatty/limner',
          repo_url: 'https://github.com/neonwatty/limner',
          docs_url: 'https://github.com/neonwatty/limner#readme',
          homepage_url: 'https://example.com/limner',
          registry_url: 'https://github.com/neonwatty/limner/releases',
        });
        expect(JSON.parse(adapter.skill_refs_json)).toEqual([
          {
            kind: 'codex-skill',
            name: 'limner-contract-verifier',
            recommended: true,
            url: 'https://github.com/neonwatty/limner/tree/main/skills/limner-contract-verifier',
          },
        ]);
```

- [ ] **Step 2: Run the failing CLI test**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: FAIL because the CLI options and persistence fields do not exist yet.

- [ ] **Step 3: Extend adapter TypeScript types**

In `src/verifiers/verifiers.ts`, add these fields to `AdapterRecord`:

```ts
  sourceType: string;
  sourceName: string;
  sourceVersion: string;
  sourceUrl: string;
  repoUrl: string;
  docsUrl: string;
  homepageUrl: string;
  registryUrl: string;
  skillRefs: unknown;
```

Add these optional fields to `RegisterAdapterInput`:

```ts
  sourceType?: string;
  sourceName?: string;
  sourceVersion?: string;
  sourceUrl?: string;
  repoUrl?: string;
  docsUrl?: string;
  homepageUrl?: string;
  registryUrl?: string;
  skillRefs?: unknown;
```

Add matching snake-case fields to `AdapterRow`:

```ts
  source_type: string;
  source_name: string;
  source_version: string;
  source_url: string;
  repo_url: string;
  docs_url: string;
  homepage_url: string;
  registry_url: string;
  skill_refs_json: string;
```

- [ ] **Step 4: Add JSON validation helpers for adapter metadata**

In `src/verifiers/verifiers.ts`, add helpers before `addVerifier`:

```ts
function isPlainJsonObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSerializable(value: unknown, fieldName: string, seen = new Set<object>()): void {
  if (value === null) {
    return;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (Number.isFinite(value)) {
        return;
      }
      break;
    case 'object':
      if (seen.has(value)) {
        break;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          assertJsonSerializable(item, fieldName, seen);
        }
        seen.delete(value);
        return;
      }

      if (isPlainJsonObject(value)) {
        for (const item of Object.values(value)) {
          assertJsonSerializable(item, fieldName, seen);
        }
        seen.delete(value);
        return;
      }
      break;
  }

  throw new Error(`${fieldName} must be JSON-serializable without lossy values`);
}

function stringifyJsonField(value: unknown, fieldName: string): string {
  assertJsonSerializable(value, fieldName);
  return JSON.stringify(value);
}

function stringifyJsonArrayField(value: unknown, fieldName: string): string {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return stringifyJsonField(value, fieldName);
}
```

- [ ] **Step 5: Map adapter rows to records**

Update `toAdapterRecord`:

```ts
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceVersion: row.source_version,
    sourceUrl: row.source_url,
    repoUrl: row.repo_url,
    docsUrl: row.docs_url,
    homepageUrl: row.homepage_url,
    registryUrl: row.registry_url,
    skillRefs: JSON.parse(row.skill_refs_json),
```

- [ ] **Step 6: Select the new fields in adapter queries**

In both `getAdapterByNameOrId` and `listAdapters`, add:

```sql
        source_type,
        source_name,
        source_version,
        source_url,
        repo_url,
        docs_url,
        homepage_url,
        registry_url,
        skill_refs_json
```

- [ ] **Step 7: Insert and update the new fields**

In `registerAdapter`, add columns:

```sql
          source_type,
          source_name,
          source_version,
          source_url,
          repo_url,
          docs_url,
          homepage_url,
          registry_url,
          skill_refs_json,
```

Add values:

```sql
          @sourceType,
          @sourceName,
          @sourceVersion,
          @sourceUrl,
          @repoUrl,
          @docsUrl,
          @homepageUrl,
          @registryUrl,
          @skillRefsJson,
```

Add conflict updates:

```sql
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        source_version = excluded.source_version,
        source_url = excluded.source_url,
        repo_url = excluded.repo_url,
        docs_url = excluded.docs_url,
        homepage_url = excluded.homepage_url,
        registry_url = excluded.registry_url,
        skill_refs_json = excluded.skill_refs_json,
```

Add run values:

```ts
      sourceType: input.sourceType ?? '',
      sourceName: input.sourceName ?? '',
      sourceVersion: input.sourceVersion ?? '',
      sourceUrl: input.sourceUrl ?? '',
      repoUrl: input.repoUrl ?? '',
      docsUrl: input.docsUrl ?? '',
      homepageUrl: input.homepageUrl ?? '',
      registryUrl: input.registryUrl ?? '',
      configSchemaJson: stringifyJsonField(input.configSchema ?? {}, 'configSchema'),
      artifactPatternsJson: stringifyJsonArrayField(input.artifactPatterns ?? [], 'artifactPatterns'),
      receiptMapperJson: stringifyJsonField(input.receiptMapper ?? {}, 'receiptMapper'),
      skillRefsJson: stringifyJsonArrayField(input.skillRefs ?? [], 'skillRefs'),
```

- [ ] **Step 8: Include reference metadata in audit payload**

Extend the `adapter_added` / `adapter_updated` payload:

```ts
      sourceType: adapter.sourceType,
      sourceName: adapter.sourceName,
      sourceVersion: adapter.sourceVersion,
      sourceUrl: adapter.sourceUrl,
      repoUrl: adapter.repoUrl,
      docsUrl: adapter.docsUrl,
      homepageUrl: adapter.homepageUrl,
      registryUrl: adapter.registryUrl,
      skillRefs: adapter.skillRefs,
```

- [ ] **Step 9: Run focused typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/verifiers/verifiers.ts tests/cli-commands.test.ts
git commit -m "feat: persist adapter source metadata"
```

---

### Task 4: Add CLI Options And JSON Validation

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-commands.test.ts`

- [ ] **Step 1: Add CLI options to `adapter-add`**

In `src/cli.ts`, add options after `--status`:

```ts
    .option('--source-type <type>', 'Adapter source type, such as builtin, npm, github, local, binary, docker, python, go, mcp, or manual', '')
    .option('--source-name <name>', 'Adapter source name, package name, binary name, repo name, or plugin name', '')
    .option('--source-version <version>', 'Adapter source version or version range', '')
    .option('--source-url <url>', 'Adapter source URL', '')
    .option('--repo-url <url>', 'Adapter repository URL', '')
    .option('--docs-url <url>', 'Adapter documentation URL', '')
    .option('--homepage-url <url>', 'Adapter homepage URL', '')
    .option('--registry-url <url>', 'Adapter registry or package listing URL', '')
    .option('--skill-refs-json <json>', 'Optional skill references JSON array', '[]')
```

- [ ] **Step 2: Extend option typing**

Update the adapter action options type:

```ts
          sourceType: string;
          sourceName: string;
          sourceVersion: string;
          sourceUrl: string;
          repoUrl: string;
          docsUrl: string;
          homepageUrl: string;
          registryUrl: string;
          skillRefsJson: string;
```

- [ ] **Step 3: Pass fields into `registerAdapter`**

Update the `registerAdapter` call:

```ts
                sourceType: options.sourceType,
                sourceName: options.sourceName,
                sourceVersion: options.sourceVersion,
                sourceUrl: options.sourceUrl,
                repoUrl: options.repoUrl,
                docsUrl: options.docsUrl,
                homepageUrl: options.homepageUrl,
                registryUrl: options.registryUrl,
                skillRefs: parseJsonOption(options.skillRefsJson, '--skill-refs-json'),
```

- [ ] **Step 4: Run the CLI adapter test**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add invalid skill refs JSON test**

Add a focused assertion near the adapter CLI test:

```ts
  it('rejects invalid adapter skill refs JSON', async () => {
    await withTempWorkspace(async (root) => {
      await expect(
        runCli({
          cwd: root,
          argv: [
            'adapter-add',
            'bad-skill-refs',
            '--kind',
            'manual',
            '--skill-refs-json',
            '{not-json',
          ],
        }),
      ).rejects.toThrow(/--skill-refs-json/);
    });
  });
```

- [ ] **Step 6: Run the invalid JSON test**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli-commands.test.ts
git commit -m "feat: expose adapter reference options"
```

---

### Task 5: Show Adapter References In Read APIs

**Files:**
- Modify: `src/contracts/views.ts`
- Test: `tests/cli-commands.test.ts`

- [ ] **Step 1: Write a failing `contract show` assertion**

In the adapter CLI test, after creating the adapter-backed verifier, run:

```ts
      await runCli({
        cwd: root,
        argv: ['show', contractId ?? 'missing'],
        stdout,
      });
      const shown = JSON.parse(stdout.at(-1) ?? '{}') as {
        verifiers: Array<{
          adapterName?: string;
          adapterSourceType?: string;
          adapterDocsUrl?: string;
          adapterSkillRefs?: unknown;
        }>;
      };
```

Add assertions:

```ts
        expect(shown.verifiers[0]).toMatchObject({
          adapterName: 'custom-limner',
          adapterSourceType: 'github',
          adapterDocsUrl: 'https://github.com/neonwatty/limner#readme',
        });
        expect(shown.verifiers[0]?.adapterSkillRefs).toEqual([
          {
            kind: 'codex-skill',
            name: 'limner-contract-verifier',
            recommended: true,
            url: 'https://github.com/neonwatty/limner/tree/main/skills/limner-contract-verifier',
          },
        ]);
```

- [ ] **Step 2: Run the failing read-model test**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: FAIL because `show` only joins adapter name today.

- [ ] **Step 3: Select adapter reference fields in `getContractSnapshot`**

In `src/contracts/views.ts`, extend the verifier query:

```sql
          verifier_adapters.source_type as adapterSourceType,
          verifier_adapters.docs_url as adapterDocsUrl,
          verifier_adapters.skill_refs_json as adapterSkillRefsJson,
```

Then map the parsed value:

```ts
    adapterSkillRefs: parseJson(verifier.adapterSkillRefsJson),
    adapterSkillRefsJson: undefined,
```

- [ ] **Step 4: Run the read-model test again**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/views.ts tests/cli-commands.test.ts
git commit -m "feat: expose adapter references in contract views"
```

---

### Task 6: Document The Lean Adapter Manifest Model

**Files:**
- Modify: `README.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`

- [ ] **Step 1: Update README adapter example**

Replace the current `adapter-add custom-limner` example with:

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
```

Add this paragraph after the example:

```md
Adapter references are intentionally lightweight. Store source and documentation
links in the ledger so agents can discover where the tool lives, but keep full
usage instructions in the linked docs, repository, package, plugin, or skill.
Sub-agent routing is not adapter metadata; record those decisions in contracts,
verifiers, and receipts.
```

- [ ] **Step 2: Mirror the example in getting-started docs**

Make the same adapter example and paragraph change in `docs/getting-started.md`.

- [ ] **Step 3: Update the design spec adapter fields**

In `docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`, add these fields to the adapter fields list:

```md
- `source_type`
- `source_name`
- `source_version`
- `source_url`
- `repo_url`
- `docs_url`
- `homepage_url`
- `registry_url`
- `skill_refs_json`
```

Add a short note:

```md
Skill references are optional pointers for agent-facing usage guidance. They do
not prove a skill was installed or used. Receipts and audit events should record
actual skill usage when it matters.
```

- [ ] **Step 4: Run doc-adjacent search**

Run:

```bash
rg -n "sub-agent|subagent|npm_package|skill_refs|source_type|docs_url|adapter-add custom-limner" README.md docs
```

Expected: results show no adapter-level sub-agent guidance and no npm-only adapter field names.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/getting-started.md docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md
git commit -m "docs: describe adapter reference metadata"
```

---

### Task 7: Full Verification And Release Readiness

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full check**

Run:

```bash
npm run check
```

Expected: typecheck, tests, and build all pass.

- [ ] **Step 2: Run package dry-run**

Run:

```bash
npm pack --dry-run
```

Expected: package still includes `dist`, `README.md`, `docs/*.md`, `examples`, and `skills`.

- [ ] **Step 3: Inspect adapter CLI help**

Run:

```bash
node dist/cli.js adapter-add --help
```

Expected: help includes source/docs/skill reference options and does not mention sub-agent guidance.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: diff is scoped to schema/types/CLI/read-model/tests/docs and has no whitespace errors.

- [ ] **Step 5: Final commit if needed**

If verification produces fixes:

```bash
git add .
git commit -m "test: verify adapter manifest references"
```

---

## Rollout Notes

- This is a package-visible schema and CLI change; release as a minor version while still pre-1.0.
- Existing ledgers get empty defaults for the new fields.
- Built-in Limner gets docs/repo references but remains a descriptor, not an executable adapter package.
- Future `adapter-install` and `verifier-run` work should reuse these fields rather than adding npm-specific columns.

## Self-Review

- **Spec coverage:** Covers generic source metadata, docs links, optional skill references, no npm assumption, and no adapter-level sub-agent guidance.
- **Placeholder scan:** No implementation step uses TBD/TODO/fill-in placeholders.
- **Type consistency:** Field names are camelCase in TypeScript records and snake_case in SQLite.
- **Scope check:** This plan intentionally does not implement executable adapter packages, adapter install, verifier-run, or receipt-level skill-usage proof.
