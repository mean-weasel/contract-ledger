# Contract Ledger V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working TypeScript CLI for a SQLite-backed local contract ledger with contracts, criteria, verifiers, adapters, failure modes, receipts, artifacts, closeout gates, exports, and audit logs.

**Architecture:** Implement a Node 22 TypeScript CLI named `contract` with a small domain/service layer over SQLite. SQLite is the source of truth; all CLI invocations write `command_invocations`, state changes write `events`, and generated Markdown is an export view only.

**Tech Stack:** TypeScript, Node.js 22, npm, Commander, better-sqlite3, Zod, Vitest, built-in `node:crypto`, `node:fs/promises`, and `node:child_process`.

---

## Repository

- GitHub: `https://github.com/mean-weasel/contract-ledger`
- Local path: `/Users/neonwatty/Desktop/contract-experiment`
- Spec: `/Users/neonwatty/Desktop/contract-experiment/docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`
- Plan: `/Users/neonwatty/Desktop/contract-experiment/docs/superpowers/plans/2026-06-11-contract-ledger-v1.md`

## File Structure

- Create `package.json`: package metadata, CLI bin, npm scripts.
- Create `tsconfig.json`: strict TypeScript config for Node ESM output.
- Create `vitest.config.ts`: test config with Node environment.
- Create `src/cli.ts`: Commander command tree and top-level invocation auditing.
- Create `src/index.ts`: public exports for tests and future consumers.
- Create `src/core/ids.ts`: prefixed IDs using `crypto.randomUUID()`.
- Create `src/core/time.ts`: injectable clock helper.
- Create `src/core/redact.ts`: redact secret-like CLI arguments before audit storage.
- Create `src/core/fs.ts`: workspace path helpers and artifact hashing.
- Create `src/db/connection.ts`: open SQLite ledger and apply schema.
- Create `src/db/schema.ts`: SQL schema and seed data for built-in adapters/profiles.
- Create `src/audit/audit.ts`: command invocation and event writing helpers.
- Create `src/contracts/contracts.ts`: contract and closeout state operations.
- Create `src/criteria/criteria.ts`: criterion operations.
- Create `src/todos/todos.ts`: todo operations.
- Create `src/verifiers/verifiers.ts`: verifier, adapter, and profile operations.
- Create `src/failure-modes/failure-modes.ts`: falsification queue operations.
- Create `src/receipts/receipts.ts`: manual receipts, command receipts, artifact attachment.
- Create `src/exports/markdown.ts`: Markdown contract and receipt exports.
- Create `src/audits/reports.ts`: weak closeout, adapter usage, command usage audit reports.
- Create `tests/helpers/temp-workspace.ts`: isolated temp workspace helper.
- Create focused tests under `tests/**/*.test.ts` matching each domain module.

## Task 1: Bootstrap TypeScript CLI Project

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/package.json`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tsconfig.json`
- Create: `/Users/neonwatty/Desktop/contract-experiment/vitest.config.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/cli.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/cli-smoke.test.ts`

- [ ] **Step 1: Add package metadata and scripts**

Write `/Users/neonwatty/Desktop/contract-experiment/package.json`:

```json
{
  "name": "@mean-weasel/contract-ledger",
  "version": "0.1.0",
  "description": "SQLite-backed local CLI contract ledger for agent completion receipts.",
  "type": "module",
  "bin": {
    "contract": "./dist/cli.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "npm run typecheck && npm test && npm run build",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "commander": "^13.1.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and npm exits with code `0`.

- [ ] **Step 3: Add TypeScript and Vitest config**

Write `/Users/neonwatty/Desktop/contract-experiment/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add a failing CLI smoke test**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/cli-smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  it('registers the contract CLI name', () => {
    const program = createProgram();
    expect(program.name()).toBe('contract');
  });
});
```

- [ ] **Step 5: Run the smoke test and verify it fails**

Run:

```bash
npm test -- tests/cli-smoke.test.ts
```

Expected: FAIL because `../src/cli.js` does not exist yet.

- [ ] **Step 6: Add minimal CLI entrypoint**

Write `/Users/neonwatty/Desktop/contract-experiment/src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('contract')
    .description('SQLite-backed local contract ledger')
    .version('0.1.0');

  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      program.outputHelp();
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`:

```ts
export { createProgram } from './cli.js';
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
npm test -- tests/cli-smoke.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 8: Commit bootstrap**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src tests
git commit -m "feat: bootstrap typescript cli"
```

Expected: commit succeeds.

## Task 2: SQLite Schema, Workspace, IDs, and Audit Foundation

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/core/ids.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/core/time.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/core/redact.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/core/fs.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/db/schema.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/db/connection.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/audit/audit.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/db-audit.test.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`

- [ ] **Step 1: Write failing DB/audit tests**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/db-audit.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openLedger } from '../src/db/connection.js';
import { createCommandInvocation, completeCommandInvocation, recordEvent, withAuditContext } from '../src/audit/audit.js';
import { redactArgv } from '../src/core/redact.js';

describe('ledger schema and audit', () => {
  it('creates the ledger tables and seed adapter records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const tables = ledger.db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toContain('contracts');
      expect(tables.map((row) => row.name)).toContain('command_invocations');
      expect(tables.map((row) => row.name)).toContain('events');
      expect(tables.map((row) => row.name)).toContain('verifier_adapters');
      const limner = ledger.db.prepare('select name from verifier_adapters where name = ?').get('limner');
      expect(limner).toBeTruthy();
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('records command invocations and links events to them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const invocation = createCommandInvocation(ledger, {
        actor: 'test-agent',
        command: 'contract',
        subcommand: 'status',
        argv: ['contract', 'status', '--token', 'secret-value'],
        cwd: root,
        scopeType: 'contract',
        scopeId: 'ctr_demo',
        contractId: 'ctr_demo',
      });
      await withAuditContext(invocation.id, async () => {
        recordEvent(ledger, {
          contractId: 'ctr_demo',
          scopeType: 'contract',
          scopeId: 'ctr_demo',
          actor: 'test-agent',
          eventType: 'cli_invoked',
          payload: { subcommand: 'status' },
        });
      });
      completeCommandInvocation(ledger, invocation.id, { exitCode: 0, status: 'ok' });

      const stored = ledger.db.prepare('select argv_json, status from command_invocations where id = ?').get(invocation.id) as { argv_json: string; status: string };
      expect(stored.status).toBe('ok');
      expect(stored.argv_json).toContain('[REDACTED]');
      expect(stored.argv_json).not.toContain('secret-value');
      const eventCount = ledger.db.prepare('select count(*) as count from events where command_invocation_id = ?').get(invocation.id) as { count: number };
      expect(eventCount.count).toBe(1);
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('redacts secret-like argv values', () => {
    expect(redactArgv(['--api-key', 'abc123', '--name', 'demo'])).toEqual(['--api-key', '[REDACTED]', '--name', 'demo']);
    expect(redactArgv(['--token=abc123', '--url=http://localhost'])).toEqual(['--token=[REDACTED]', '--url=http://localhost']);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/db-audit.test.ts
```

Expected: FAIL because the DB and audit modules do not exist.

- [ ] **Step 3: Implement core helpers**

Write `/Users/neonwatty/Desktop/contract-experiment/src/core/ids.ts`:

```ts
import { randomUUID } from 'node:crypto';

export type IdPrefix =
  | 'ctr'
  | 'goal'
  | 'crit'
  | 'todo'
  | 'ver'
  | 'adp'
  | 'prof'
  | 'fm'
  | 'rec'
  | 'art'
  | 'evt'
  | 'cmd'
  | 'amd';

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/core/time.ts`:

```ts
export type Clock = {
  now(): string;
};

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/core/redact.ts`:

```ts
const SECRET_KEYS = [
  'api-key',
  'apikey',
  'auth',
  'authorization',
  'cookie',
  'password',
  'secret',
  'storage-state',
  'token',
];

export function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of argv) {
    const lower = arg.toLowerCase();
    if (redactNext) {
      redacted.push('[REDACTED]');
      redactNext = false;
      continue;
    }

    const inlineSecret = SECRET_KEYS.find((key) => lower.startsWith(`--${key}=`));
    if (inlineSecret) {
      redacted.push(`--${inlineSecret}=[REDACTED]`);
      continue;
    }

    const separateSecret = SECRET_KEYS.some((key) => lower === `--${key}`);
    if (separateSecret) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }

    redacted.push(arg);
  }

  return redacted;
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/core/fs.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type WorkspacePaths = {
  root: string;
  contractsDir: string;
  ledgerPath: string;
  artifactsDir: string;
  exportsDir: string;
};

export function getWorkspacePaths(cwd: string): WorkspacePaths {
  const root = path.resolve(cwd);
  const contractsDir = path.join(root, '.contracts');
  return {
    root,
    contractsDir,
    ledgerPath: path.join(contractsDir, 'ledger.sqlite'),
    artifactsDir: path.join(contractsDir, 'artifacts'),
    exportsDir: path.join(contractsDir, 'exports'),
  };
}

export async function ensureWorkspace(paths: WorkspacePaths): Promise<void> {
  await mkdir(paths.contractsDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  await mkdir(paths.exportsDir, { recursive: true });
}

export async function fileMetadata(filePath: string): Promise<{ sizeBytes: number; sha256: string }> {
  const [buffer, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sizeBytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
```

- [ ] **Step 4: Implement schema and connection**

Write `/Users/neonwatty/Desktop/contract-experiment/src/db/schema.ts` with the schema in the spec. Include all V1 tables:

```ts
export const SCHEMA_SQL = `
pragma foreign_keys = on;

create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);

create table if not exists goals (
  id text primary key,
  title text not null,
  intent text not null default '',
  status text not null,
  created_by text not null,
  created_at text not null,
  closed_at text
);

create table if not exists contracts (
  id text primary key,
  goal_id text references goals(id),
  title text not null,
  intent text not null default '',
  scope text not null default '',
  non_goals text not null default '',
  assumptions text not null default '',
  status text not null,
  repo_path text not null,
  branch text not null default '',
  created_by text not null,
  created_at text not null,
  accepted_at text,
  started_at text,
  closed_at text
);

create table if not exists amendments (
  id text primary key,
  contract_id text not null references contracts(id),
  reason text not null,
  changed_fields_json text not null,
  created_by text not null,
  created_at text not null
);

create table if not exists criteria (
  id text primary key,
  contract_id text not null references contracts(id),
  statement text not null,
  required_evidence_kind text not null,
  priority integer not null default 0,
  status text not null,
  rationale text,
  residual_risk text,
  created_at text not null,
  satisfied_at text
);

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
  created_at text not null,
  updated_at text not null
);

create table if not exists acceptance_profiles (
  id text primary key,
  adapter_id text not null references verifier_adapters(id),
  name text not null unique,
  description text not null,
  status text not null,
  default_config_json text not null,
  default_required_artifacts_json text not null,
  default_failure_modes_json text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists verifiers (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text references criteria(id),
  adapter_id text references verifier_adapters(id),
  name text not null,
  kind text not null,
  config_json text not null,
  required integer not null,
  created_at text not null
);

create table if not exists todos (
  id text primary key,
  contract_id text not null references contracts(id),
  title text not null,
  description text not null default '',
  status text not null,
  linked_criterion_id text references criteria(id),
  claimed_by text,
  created_at text not null,
  completed_at text
);

create table if not exists failure_modes (
  id text primary key,
  contract_id text not null references contracts(id),
  failure_mode text not null,
  why_plausible text not null,
  linked_criterion_id text references criteria(id),
  check_description text not null,
  expected_verifier_id text references verifiers(id),
  expected_proof_json text not null,
  resolution_rule text not null,
  status text not null,
  required integer not null,
  fewer_than_default_reason text,
  residual_risk text,
  created_at text not null,
  resolved_at text
);

create table if not exists receipts (
  id text primary key,
  contract_id text not null references contracts(id),
  criterion_id text references criteria(id),
  verifier_id text references verifiers(id),
  todo_id text references todos(id),
  disproof_attempt_id text references failure_modes(id),
  kind text not null,
  status text not null,
  summary text not null,
  command text,
  exit_code integer,
  stdout_excerpt text,
  stderr_excerpt text,
  adapter_metadata_json text,
  content_hash text,
  created_by text not null,
  created_at text not null
);

create table if not exists artifacts (
  id text primary key,
  contract_id text not null references contracts(id),
  path text not null,
  mime_type text not null default '',
  size_bytes integer not null,
  sha256 text not null,
  created_at text not null
);

create table if not exists receipt_artifacts (
  receipt_id text not null references receipts(id),
  artifact_id text not null references artifacts(id),
  primary key (receipt_id, artifact_id)
);

create table if not exists command_invocations (
  id text primary key,
  actor text not null,
  session_id text,
  contract_id text,
  scope_type text not null,
  scope_id text,
  command text not null,
  subcommand text,
  argv_json text not null,
  cwd text not null,
  started_at text not null,
  completed_at text,
  exit_code integer,
  status text not null
);

create table if not exists events (
  id text primary key,
  command_invocation_id text references command_invocations(id),
  contract_id text,
  scope_type text not null,
  scope_id text,
  actor text not null,
  event_type text not null,
  payload_json text not null,
  created_at text not null
);
`;

export function seedSql(now: string): string {
  return `
insert or ignore into verifier_adapters
  (id, name, version, kind, status, config_schema_json, artifact_patterns_json, receipt_mapper_json, requires_judgment, created_at, updated_at)
values
  ('adp_command_builtin', 'command', '1', 'command', 'active', '{}', '[]', '{}', 0, '${now}', '${now}'),
  ('adp_limner_builtin', 'limner', '1', 'visual_fidelity', 'active', '{"target":"string","mode":"string"}', '["**/side-by-side.png","**/dom-metrics.json","**/reports/*.md",".limner/runs/*/manifest.json",".limner/runs/*/events.jsonl"]', '{"requiresJudgment":true}', 1, '${now}', '${now}');

insert or ignore into acceptance_profiles
  (id, adapter_id, name, description, status, default_config_json, default_required_artifacts_json, default_failure_modes_json, created_at, updated_at)
values
  ('prof_limner_visual_fidelity', 'adp_limner_builtin', 'limner-visual-fidelity', 'Visual fidelity proof using Limner artifacts and agent judgment.', 'active', '{}', '["side-by-side","dom-metrics","report"]', '["Reference matches but app diverges","Desktop matches but mobile breaks","Generated side-by-side exists but mismatches were not inspected"]', '${now}', '${now}');
`;
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/db/connection.ts`:

```ts
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

import { getWorkspacePaths } from '../core/fs.js';
import { systemClock, type Clock } from '../core/time.js';
import { SCHEMA_SQL, seedSql } from './schema.js';

export type Ledger = {
  db: Database.Database;
  cwd: string;
  ledgerPath: string;
  close(): void;
};

export function openLedger(input: { cwd: string; clock?: Clock }): Ledger {
  const clock = input.clock ?? systemClock;
  const paths = getWorkspacePaths(input.cwd);
  mkdirSync(paths.contractsDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });
  mkdirSync(paths.exportsDir, { recursive: true });
  const db = new Database(paths.ledgerPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.exec(seedSql(clock.now()));
  return {
    db,
    cwd: input.cwd,
    ledgerPath: paths.ledgerPath,
    close: () => db.close(),
  };
}
```

- [ ] **Step 5: Implement audit helpers**

Write `/Users/neonwatty/Desktop/contract-experiment/src/audit/audit.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Ledger } from '../db/connection.js';
import { createId } from '../core/ids.js';
import { redactArgv } from '../core/redact.js';
import { systemClock } from '../core/time.js';

const auditContext = new AsyncLocalStorage<{ commandInvocationId: string }>();

export type CommandInvocationInput = {
  actor: string;
  sessionId?: string;
  contractId?: string;
  scopeType: string;
  scopeId?: string;
  command: string;
  subcommand?: string;
  argv: string[];
  cwd: string;
};

export function createCommandInvocation(ledger: Ledger, input: CommandInvocationInput): { id: string } {
  const id = createId('cmd');
  ledger.db.prepare(`
    insert into command_invocations
      (id, actor, session_id, contract_id, scope_type, scope_id, command, subcommand, argv_json, cwd, started_at, status)
    values
      (@id, @actor, @sessionId, @contractId, @scopeType, @scopeId, @command, @subcommand, @argvJson, @cwd, @startedAt, 'running')
  `).run({
    id,
    actor: input.actor,
    sessionId: input.sessionId ?? null,
    contractId: input.contractId ?? null,
    scopeType: input.scopeType,
    scopeId: input.scopeId ?? null,
    command: input.command,
    subcommand: input.subcommand ?? null,
    argvJson: JSON.stringify(redactArgv(input.argv)),
    cwd: input.cwd,
    startedAt: systemClock.now(),
  });
  return { id };
}

export function completeCommandInvocation(
  ledger: Ledger,
  id: string,
  input: { exitCode: number; status: 'ok' | 'failed' },
): void {
  ledger.db.prepare(`
    update command_invocations
    set completed_at = @completedAt, exit_code = @exitCode, status = @status
    where id = @id
  `).run({ id, completedAt: systemClock.now(), exitCode: input.exitCode, status: input.status });
}

export async function withAuditContext<T>(commandInvocationId: string, fn: () => T | Promise<T>): Promise<T> {
  return auditContext.run({ commandInvocationId }, fn);
}

export function recordEvent(
  ledger: Ledger,
  input: {
    commandInvocationId?: string;
    contractId?: string;
    scopeType: string;
    scopeId?: string;
    actor: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): { id: string } {
  const id = createId('evt');
  ledger.db.prepare(`
    insert into events
      (id, command_invocation_id, contract_id, scope_type, scope_id, actor, event_type, payload_json, created_at)
    values
      (@id, @commandInvocationId, @contractId, @scopeType, @scopeId, @actor, @eventType, @payloadJson, @createdAt)
  `).run({
    id,
    commandInvocationId: input.commandInvocationId ?? auditContext.getStore()?.commandInvocationId ?? null,
    contractId: input.contractId ?? null,
    scopeType: input.scopeType,
    scopeId: input.scopeId ?? null,
    actor: input.actor,
    eventType: input.eventType,
    payloadJson: JSON.stringify(input.payload),
    createdAt: systemClock.now(),
  });
  return { id };
}
```

Update `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`:

```ts
export { createProgram } from './cli.js';
export { openLedger } from './db/connection.js';
export { createCommandInvocation, completeCommandInvocation, recordEvent, withAuditContext } from './audit/audit.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/db-audit.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit schema and audit foundation**

Run:

```bash
git add src tests package.json package-lock.json
git commit -m "feat: add sqlite schema and audit foundation"
```

Expected: commit succeeds.

## Task 3: Contracts, Criteria, Todos, Verifiers, Adapters, and Profiles

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/contracts/contracts.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/criteria/criteria.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/todos/todos.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/verifiers/verifiers.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/contract-workflow.test.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`

- [ ] **Step 1: Write failing workflow tests**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/contract-workflow.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openLedger } from '../src/db/connection.js';
import { createContract, acceptContract, getContract } from '../src/contracts/contracts.js';
import { addCriterion } from '../src/criteria/criteria.js';
import { addTodo } from '../src/todos/todos.js';
import { addVerifier, listAdapters, listProfiles } from '../src/verifiers/verifiers.js';

describe('contract workflow', () => {
  it('creates and accepts a contract with criteria, todos, and verifiers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, {
        title: 'Fix billing settings regression',
        intent: 'Canceled users cannot access premium export.',
        scope: 'Billing settings only.',
        createdBy: 'test-agent',
      });
      const criterion = addCriterion(ledger, {
        contractId: contract.id,
        statement: 'Canceled users cannot access premium export',
        requiredEvidenceKind: 'command',
        priority: 1,
        actor: 'test-agent',
      });
      const todo = addTodo(ledger, {
        contractId: contract.id,
        title: 'Add regression test',
        description: 'Cover canceled subscription export state.',
        linkedCriterionId: criterion.id,
        actor: 'test-agent',
      });
      const verifier = addVerifier(ledger, {
        contractId: contract.id,
        criterionId: criterion.id,
        name: 'billing-unit-tests',
        kind: 'command',
        config: { command: 'npm test -- billing' },
        required: true,
        actor: 'test-agent',
      });
      acceptContract(ledger, { contractId: contract.id, actor: 'test-agent' });

      expect(getContract(ledger, contract.id)?.status).toBe('accepted');
      expect(todo.status).toBe('pending');
      expect(verifier.name).toBe('billing-unit-tests');
      const events = ledger.db.prepare('select event_type from events order by created_at').all() as Array<{ event_type: string }>;
      expect(events.map((event) => event.event_type)).toContain('contract_created');
      expect(events.map((event) => event.event_type)).toContain('criterion_added');
      expect(events.map((event) => event.event_type)).toContain('todo_added');
      expect(events.map((event) => event.event_type)).toContain('verifier_added');
      expect(events.map((event) => event.event_type)).toContain('contract_accepted');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('lists built-in adapters and profiles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      expect(listAdapters(ledger).map((adapter) => adapter.name)).toContain('limner');
      expect(listProfiles(ledger).map((profile) => profile.name)).toContain('limner-visual-fidelity');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/contract-workflow.test.ts
```

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement contract operations**

Write `/Users/neonwatty/Desktop/contract-experiment/src/contracts/contracts.ts`:

```ts
import path from 'node:path';

import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type ContractRecord = {
  id: string;
  title: string;
  intent: string;
  scope: string;
  status: string;
};

export function createContract(
  ledger: Ledger,
  input: { title: string; intent?: string; scope?: string; nonGoals?: string; assumptions?: string; createdBy: string },
): ContractRecord {
  const id = createId('ctr');
  const now = systemClock.now();
  ledger.db.prepare(`
    insert into contracts
      (id, title, intent, scope, non_goals, assumptions, status, repo_path, branch, created_by, created_at)
    values
      (@id, @title, @intent, @scope, @nonGoals, @assumptions, 'draft', @repoPath, '', @createdBy, @createdAt)
  `).run({
    id,
    title: input.title,
    intent: input.intent ?? '',
    scope: input.scope ?? '',
    nonGoals: input.nonGoals ?? '',
    assumptions: input.assumptions ?? '',
    repoPath: path.resolve(ledger.cwd),
    createdBy: input.createdBy,
    createdAt: now,
  });
  recordEvent(ledger, {
    contractId: id,
    scopeType: 'contract',
    scopeId: id,
    actor: input.createdBy,
    eventType: 'contract_created',
    payload: { title: input.title },
  });
  return { id, title: input.title, intent: input.intent ?? '', scope: input.scope ?? '', status: 'draft' };
}

export function acceptContract(ledger: Ledger, input: { contractId: string; actor: string }): void {
  ledger.db.prepare("update contracts set status = 'accepted', accepted_at = @acceptedAt where id = @id").run({
    id: input.contractId,
    acceptedAt: systemClock.now(),
  });
  recordEvent(ledger, {
    contractId: input.contractId,
    scopeType: 'contract',
    scopeId: input.contractId,
    actor: input.actor,
    eventType: 'contract_accepted',
    payload: {},
  });
}

export function getContract(ledger: Ledger, contractId: string): ContractRecord | undefined {
  return ledger.db.prepare('select id, title, intent, scope, status from contracts where id = ?').get(contractId) as ContractRecord | undefined;
}
```

- [ ] **Step 4: Implement criteria, todos, and verifiers**

Write `/Users/neonwatty/Desktop/contract-experiment/src/criteria/criteria.ts`, `/Users/neonwatty/Desktop/contract-experiment/src/todos/todos.ts`, and `/Users/neonwatty/Desktop/contract-experiment/src/verifiers/verifiers.ts` using the same pattern:

```ts
// src/criteria/criteria.ts
import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export function addCriterion(
  ledger: Ledger,
  input: { contractId: string; statement: string; requiredEvidenceKind: string; priority?: number; actor: string },
): { id: string; status: string } {
  const id = createId('crit');
  ledger.db.prepare(`
    insert into criteria
      (id, contract_id, statement, required_evidence_kind, priority, status, created_at)
    values
      (@id, @contractId, @statement, @requiredEvidenceKind, @priority, 'pending', @createdAt)
  `).run({ id, contractId: input.contractId, statement: input.statement, requiredEvidenceKind: input.requiredEvidenceKind, priority: input.priority ?? 0, createdAt: systemClock.now() });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'criterion', scopeId: id, actor: input.actor, eventType: 'criterion_added', payload: { statement: input.statement } });
  return { id, status: 'pending' };
}
```

```ts
// src/todos/todos.ts
import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export function addTodo(
  ledger: Ledger,
  input: { contractId: string; title: string; description?: string; linkedCriterionId?: string; actor: string },
): { id: string; status: string } {
  const id = createId('todo');
  ledger.db.prepare(`
    insert into todos
      (id, contract_id, title, description, status, linked_criterion_id, created_at)
    values
      (@id, @contractId, @title, @description, 'pending', @linkedCriterionId, @createdAt)
  `).run({ id, contractId: input.contractId, title: input.title, description: input.description ?? '', linkedCriterionId: input.linkedCriterionId ?? null, createdAt: systemClock.now() });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'todo', scopeId: id, actor: input.actor, eventType: 'todo_added', payload: { title: input.title } });
  return { id, status: 'pending' };
}
```

```ts
// src/verifiers/verifiers.ts
import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type AdapterRecord = { id: string; name: string; kind: string; status: string };
export type ProfileRecord = { id: string; name: string; description: string; status: string };

export function addVerifier(
  ledger: Ledger,
  input: { contractId: string; criterionId?: string; adapterId?: string; name: string; kind: string; config: Record<string, unknown>; required: boolean; actor: string },
): { id: string; name: string } {
  const id = createId('ver');
  ledger.db.prepare(`
    insert into verifiers
      (id, contract_id, criterion_id, adapter_id, name, kind, config_json, required, created_at)
    values
      (@id, @contractId, @criterionId, @adapterId, @name, @kind, @configJson, @required, @createdAt)
  `).run({
    id,
    contractId: input.contractId,
    criterionId: input.criterionId ?? null,
    adapterId: input.adapterId ?? null,
    name: input.name,
    kind: input.kind,
    configJson: JSON.stringify(input.config),
    required: input.required ? 1 : 0,
    createdAt: systemClock.now(),
  });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'verifier', scopeId: id, actor: input.actor, eventType: 'verifier_added', payload: { name: input.name, kind: input.kind } });
  return { id, name: input.name };
}

export function listAdapters(ledger: Ledger): AdapterRecord[] {
  return ledger.db.prepare('select id, name, kind, status from verifier_adapters order by name').all() as AdapterRecord[];
}

export function listProfiles(ledger: Ledger): ProfileRecord[] {
  return ledger.db.prepare('select id, name, description, status from acceptance_profiles order by name').all() as ProfileRecord[];
}
```

- [ ] **Step 5: Export domain functions**

Update `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`:

```ts
export { createProgram } from './cli.js';
export { openLedger } from './db/connection.js';
export { createCommandInvocation, completeCommandInvocation, recordEvent, withAuditContext } from './audit/audit.js';
export { createContract, acceptContract, getContract } from './contracts/contracts.js';
export { addCriterion } from './criteria/criteria.js';
export { addTodo } from './todos/todos.js';
export { addVerifier, listAdapters, listProfiles } from './verifiers/verifiers.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/contract-workflow.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit contract workflow**

Run:

```bash
git add src tests
git commit -m "feat: add contract workflow records"
```

Expected: commit succeeds.

## Task 4: Failure Modes as Falsification Queue

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/failure-modes/failure-modes.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/failure-modes.test.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`

- [ ] **Step 1: Write failing failure-mode tests**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/failure-modes.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createContract } from '../src/contracts/contracts.js';
import { openLedger } from '../src/db/connection.js';
import { addFailureMode, listFailureModes, resolveFailureMode } from '../src/failure-modes/failure-modes.js';

describe('failure modes', () => {
  it('records and resolves a structured falsification queue item', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, { title: 'Visual QA', createdBy: 'test-agent' });
      const failureMode = addFailureMode(ledger, {
        contractId: contract.id,
        failureMode: 'Desktop layout matches but mobile breakpoint is broken',
        whyPlausible: 'The implementation changed responsive grid behavior.',
        checkDescription: 'Run mobile visual-fidelity verifier and inspect report.',
        expectedProof: { artifacts_required: ['side-by-side', 'dom-metrics', 'report'] },
        resolutionRule: 'Attach passing receipt or record residual risk.',
        required: true,
        actor: 'test-agent',
      });
      resolveFailureMode(ledger, { id: failureMode.id, status: 'ruled_out', residualRisk: '', actor: 'test-agent' });

      const items = listFailureModes(ledger, contract.id);
      expect(items).toHaveLength(1);
      expect(items[0]?.status).toBe('ruled_out');
      const eventTypes = ledger.db.prepare('select event_type from events').all() as Array<{ event_type: string }>;
      expect(eventTypes.map((event) => event.event_type)).toContain('failure_mode_added');
      expect(eventTypes.map((event) => event.event_type)).toContain('failure_mode_status_changed');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- tests/failure-modes.test.ts
```

Expected: FAIL because the failure-mode module does not exist.

- [ ] **Step 3: Implement failure-mode operations**

Write `/Users/neonwatty/Desktop/contract-experiment/src/failure-modes/failure-modes.ts`:

```ts
import { recordEvent } from '../audit/audit.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type FailureModeRecord = {
  id: string;
  failure_mode: string;
  why_plausible: string;
  status: string;
  required: number;
};

export function addFailureMode(
  ledger: Ledger,
  input: {
    contractId: string;
    failureMode: string;
    whyPlausible: string;
    linkedCriterionId?: string;
    checkDescription: string;
    expectedVerifierId?: string;
    expectedProof: Record<string, unknown>;
    resolutionRule: string;
    required: boolean;
    fewerThanDefaultReason?: string;
    actor: string;
  },
): { id: string } {
  const id = createId('fm');
  ledger.db.prepare(`
    insert into failure_modes
      (id, contract_id, failure_mode, why_plausible, linked_criterion_id, check_description, expected_verifier_id, expected_proof_json, resolution_rule, status, required, fewer_than_default_reason, created_at)
    values
      (@id, @contractId, @failureMode, @whyPlausible, @linkedCriterionId, @checkDescription, @expectedVerifierId, @expectedProofJson, @resolutionRule, 'pending', @required, @fewerThanDefaultReason, @createdAt)
  `).run({
    id,
    contractId: input.contractId,
    failureMode: input.failureMode,
    whyPlausible: input.whyPlausible,
    linkedCriterionId: input.linkedCriterionId ?? null,
    checkDescription: input.checkDescription,
    expectedVerifierId: input.expectedVerifierId ?? null,
    expectedProofJson: JSON.stringify(input.expectedProof),
    resolutionRule: input.resolutionRule,
    required: input.required ? 1 : 0,
    fewerThanDefaultReason: input.fewerThanDefaultReason ?? null,
    createdAt: systemClock.now(),
  });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'failure_mode', scopeId: id, actor: input.actor, eventType: 'failure_mode_added', payload: { failureMode: input.failureMode } });
  return { id };
}

export function resolveFailureMode(
  ledger: Ledger,
  input: { id: string; status: 'ruled_out' | 'confirmed' | 'inconclusive' | 'accepted_risk'; residualRisk?: string; actor: string },
): void {
  const row = ledger.db.prepare('select contract_id from failure_modes where id = ?').get(input.id) as { contract_id: string } | undefined;
  if (!row) throw new Error(`Failure mode not found: ${input.id}`);
  ledger.db.prepare('update failure_modes set status = @status, residual_risk = @residualRisk, resolved_at = @resolvedAt where id = @id').run({
    id: input.id,
    status: input.status,
    residualRisk: input.residualRisk ?? null,
    resolvedAt: systemClock.now(),
  });
  recordEvent(ledger, { contractId: row.contract_id, scopeType: 'failure_mode', scopeId: input.id, actor: input.actor, eventType: 'failure_mode_status_changed', payload: { status: input.status, residualRisk: input.residualRisk ?? '' } });
}

export function listFailureModes(ledger: Ledger, contractId: string): FailureModeRecord[] {
  return ledger.db.prepare('select id, failure_mode, why_plausible, status, required from failure_modes where contract_id = ? order by created_at').all(contractId) as FailureModeRecord[];
}
```

- [ ] **Step 4: Export failure-mode operations**

Update `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`:

```ts
export { createProgram } from './cli.js';
export { openLedger } from './db/connection.js';
export { createCommandInvocation, completeCommandInvocation, recordEvent, withAuditContext } from './audit/audit.js';
export { createContract, acceptContract, getContract } from './contracts/contracts.js';
export { addCriterion } from './criteria/criteria.js';
export { addTodo } from './todos/todos.js';
export { addVerifier, listAdapters, listProfiles } from './verifiers/verifiers.js';
export { addFailureMode, listFailureModes, resolveFailureMode } from './failure-modes/failure-modes.js';
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- tests/failure-modes.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit falsification queue**

Run:

```bash
git add src tests
git commit -m "feat: add failure mode queue"
```

Expected: commit succeeds.

## Task 5: Receipts, Command Verifiers, and Artifact Attachment

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/receipts/receipts.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/receipts.test.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`

- [ ] **Step 1: Write failing receipt tests**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/receipts.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createContract } from '../src/contracts/contracts.js';
import { openLedger } from '../src/db/connection.js';
import { addReceipt, attachArtifact, runCommandReceipt } from '../src/receipts/receipts.js';

describe('receipts', () => {
  it('records manual receipts and hashed artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const artifactPath = path.join(root, 'proof.txt');
      await writeFile(artifactPath, 'evidence\n');
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, { title: 'Receipt demo', createdBy: 'test-agent' });
      const receipt = addReceipt(ledger, {
        contractId: contract.id,
        kind: 'manual',
        status: 'pass',
        summary: 'Inspected proof artifact.',
        createdBy: 'test-agent',
      });
      const artifact = await attachArtifact(ledger, { contractId: contract.id, receiptId: receipt.id, filePath: artifactPath });
      expect(artifact.sha256).toHaveLength(64);
      const linked = ledger.db.prepare('select count(*) as count from receipt_artifacts where receipt_id = ?').get(receipt.id) as { count: number };
      expect(linked.count).toBe(1);
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('runs command receipts and captures output excerpts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, { title: 'Command demo', createdBy: 'test-agent' });
      const receipt = await runCommandReceipt(ledger, {
        contractId: contract.id,
        command: process.execPath,
        args: ['-e', 'console.log("ok receipt")'],
        createdBy: 'test-agent',
      });
      expect(receipt.status).toBe('pass');
      expect(receipt.stdoutExcerpt).toContain('ok receipt');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/receipts.test.ts
```

Expected: FAIL because receipt functions do not exist.

- [ ] **Step 3: Implement receipts and artifact hashing**

Write `/Users/neonwatty/Desktop/contract-experiment/src/receipts/receipts.ts`:

```ts
import { spawn } from 'node:child_process';
import path from 'node:path';

import { recordEvent } from '../audit/audit.js';
import { fileMetadata } from '../core/fs.js';
import { createId } from '../core/ids.js';
import { systemClock } from '../core/time.js';
import type { Ledger } from '../db/connection.js';

export type ReceiptStatus = 'pass' | 'fail' | 'inconclusive';

export function addReceipt(
  ledger: Ledger,
  input: {
    contractId: string;
    criterionId?: string;
    verifierId?: string;
    todoId?: string;
    failureModeId?: string;
    kind: string;
    status: ReceiptStatus;
    summary: string;
    command?: string;
    exitCode?: number;
    stdoutExcerpt?: string;
    stderrExcerpt?: string;
    adapterMetadata?: Record<string, unknown>;
    createdBy: string;
  },
): { id: string; status: ReceiptStatus; stdoutExcerpt?: string } {
  const id = createId('rec');
  ledger.db.prepare(`
    insert into receipts
      (id, contract_id, criterion_id, verifier_id, todo_id, disproof_attempt_id, kind, status, summary, command, exit_code, stdout_excerpt, stderr_excerpt, adapter_metadata_json, created_by, created_at)
    values
      (@id, @contractId, @criterionId, @verifierId, @todoId, @failureModeId, @kind, @status, @summary, @command, @exitCode, @stdoutExcerpt, @stderrExcerpt, @adapterMetadataJson, @createdBy, @createdAt)
  `).run({
    id,
    contractId: input.contractId,
    criterionId: input.criterionId ?? null,
    verifierId: input.verifierId ?? null,
    todoId: input.todoId ?? null,
    failureModeId: input.failureModeId ?? null,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    command: input.command ?? null,
    exitCode: input.exitCode ?? null,
    stdoutExcerpt: input.stdoutExcerpt ?? null,
    stderrExcerpt: input.stderrExcerpt ?? null,
    adapterMetadataJson: input.adapterMetadata ? JSON.stringify(input.adapterMetadata) : null,
    createdBy: input.createdBy,
    createdAt: systemClock.now(),
  });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'receipt', scopeId: id, actor: input.createdBy, eventType: 'receipt_created', payload: { status: input.status, kind: input.kind } });
  return { id, status: input.status, stdoutExcerpt: input.stdoutExcerpt };
}

export async function attachArtifact(
  ledger: Ledger,
  input: { contractId: string; receiptId: string; filePath: string; mimeType?: string },
): Promise<{ id: string; sha256: string }> {
  const id = createId('art');
  const metadata = await fileMetadata(input.filePath);
  ledger.db.prepare(`
    insert into artifacts
      (id, contract_id, path, mime_type, size_bytes, sha256, created_at)
    values
      (@id, @contractId, @path, @mimeType, @sizeBytes, @sha256, @createdAt)
  `).run({
    id,
    contractId: input.contractId,
    path: path.resolve(input.filePath),
    mimeType: input.mimeType ?? '',
    sizeBytes: metadata.sizeBytes,
    sha256: metadata.sha256,
    createdAt: systemClock.now(),
  });
  ledger.db.prepare('insert into receipt_artifacts (receipt_id, artifact_id) values (?, ?)').run(input.receiptId, id);
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'artifact', scopeId: id, actor: 'system', eventType: 'artifact_attached', payload: { receiptId: input.receiptId, path: path.resolve(input.filePath), sha256: metadata.sha256 } });
  return { id, sha256: metadata.sha256 };
}

export async function runCommandReceipt(
  ledger: Ledger,
  input: { contractId: string; verifierId?: string; failureModeId?: string; command: string; args: string[]; createdBy: string },
): Promise<{ id: string; status: ReceiptStatus; stdoutExcerpt: string; stderrExcerpt: string }> {
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'verifier', scopeId: input.verifierId, actor: input.createdBy, eventType: 'verifier_run_started', payload: { command: input.command, args: input.args } });
  const result = await runProcess(input.command, input.args, ledger.cwd);
  const status: ReceiptStatus = result.exitCode === 0 ? 'pass' : 'fail';
  const receipt = addReceipt(ledger, {
    contractId: input.contractId,
    verifierId: input.verifierId,
    failureModeId: input.failureModeId,
    kind: 'command',
    status,
    summary: `Command exited with ${result.exitCode}`,
    command: [input.command, ...input.args].join(' '),
    exitCode: result.exitCode,
    stdoutExcerpt: excerpt(result.stdout),
    stderrExcerpt: excerpt(result.stderr),
    createdBy: input.createdBy,
  });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'verifier', scopeId: input.verifierId, actor: input.createdBy, eventType: status === 'pass' ? 'verifier_run_completed' : 'verifier_run_failed', payload: { receiptId: receipt.id, exitCode: result.exitCode } });
  return { id: receipt.id, status, stdoutExcerpt: excerpt(result.stdout), stderrExcerpt: excerpt(result.stderr) };
}

function runProcess(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: error.message }));
  });
}

function excerpt(value: string): string {
  return value.slice(0, 4000);
}
```

- [ ] **Step 4: Export receipt operations**

Update `/Users/neonwatty/Desktop/contract-experiment/src/index.ts` to add:

```ts
export { addReceipt, attachArtifact, runCommandReceipt } from './receipts/receipts.js';
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- tests/receipts.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit receipts**

Run:

```bash
git add src tests
git commit -m "feat: add receipts and artifact evidence"
```

Expected: commit succeeds.

## Task 6: Closeout Gates, Markdown Exports, and Audit Reports

**Files:**
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/exports/markdown.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/src/audits/reports.ts`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/closeout-export-audit.test.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/contracts/contracts.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/index.ts`

- [ ] **Step 1: Write failing closeout/export/audit tests**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/closeout-export-audit.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { closeContract, createContract } from '../src/contracts/contracts.js';
import { addCriterion } from '../src/criteria/criteria.js';
import { openLedger } from '../src/db/connection.js';
import { addFailureMode, resolveFailureMode } from '../src/failure-modes/failure-modes.js';
import { addReceipt } from '../src/receipts/receipts.js';
import { exportContractMarkdown } from '../src/exports/markdown.js';
import { weakCloseoutReport } from '../src/audits/reports.js';

describe('closeout, export, and audit reports', () => {
  it('blocks closeout without receipt evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, { title: 'Closeout demo', createdBy: 'test-agent' });
      addCriterion(ledger, { contractId: contract.id, statement: 'Tests pass', requiredEvidenceKind: 'command', actor: 'test-agent' });
      const result = closeContract(ledger, { contractId: contract.id, actor: 'test-agent' });
      expect(result.ok).toBe(false);
      expect(result.problems.join('\n')).toContain('pending criteria');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('closes when criteria and required failure modes are resolved', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const ledger = openLedger({ cwd: root });
      const contract = createContract(ledger, { title: 'Closeout demo', createdBy: 'test-agent' });
      const criterion = addCriterion(ledger, { contractId: contract.id, statement: 'Tests pass', requiredEvidenceKind: 'command', actor: 'test-agent' });
      addReceipt(ledger, { contractId: contract.id, criterionId: criterion.id, kind: 'command', status: 'pass', summary: 'Tests passed.', createdBy: 'test-agent' });
      ledger.db.prepare("update criteria set status = 'satisfied', satisfied_at = datetime('now') where id = ?").run(criterion.id);
      const fm = addFailureMode(ledger, { contractId: contract.id, failureMode: 'Tests pass but browser fails', whyPlausible: 'No browser proof was present.', checkDescription: 'Run smoke check.', expectedProof: {}, resolutionRule: 'Receipt or residual risk.', required: true, fewerThanDefaultReason: 'Trivial test fixture contract.', actor: 'test-agent' });
      resolveFailureMode(ledger, { id: fm.id, status: 'ruled_out', actor: 'test-agent' });
      const result = closeContract(ledger, { contractId: contract.id, actor: 'test-agent' });
      expect(result.ok).toBe(true);
      expect(exportContractMarkdown(ledger, contract.id)).toContain('Closeout demo');
      expect(weakCloseoutReport(ledger)).toContain('Weak Closeout Report');
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/closeout-export-audit.test.ts
```

Expected: FAIL because closeout/export/audit functions do not exist.

- [ ] **Step 3: Implement closeout gates**

Modify `/Users/neonwatty/Desktop/contract-experiment/src/contracts/contracts.ts` to add:

```ts
export function closeContract(ledger: Ledger, input: { contractId: string; actor: string }): { ok: boolean; problems: string[] } {
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'contract', scopeId: input.contractId, actor: input.actor, eventType: 'closeout_attempted', payload: {} });
  const problems: string[] = [];
  const pendingCriteria = ledger.db.prepare("select count(*) as count from criteria where contract_id = ? and status not in ('satisfied', 'deferred', 'rejected')").get(input.contractId) as { count: number };
  if (pendingCriteria.count > 0) problems.push(`${pendingCriteria.count} pending criteria`);
  const satisfiedWithoutReceipts = ledger.db.prepare(`
    select count(*) as count
    from criteria c
    where c.contract_id = ?
      and c.status = 'satisfied'
      and not exists (
        select 1 from receipts r
        where r.criterion_id = c.id and r.status = 'pass'
      )
  `).get(input.contractId) as { count: number };
  if (satisfiedWithoutReceipts.count > 0) problems.push(`${satisfiedWithoutReceipts.count} satisfied criteria lack passing receipts`);
  const unresolvedFailureModes = ledger.db.prepare("select count(*) as count from failure_modes where contract_id = ? and required = 1 and status = 'pending'").get(input.contractId) as { count: number };
  if (unresolvedFailureModes.count > 0) problems.push(`${unresolvedFailureModes.count} required failure modes unresolved`);

  if (problems.length > 0) return { ok: false, problems };

  ledger.db.prepare("update contracts set status = 'closed', closed_at = @closedAt where id = @id").run({ id: input.contractId, closedAt: systemClock.now() });
  recordEvent(ledger, { contractId: input.contractId, scopeType: 'contract', scopeId: input.contractId, actor: input.actor, eventType: 'contract_closed', payload: {} });
  return { ok: true, problems: [] };
}
```

- [ ] **Step 4: Implement Markdown export and weak-closeout report**

Write `/Users/neonwatty/Desktop/contract-experiment/src/exports/markdown.ts`:

```ts
import type { Ledger } from '../db/connection.js';

export function exportContractMarkdown(ledger: Ledger, contractId: string): string {
  const contract = ledger.db.prepare('select id, title, intent, scope, status from contracts where id = ?').get(contractId) as { id: string; title: string; intent: string; scope: string; status: string };
  const criteria = ledger.db.prepare('select statement, status from criteria where contract_id = ? order by priority desc, created_at').all(contractId) as Array<{ statement: string; status: string }>;
  const receipts = ledger.db.prepare('select id, status, summary from receipts where contract_id = ? order by created_at').all(contractId) as Array<{ id: string; status: string; summary: string }>;
  const failureModes = ledger.db.prepare('select failure_mode, status, residual_risk from failure_modes where contract_id = ? order by created_at').all(contractId) as Array<{ failure_mode: string; status: string; residual_risk: string | null }>;
  return [
    `# ${contract.title}`,
    '',
    `Contract: \`${contract.id}\``,
    `Status: \`${contract.status}\``,
    '',
    '## Intent',
    '',
    contract.intent || '-',
    '',
    '## Criteria',
    '',
    ...criteria.map((criterion) => `- [${criterion.status}] ${criterion.statement}`),
    '',
    '## Receipts',
    '',
    ...receipts.map((receipt) => `- \`${receipt.id}\` ${receipt.status}: ${receipt.summary}`),
    '',
    '## Failure Modes',
    '',
    ...failureModes.map((failureMode) => `- ${failureMode.status}: ${failureMode.failure_mode}${failureMode.residual_risk ? ` (risk: ${failureMode.residual_risk})` : ''}`),
    '',
  ].join('\n');
}
```

Write `/Users/neonwatty/Desktop/contract-experiment/src/audits/reports.ts`:

```ts
import type { Ledger } from '../db/connection.js';

export function weakCloseoutReport(ledger: Ledger): string {
  const closedWithoutReceipts = ledger.db.prepare(`
    select c.id, c.title
    from contracts c
    where c.status = 'closed'
      and exists (
        select 1 from criteria cr
        where cr.contract_id = c.id
          and cr.status = 'satisfied'
          and not exists (
            select 1 from receipts r where r.criterion_id = cr.id and r.status = 'pass'
          )
      )
    order by c.closed_at desc
  `).all() as Array<{ id: string; title: string }>;
  return [
    '# Weak Closeout Report',
    '',
    '## Closed Contracts With Missing Receipt Evidence',
    '',
    ...closedWithoutReceipts.map((contract) => `- \`${contract.id}\` ${contract.title}`),
    closedWithoutReceipts.length === 0 ? '- None' : '',
    '',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 5: Export closeout/export/audit functions**

Update `/Users/neonwatty/Desktop/contract-experiment/src/index.ts` to add:

```ts
export { closeContract } from './contracts/contracts.js';
export { exportContractMarkdown } from './exports/markdown.js';
export { weakCloseoutReport } from './audits/reports.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/closeout-export-audit.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit closeout and reports**

Run:

```bash
git add src tests
git commit -m "feat: add closeout gates and reports"
```

Expected: commit succeeds.

## Task 7: Wire V1 CLI Commands and Documentation

**Files:**
- Modify: `/Users/neonwatty/Desktop/contract-experiment/src/cli.ts`
- Modify: `/Users/neonwatty/Desktop/contract-experiment/README.md`
- Create: `/Users/neonwatty/Desktop/contract-experiment/tests/cli-commands.test.ts`

- [ ] **Step 1: Write failing CLI command test**

Write `/Users/neonwatty/Desktop/contract-experiment/tests/cli-commands.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';
import { openLedger } from '../src/db/connection.js';

describe('CLI commands', () => {
  it('creates a contract and records command invocation audit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));
    try {
      const output: string[] = [];
      const program = createProgram({ cwd: root, actor: 'test-agent', stdout: (line) => output.push(line) });
      await program.parseAsync(['node', 'contract', 'init', 'CLI demo', '--intent', 'Prove CLI wiring works']);
      expect(output.join('\n')).toContain('ctr_');
      const ledger = openLedger({ cwd: root });
      const commandCount = ledger.db.prepare('select count(*) as count from command_invocations').get() as { count: number };
      expect(commandCount.count).toBeGreaterThan(0);
      ledger.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- tests/cli-commands.test.ts
```

Expected: FAIL because `createProgram` does not accept injected CLI dependencies and commands are not wired.

- [ ] **Step 3: Wire minimal V1 CLI commands with audit wrapper**

Replace `/Users/neonwatty/Desktop/contract-experiment/src/cli.ts` with:

```ts
#!/usr/bin/env node
import { Command } from 'commander';

import { createCommandInvocation, completeCommandInvocation, recordEvent, withAuditContext } from './audit/audit.js';
import { createContract, acceptContract, closeContract } from './contracts/contracts.js';
import { addCriterion } from './criteria/criteria.js';
import { openLedger } from './db/connection.js';
import { exportContractMarkdown } from './exports/markdown.js';
import { addFailureMode, listFailureModes, resolveFailureMode } from './failure-modes/failure-modes.js';
import { addReceipt, runCommandReceipt } from './receipts/receipts.js';
import { addTodo } from './todos/todos.js';
import { addVerifier, listAdapters, listProfiles } from './verifiers/verifiers.js';
import { weakCloseoutReport } from './audits/reports.js';

export type ProgramDeps = {
  cwd?: string;
  actor?: string;
  stdout?: (line: string) => void;
};

export function createProgram(deps: ProgramDeps = {}): Command {
  const cwd = deps.cwd ?? process.cwd();
  const actor = deps.actor ?? process.env.USER ?? 'agent';
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const program = new Command();
  program.name('contract').description('SQLite-backed local contract ledger').version('0.1.0');

  program.command('init')
    .argument('<title>')
    .option('--intent <intent>', 'Contract intent', '')
    .option('--scope <scope>', 'Contract scope', '')
    .action(async (title: string, options: { intent: string; scope: string }) => {
      await audited(cwd, actor, process.argv, 'init', 'contract', undefined, () => {
        const ledger = openLedger({ cwd });
        const contract = createContract(ledger, { title, intent: options.intent, scope: options.scope, createdBy: actor });
        stdout(contract.id);
        ledger.close();
      });
    });

  program.command('accept').argument('<contractId>').action(async (contractId: string) => {
    await audited(cwd, actor, process.argv, 'accept', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      acceptContract(ledger, { contractId, actor });
      stdout(`accepted ${contractId}`);
      ledger.close();
    });
  });

  program.command('criteria-add')
    .argument('<contractId>')
    .argument('<statement>')
    .option('--requires <kind>', 'Required evidence kind', 'command')
    .action(async (contractId: string, statement: string, options: { requires: string }) => {
      await audited(cwd, actor, process.argv, 'criteria-add', 'contract', contractId, () => {
        const ledger = openLedger({ cwd });
        const criterion = addCriterion(ledger, { contractId, statement, requiredEvidenceKind: options.requires, actor });
        stdout(criterion.id);
        ledger.close();
      });
    });

  program.command('todo-add').argument('<contractId>').argument('<title>').action(async (contractId: string, title: string) => {
    await audited(cwd, actor, process.argv, 'todo-add', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      const todo = addTodo(ledger, { contractId, title, actor });
      stdout(todo.id);
      ledger.close();
    });
  });

  program.command('verifier-add-command').argument('<contractId>').argument('<name>').argument('<command...>').action(async (contractId: string, name: string, command: string[]) => {
    await audited(cwd, actor, process.argv, 'verifier-add-command', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      const verifier = addVerifier(ledger, { contractId, name, kind: 'command', config: { command: command.join(' ') }, required: true, actor });
      stdout(verifier.id);
      ledger.close();
    });
  });

  program.command('adapter-list').action(async () => {
    await audited(cwd, actor, process.argv, 'adapter-list', 'adapter', undefined, () => {
      const ledger = openLedger({ cwd });
      stdout(JSON.stringify(listAdapters(ledger), null, 2));
      ledger.close();
    });
  });

  program.command('profile-list').action(async () => {
    await audited(cwd, actor, process.argv, 'profile-list', 'profile', undefined, () => {
      const ledger = openLedger({ cwd });
      stdout(JSON.stringify(listProfiles(ledger), null, 2));
      ledger.close();
    });
  });

  program.command('failure-modes-add').argument('<contractId>').argument('<failureMode>').requiredOption('--why <why>').requiredOption('--check <check>').action(async (contractId: string, failureMode: string, options: { why: string; check: string }) => {
    await audited(cwd, actor, process.argv, 'failure-modes-add', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      const item = addFailureMode(ledger, { contractId, failureMode, whyPlausible: options.why, checkDescription: options.check, expectedProof: {}, resolutionRule: 'Attach receipt or record residual risk.', required: true, actor });
      stdout(item.id);
      ledger.close();
    });
  });

  program.command('failure-modes-list').argument('<contractId>').action(async (contractId: string) => {
    await audited(cwd, actor, process.argv, 'failure-modes-list', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      stdout(JSON.stringify(listFailureModes(ledger, contractId), null, 2));
      ledger.close();
    });
  });

  program.command('failure-modes-resolve').argument('<failureModeId>').requiredOption('--status <status>').action(async (failureModeId: string, options: { status: 'ruled_out' | 'confirmed' | 'inconclusive' | 'accepted_risk' }) => {
    await audited(cwd, actor, process.argv, 'failure-modes-resolve', 'failure_mode', failureModeId, () => {
      const ledger = openLedger({ cwd });
      resolveFailureMode(ledger, { id: failureModeId, status: options.status, actor });
      stdout(`resolved ${failureModeId}`);
      ledger.close();
    });
  });

  program.command('receipt-add').argument('<contractId>').requiredOption('--summary <summary>').option('--status <status>', 'Receipt status', 'pass').action(async (contractId: string, options: { summary: string; status: 'pass' | 'fail' | 'inconclusive' }) => {
    await audited(cwd, actor, process.argv, 'receipt-add', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      const receipt = addReceipt(ledger, { contractId, kind: 'manual', status: options.status, summary: options.summary, createdBy: actor });
      stdout(receipt.id);
      ledger.close();
    });
  });

  program.command('receipt-run').argument('<contractId>').argument('<command...>').action(async (contractId: string, command: string[]) => {
    await audited(cwd, actor, process.argv, 'receipt-run', 'contract', contractId, async () => {
      const ledger = openLedger({ cwd });
      const [bin, ...args] = command;
      if (!bin) throw new Error('receipt-run requires a command');
      const receipt = await runCommandReceipt(ledger, { contractId, command: bin, args, createdBy: actor });
      stdout(receipt.id);
      ledger.close();
    });
  });

  program.command('close').argument('<contractId>').action(async (contractId: string) => {
    await audited(cwd, actor, process.argv, 'close', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      const result = closeContract(ledger, { contractId, actor });
      stdout(result.ok ? `closed ${contractId}` : `blocked ${result.problems.join('; ')}`);
      ledger.close();
    });
  });

  program.command('export').argument('<contractId>').action(async (contractId: string) => {
    await audited(cwd, actor, process.argv, 'export', 'contract', contractId, () => {
      const ledger = openLedger({ cwd });
      stdout(exportContractMarkdown(ledger, contractId));
      recordEvent(ledger, { contractId, scopeType: 'contract', scopeId: contractId, actor, eventType: 'export_created', payload: { format: 'markdown' } });
      ledger.close();
    });
  });

  program.command('audit-weak-closeouts').action(async () => {
    await audited(cwd, actor, process.argv, 'audit-weak-closeouts', 'audit', undefined, () => {
      const ledger = openLedger({ cwd });
      stdout(weakCloseoutReport(ledger));
      recordEvent(ledger, { scopeType: 'audit', actor, eventType: 'audit_run', payload: { report: 'weak-closeouts' } });
      ledger.close();
    });
  });

  return program;
}

async function audited(cwd: string, actor: string, argv: string[], subcommand: string, scopeType: string, scopeId: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const ledger = openLedger({ cwd });
  const invocation = createCommandInvocation(ledger, { actor, command: 'contract', subcommand, argv, cwd, scopeType, scopeId, contractId: scopeType === 'contract' ? scopeId : undefined });
  recordEvent(ledger, { commandInvocationId: invocation.id, contractId: scopeType === 'contract' ? scopeId : undefined, scopeType, scopeId, actor, eventType: 'cli_invoked', payload: { subcommand } });
  ledger.close();
  try {
    await withAuditContext(invocation.id, fn);
    const doneLedger = openLedger({ cwd });
    completeCommandInvocation(doneLedger, invocation.id, { exitCode: 0, status: 'ok' });
    recordEvent(doneLedger, { commandInvocationId: invocation.id, contractId: scopeType === 'contract' ? scopeId : undefined, scopeType, scopeId, actor, eventType: 'cli_completed', payload: { exitCode: 0 } });
    doneLedger.close();
  } catch (error) {
    const failedLedger = openLedger({ cwd });
    completeCommandInvocation(failedLedger, invocation.id, { exitCode: 1, status: 'failed' });
    recordEvent(failedLedger, { commandInvocationId: invocation.id, contractId: scopeType === 'contract' ? scopeId : undefined, scopeType, scopeId, actor, eventType: 'cli_completed', payload: { exitCode: 1, error: error instanceof Error ? error.message : String(error) } });
    failedLedger.close();
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
```

- [ ] **Step 4: Update README with V1 usage**

Replace `/Users/neonwatty/Desktop/contract-experiment/README.md` with:

````md
# Contract Ledger

SQLite-backed local CLI contracts for grounding agent work in explicit
definitions of done, verifiers, receipts, failure modes, and audit logs.

## Install

```bash
npm install
npm run build
```

## Local Usage

```bash
npm run dev -- init "Fix billing settings regression" --intent "Canceled users cannot access premium export"
npm run dev -- criteria-add ctr_xxx "Canceled users cannot access premium export" --requires command
npm run dev -- verifier-add-command ctr_xxx billing-tests npm test -- billing
npm run dev -- failure-modes-add ctr_xxx "Tests pass but browser state fails" --why "No browser proof exists" --check "Run a smoke check"
npm run dev -- receipt-run ctr_xxx node -e "console.log('proof')"
npm run dev -- close ctr_xxx
```

The ledger is stored in `.contracts/ledger.sqlite`. Generated artifacts and
exports also live under `.contracts/`, which is ignored by git by default.

## Design

The current design lives in
`docs/superpowers/specs/2026-06-11-local-contract-ledger-design.md`.
````

- [ ] **Step 5: Run CLI tests, full tests, build**

Run:

```bash
npm test -- tests/cli-commands.test.ts
npm run check
```

Expected: all tests, typecheck, and build pass.

- [ ] **Step 6: Commit CLI wiring and docs**

Run:

```bash
git add src tests README.md
git commit -m "feat: wire v1 cli commands"
```

Expected: commit succeeds.

## Task 8: Final Verification and Public Repo Push

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run check
git status --short
```

Expected: `npm run check` passes. `git status --short` shows no unexpected uncommitted implementation changes.

- [ ] **Step 2: Run a manual happy-path smoke**

Run:

```bash
tmpdir="$(mktemp -d)"
cd "$tmpdir"
node /Users/neonwatty/Desktop/contract-experiment/dist/cli.js init "Smoke contract" --intent "Prove built CLI works"
```

Expected: command prints a `ctr_...` ID and creates `$tmpdir/.contracts/ledger.sqlite`.

- [ ] **Step 3: Push commits**

Run:

```bash
cd /Users/neonwatty/Desktop/contract-experiment
git push origin main
```

Expected: push succeeds to `https://github.com/mean-weasel/contract-ledger`.

- [ ] **Step 4: Final handoff**

Report:

```text
Claim: Contract Ledger V1 CLI is implemented.
Evidence: npm run check passed; manual smoke created a ledger and contract ID.
Receipts: Git commits on main; smoke command output; test output.
Residual risk: V1 adapter execution is minimal and Limner ingestion can be deepened in the next contract.
```
