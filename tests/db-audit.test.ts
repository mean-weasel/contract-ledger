import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  completeCommandInvocation,
  createCommandInvocation,
  recordEvent,
  withAuditContext,
} from '../src/audit/audit.js';
import { redactArgv } from '../src/core/redact.js';
import { openLedger } from '../src/db/connection.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contract-ledger-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe('ledger schema and audit', () => {
  it('openLedger creates all V1 schema tables', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const tables = ledger.db
          .prepare("select name from sqlite_master where type = 'table' order by name")
          .all() as Array<{ name: string }>;
        const tableNames = tables.map((row) => row.name);

        expect(tableNames).toEqual(
          expect.arrayContaining([
            'schema_migrations',
            'goals',
            'contracts',
            'amendments',
            'criteria',
            'verifier_adapters',
            'acceptance_profiles',
            'verifiers',
            'todos',
            'failure_modes',
            'receipts',
            'artifacts',
            'receipt_artifacts',
            'command_invocations',
            'events',
          ]),
        );
      } finally {
        ledger.close();
      }
    });
  });

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

  it('seed data includes built-in adapters and acceptance profiles', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
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
        const profiles = ledger.db
          .prepare('select name from acceptance_profiles order by name')
          .all() as Array<{ name: string }>;

        expect(adapters.map((adapter) => adapter.name)).toEqual(
          expect.arrayContaining(['command', 'limner']),
        );
        expect(profiles.map((profile) => profile.name)).toContain('limner-visual-fidelity');

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
      } finally {
        ledger.close();
      }
    });
  });

  it('createCommandInvocation redacts secret argv values', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const invocation = createCommandInvocation(ledger, {
          actor: 'test-agent',
          command: 'contract',
          subcommand: 'status',
          argv: ['contract', 'status', '--token', 'secret-value', '--name', 'demo'],
          cwd: root,
          scopeType: 'contract',
          scopeId: 'ctr_demo',
          contractId: 'ctr_demo',
        });
        const stored = ledger.db
          .prepare('select argv_json from command_invocations where id = ?')
          .get(invocation.id) as { argv_json: string };

        expect(JSON.parse(stored.argv_json)).toEqual([
          'contract',
          'status',
          '--token',
          '[REDACTED]',
          '--name',
          'demo',
        ]);
        expect(stored.argv_json).not.toContain('secret-value');
      } finally {
        ledger.close();
      }
    });
  });

  it('recordEvent inside withAuditContext links events to command_invocation_id', async () => {
    await withTempWorkspace(async (root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const invocation = createCommandInvocation(ledger, {
          actor: 'test-agent',
          command: 'contract',
          subcommand: 'status',
          argv: ['contract', 'status'],
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

        const event = ledger.db
          .prepare('select command_invocation_id from events where event_type = ?')
          .get('cli_invoked') as { command_invocation_id: string };

        expect(event.command_invocation_id).toBe(invocation.id);
      } finally {
        ledger.close();
      }
    });
  });

  it('completeCommandInvocation updates status and exit_code', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const invocation = createCommandInvocation(ledger, {
          actor: 'test-agent',
          command: 'contract',
          argv: ['contract'],
          cwd: root,
          scopeType: 'workspace',
        });

        completeCommandInvocation(ledger, invocation.id, { exitCode: 0, status: 'ok' });

        const stored = ledger.db
          .prepare('select status, exit_code from command_invocations where id = ?')
          .get(invocation.id) as { status: string; exit_code: number };

        expect(stored.status).toBe('ok');
        expect(stored.exit_code).toBe(0);
      } finally {
        ledger.close();
      }
    });
  });

  it('redactArgv handles separate and inline secret values', () => {
    expect(redactArgv(['--api-key', 'abc123', '--name', 'demo'])).toEqual([
      '--api-key',
      '[REDACTED]',
      '--name',
      'demo',
    ]);
    expect(redactArgv(['--token=abc123', '--url=http://localhost'])).toEqual([
      '--token=[REDACTED]',
      '--url=http://localhost',
    ]);
  });

  it('redactArgv handles compound secret option names', () => {
    expect(redactArgv(['--openai-api-key', 'sk-demo', '--name', 'demo'])).toEqual([
      '--openai-api-key',
      '[REDACTED]',
      '--name',
      'demo',
    ]);
    expect(redactArgv(['--access-token=abc', '--url=http://localhost'])).toEqual([
      '--access-token=[REDACTED]',
      '--url=http://localhost',
    ]);
  });

  it('redactArgv redacts auth and cookie header values', () => {
    expect(
      redactArgv(['--header', 'Authorization: Bearer live-secret', '--name', 'demo']),
    ).toEqual(['--header', '[REDACTED]', '--name', 'demo']);
    expect(redactArgv(['-H', 'Cookie: session=abc123'])).toEqual(['-H', '[REDACTED]']);
    expect(redactArgv(['--header=Authorization: Bearer live-secret'])).toEqual([
      '--header=[REDACTED]',
    ]);
    expect(redactArgv(['-H=Authorization: Bearer live-secret'])).toEqual(['-H=[REDACTED]']);
    expect(redactArgv(['Authorization: Bearer live-secret'])).toEqual(['[REDACTED]']);
    expect(redactArgv(['Cookie: session=abc123'])).toEqual(['[REDACTED]']);
  });

  it('receipts enforce linked evidence rows belong to the same contract', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const now = '2026-06-11T00:00:00.000Z';
        const insertContract = ledger.db.prepare(`
          insert into contracts
            (id, title, status, repo_path, created_by, created_at)
          values
            (@id, @title, 'active', @repoPath, 'test-agent', @createdAt)
        `);
        insertContract.run({
          id: 'ctr_a',
          title: 'Contract A',
          repoPath: root,
          createdAt: now,
        });
        insertContract.run({
          id: 'ctr_b',
          title: 'Contract B',
          repoPath: root,
          createdAt: now,
        });
        ledger.db
          .prepare(
            `
            insert into criteria
              (id, contract_id, statement, required_evidence_kind, status, created_at)
            values
              ('crit_a', 'ctr_a', 'Criterion A', 'command', 'pending', @createdAt)
          `,
          )
          .run({ createdAt: now });
        ledger.db
          .prepare(
            `
            insert into verifiers
              (id, contract_id, name, kind, config_json, required, created_at)
            values
              ('ver_a', 'ctr_a', 'Verifier A', 'command', '{}', 1, @createdAt)
          `,
          )
          .run({ createdAt: now });
        ledger.db
          .prepare(
            `
            insert into todos
              (id, contract_id, title, status, created_at)
            values
              ('todo_a', 'ctr_a', 'Todo A', 'pending', @createdAt)
          `,
          )
          .run({ createdAt: now });
        ledger.db
          .prepare(
            `
            insert into failure_modes
              (
                id,
                contract_id,
                failure_mode,
                why_plausible,
                check_description,
                expected_proof_json,
                resolution_rule,
                status,
                required,
                created_at
              )
            values
              (
                'fm_a',
                'ctr_a',
                'Failure mode A',
                'It is plausible',
                'Check it',
                '{}',
                'Attach proof',
                'pending',
                1,
                @createdAt
              )
          `,
          )
          .run({ createdAt: now });

        ledger.db
          .prepare(
            `
            insert into receipts
              (id, contract_id, kind, status, summary, created_by, created_at)
            values
              ('rec_without_link', 'ctr_b', 'manual', 'pass', 'No optional link', 'test-agent', @createdAt)
          `,
          )
          .run({ createdAt: now });

        const expectMismatchedReceiptToFail = (column: string, value: string) => {
          expect(() => {
            ledger.db
              .prepare(
                `
                insert into receipts
                  (id, contract_id, ${column}, kind, status, summary, created_by, created_at)
                values
                  (@id, 'ctr_b', @value, 'manual', 'pass', 'Cross-contract link', 'test-agent', @createdAt)
              `,
              )
              .run({
                id: `rec_cross_contract_${column}`,
                value,
                createdAt: now,
              });
          }).toThrow(/FOREIGN KEY constraint failed/);
        };

        expectMismatchedReceiptToFail('criterion_id', 'crit_a');
        expectMismatchedReceiptToFail('verifier_id', 'ver_a');
        expectMismatchedReceiptToFail('todo_id', 'todo_a');
        expectMismatchedReceiptToFail('disproof_attempt_id', 'fm_a');

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into receipts
                (id, contract_id, criterion_id, kind, status, summary, created_by, created_at)
              values
                ('rec_same_contract', 'ctr_a', 'crit_a', 'manual', 'pass', 'Same-contract link', 'test-agent', @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();
      } finally {
        ledger.close();
      }
    });
  });

  it('enforces same-contract links for verifiers todos and failure modes', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const now = '2026-06-11T00:00:00.000Z';
        const insertContract = ledger.db.prepare(`
          insert into contracts
            (id, title, status, repo_path, created_by, created_at)
          values
            (@id, @title, 'active', @repoPath, 'test-agent', @createdAt)
        `);
        insertContract.run({
          id: 'ctr_a',
          title: 'Contract A',
          repoPath: root,
          createdAt: now,
        });
        insertContract.run({
          id: 'ctr_b',
          title: 'Contract B',
          repoPath: root,
          createdAt: now,
        });
        ledger.db
          .prepare(
            `
            insert into criteria
              (id, contract_id, statement, required_evidence_kind, status, created_at)
            values
              ('crit_a', 'ctr_a', 'Criterion A', 'command', 'pending', @createdAt)
          `,
          )
          .run({ createdAt: now });
        ledger.db
          .prepare(
            `
            insert into verifiers
              (id, contract_id, criterion_id, name, kind, config_json, required, created_at)
            values
              ('ver_same_contract', 'ctr_a', 'crit_a', 'Verifier A', 'command', '{}', 1, @createdAt)
          `,
          )
          .run({ createdAt: now });

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into verifiers
                (id, contract_id, criterion_id, name, kind, config_json, required, created_at)
              values
                ('ver_cross_contract', 'ctr_b', 'crit_a', 'Verifier B', 'command', '{}', 1, @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).toThrow(/FOREIGN KEY constraint failed/);

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into verifiers
                (id, contract_id, name, kind, config_json, required, created_at)
              values
                ('ver_without_criterion', 'ctr_b', 'Verifier without criterion', 'command', '{}', 1, @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into todos
                (id, contract_id, title, status, linked_criterion_id, created_at)
              values
                ('todo_cross_contract', 'ctr_b', 'Todo B', 'pending', 'crit_a', @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).toThrow(/FOREIGN KEY constraint failed/);

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into todos
                (id, contract_id, title, status, created_at)
              values
                ('todo_without_criterion', 'ctr_b', 'Todo without criterion', 'pending', @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into todos
                (id, contract_id, title, status, linked_criterion_id, created_at)
              values
                ('todo_same_contract', 'ctr_a', 'Todo A', 'pending', 'crit_a', @createdAt)
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into failure_modes
                (
                  id,
                  contract_id,
                  failure_mode,
                  why_plausible,
                  linked_criterion_id,
                  check_description,
                  expected_proof_json,
                  resolution_rule,
                  status,
                  required,
                  created_at
                )
              values
                (
                  'fm_cross_criterion',
                  'ctr_b',
                  'Failure mode B',
                  'It is plausible',
                  'crit_a',
                  'Check it',
                  '{}',
                  'Attach proof',
                  'pending',
                  1,
                  @createdAt
                )
            `,
            )
            .run({ createdAt: now });
        }).toThrow(/FOREIGN KEY constraint failed/);

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into failure_modes
                (
                  id,
                  contract_id,
                  failure_mode,
                  why_plausible,
                  check_description,
                  expected_verifier_id,
                  expected_proof_json,
                  resolution_rule,
                  status,
                  required,
                  created_at
                )
              values
                (
                  'fm_cross_verifier',
                  'ctr_b',
                  'Failure mode B',
                  'It is plausible',
                  'Check it',
                  'ver_same_contract',
                  '{}',
                  'Attach proof',
                  'pending',
                  1,
                  @createdAt
                )
            `,
            )
            .run({ createdAt: now });
        }).toThrow(/FOREIGN KEY constraint failed/);

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into failure_modes
                (
                  id,
                  contract_id,
                  failure_mode,
                  why_plausible,
                  check_description,
                  expected_proof_json,
                  resolution_rule,
                  status,
                  required,
                  created_at
                )
              values
                (
                  'fm_without_links',
                  'ctr_b',
                  'Failure mode without links',
                  'It is plausible',
                  'Check it',
                  '{}',
                  'Attach proof',
                  'pending',
                  1,
                  @createdAt
                )
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into failure_modes
                (
                  id,
                  contract_id,
                  failure_mode,
                  why_plausible,
                  linked_criterion_id,
                  check_description,
                  expected_proof_json,
                  resolution_rule,
                  status,
                  required,
                  created_at
                )
              values
                (
                  'fm_same_criterion',
                  'ctr_a',
                  'Failure mode with criterion',
                  'It is plausible',
                  'crit_a',
                  'Check it',
                  '{}',
                  'Attach proof',
                  'pending',
                  1,
                  @createdAt
                )
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into failure_modes
                (
                  id,
                  contract_id,
                  failure_mode,
                  why_plausible,
                  check_description,
                  expected_verifier_id,
                  expected_proof_json,
                  resolution_rule,
                  status,
                  required,
                  created_at
                )
              values
                (
                  'fm_same_verifier',
                  'ctr_a',
                  'Failure mode with verifier',
                  'It is plausible',
                  'Check it',
                  'ver_same_contract',
                  '{}',
                  'Attach proof',
                  'pending',
                  1,
                  @createdAt
                )
            `,
            )
            .run({ createdAt: now });
        }).not.toThrow();
      } finally {
        ledger.close();
      }
    });
  });

  it('receipt_artifacts enforce receipts and artifacts belong to the same contract', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const now = '2026-06-11T00:00:00.000Z';
        const insertContract = ledger.db.prepare(`
          insert into contracts
            (id, title, status, repo_path, created_by, created_at)
          values
            (@id, @title, 'active', @repoPath, 'test-agent', @createdAt)
        `);
        insertContract.run({
          id: 'ctr_a',
          title: 'Contract A',
          repoPath: root,
          createdAt: now,
        });
        insertContract.run({
          id: 'ctr_b',
          title: 'Contract B',
          repoPath: root,
          createdAt: now,
        });
        ledger.db
          .prepare(
            `
            insert into receipts
              (id, contract_id, kind, status, summary, created_by, created_at)
            values
              ('rec_a', 'ctr_a', 'manual', 'pass', 'Receipt A', 'test-agent', @createdAt)
          `,
          )
          .run({ createdAt: now });
        ledger.db
          .prepare(
            `
            insert into artifacts
              (id, contract_id, path, size_bytes, sha256, created_at)
            values
              ('art_a', 'ctr_a', 'a.txt', 1, 'sha-a', @createdAt),
              ('art_b', 'ctr_b', 'b.txt', 1, 'sha-b', @createdAt)
          `,
          )
          .run({ createdAt: now });

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into receipt_artifacts
                (receipt_id, artifact_id, contract_id)
              values
                ('rec_a', 'art_b', 'ctr_a')
            `,
            )
            .run();
        }).toThrow(/FOREIGN KEY constraint failed/);

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into receipt_artifacts
                (receipt_id, artifact_id, contract_id)
              values
                ('rec_a', 'art_a', 'ctr_a')
            `,
            )
            .run();
        }).not.toThrow();
      } finally {
        ledger.close();
      }
    });
  });

  it('migrates old-shape ledgers to contract-scoped evidence links', async () => {
    await withTempWorkspace(async (root) => {
      const contractsDir = path.join(root, '.contracts');
      await mkdir(contractsDir, { recursive: true });

      const oldDb = new Database(path.join(contractsDir, 'ledger.sqlite'));
      oldDb.exec(`
        pragma foreign_keys = on;

        create table goals (
          id text primary key,
          title text not null,
          intent text not null default '',
          status text not null,
          created_by text not null,
          created_at text not null,
          closed_at text
        );

        create table contracts (
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

        create table criteria (
          id text primary key,
          contract_id text not null references contracts(id),
          statement text not null,
          required_evidence_kind text not null,
          priority integer not null default 0,
          status text not null,
          rationale text,
          residual_risk text,
          created_at text not null,
          satisfied_at text,
          unique (id, contract_id)
        );

        create table verifiers (
          id text primary key,
          contract_id text not null references contracts(id),
          criterion_id text references criteria(id),
          adapter_id text,
          name text not null,
          kind text not null,
          config_json text not null,
          required integer not null,
          created_at text not null,
          unique (id, contract_id)
        );

        create table todos (
          id text primary key,
          contract_id text not null references contracts(id),
          title text not null,
          description text not null default '',
          status text not null,
          linked_criterion_id text references criteria(id),
          claimed_by text,
          created_at text not null,
          completed_at text,
          unique (id, contract_id)
        );

        create table failure_modes (
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
          resolved_at text,
          unique (id, contract_id)
        );

        create table receipts (
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
          created_at text not null,
          unique (id, contract_id)
        );

        create table artifacts (
          id text primary key,
          contract_id text not null references contracts(id),
          path text not null,
          mime_type text not null default '',
          size_bytes integer not null,
          sha256 text not null,
          created_at text not null,
          unique (id, contract_id)
        );

        create table receipt_artifacts (
          receipt_id text not null references receipts(id),
          artifact_id text not null references artifacts(id),
          primary key (receipt_id, artifact_id)
        );

        insert into contracts
          (id, title, status, repo_path, created_by, created_at)
        values
          ('ctr_a', 'Contract A', 'active', '${root}', 'test-agent', '2026-06-11T00:00:00.000Z'),
          ('ctr_b', 'Contract B', 'active', '${root}', 'test-agent', '2026-06-11T00:00:00.000Z');

        insert into criteria
          (id, contract_id, statement, required_evidence_kind, status, created_at)
        values
          ('crit_a', 'ctr_a', 'Criterion A', 'command', 'pending', '2026-06-11T00:00:00.000Z');

        insert into verifiers
          (id, contract_id, criterion_id, name, kind, config_json, required, created_at)
        values
          ('ver_valid', 'ctr_a', 'crit_a', 'Valid verifier', 'command', '{}', 1, '2026-06-11T00:00:00.000Z'),
          ('ver_invalid', 'ctr_b', 'crit_a', 'Invalid verifier', 'command', '{}', 1, '2026-06-11T00:00:00.000Z'),
          ('ver_for_fm', 'ctr_a', null, 'Verifier for failure mode', 'command', '{}', 1, '2026-06-11T00:00:00.000Z');

        insert into todos
          (id, contract_id, title, status, linked_criterion_id, created_at)
        values
          ('todo_valid', 'ctr_a', 'Valid todo', 'pending', 'crit_a', '2026-06-11T00:00:00.000Z'),
          ('todo_invalid', 'ctr_b', 'Invalid todo', 'pending', 'crit_a', '2026-06-11T00:00:00.000Z');

        insert into failure_modes
          (
            id,
            contract_id,
            failure_mode,
            why_plausible,
            linked_criterion_id,
            check_description,
            expected_verifier_id,
            expected_proof_json,
            resolution_rule,
            status,
            required,
            created_at
          )
        values
          (
            'fm_valid',
            'ctr_a',
            'Valid failure mode',
            'It is plausible',
            'crit_a',
            'Check it',
            'ver_for_fm',
            '{}',
            'Attach proof',
            'pending',
            1,
            '2026-06-11T00:00:00.000Z'
          ),
          (
            'fm_invalid',
            'ctr_b',
            'Invalid failure mode',
            'It is plausible',
            'crit_a',
            'Check it',
            'ver_for_fm',
            '{}',
            'Attach proof',
            'pending',
            1,
            '2026-06-11T00:00:00.000Z'
          );

        insert into receipts
          (
            id,
            contract_id,
            criterion_id,
            verifier_id,
            todo_id,
            disproof_attempt_id,
            kind,
            status,
            summary,
            created_by,
            created_at
          )
        values
          (
            'rec_valid',
            'ctr_a',
            'crit_a',
            'ver_valid',
            'todo_valid',
            'fm_valid',
            'manual',
            'pass',
            'Valid receipt',
            'test-agent',
            '2026-06-11T00:00:00.000Z'
          ),
          (
            'rec_invalid',
            'ctr_b',
            'crit_a',
            'ver_valid',
            'todo_valid',
            'fm_valid',
            'manual',
            'pass',
            'Invalid receipt',
            'test-agent',
            '2026-06-11T00:00:00.000Z'
          );

        insert into artifacts
          (id, contract_id, path, size_bytes, sha256, created_at)
        values
          ('art_a', 'ctr_a', 'a.txt', 1, 'sha-a', '2026-06-11T00:00:00.000Z'),
          ('art_b', 'ctr_b', 'b.txt', 1, 'sha-b', '2026-06-11T00:00:00.000Z');

        insert into receipt_artifacts
          (receipt_id, artifact_id)
        values
          ('rec_valid', 'art_a'),
          ('rec_valid', 'art_b');
      `);
      oldDb.close();

      const ledger = openLedger({ cwd: root });

      try {
        const receiptArtifactColumns = ledger.db
          .prepare('pragma table_info(receipt_artifacts)')
          .all() as Array<{ name: string }>;
        expect(receiptArtifactColumns.map((column) => column.name)).toContain('contract_id');

        expect(
          ledger.db
            .prepare('select criterion_id from verifiers where id = ?')
            .get('ver_valid'),
        ).toEqual({ criterion_id: 'crit_a' });
        expect(
          ledger.db
            .prepare('select linked_criterion_id from todos where id = ?')
            .get('todo_valid'),
        ).toEqual({ linked_criterion_id: 'crit_a' });
        expect(
          ledger.db
            .prepare(
              'select linked_criterion_id, expected_verifier_id from failure_modes where id = ?',
            )
            .get('fm_valid'),
        ).toEqual({ linked_criterion_id: 'crit_a', expected_verifier_id: 'ver_for_fm' });
        expect(
          ledger.db
            .prepare(
              'select criterion_id, verifier_id, todo_id, disproof_attempt_id from receipts where id = ?',
            )
            .get('rec_valid'),
        ).toEqual({
          criterion_id: 'crit_a',
          verifier_id: 'ver_valid',
          todo_id: 'todo_valid',
          disproof_attempt_id: 'fm_valid',
        });
        expect(
          ledger.db
            .prepare('select criterion_id from verifiers where id = ?')
            .get('ver_invalid'),
        ).toEqual({ criterion_id: null });
        expect(
          ledger.db
            .prepare('select linked_criterion_id from todos where id = ?')
            .get('todo_invalid'),
        ).toEqual({ linked_criterion_id: null });
        expect(
          ledger.db
            .prepare(
              'select linked_criterion_id, expected_verifier_id from failure_modes where id = ?',
            )
            .get('fm_invalid'),
        ).toEqual({ linked_criterion_id: null, expected_verifier_id: null });
        expect(
          ledger.db
            .prepare(
              'select criterion_id, verifier_id, todo_id, disproof_attempt_id from receipts where id = ?',
            )
            .get('rec_invalid'),
        ).toEqual({
          criterion_id: null,
          verifier_id: null,
          todo_id: null,
          disproof_attempt_id: null,
        });
        expect(
          ledger.db
            .prepare(
              'select count(*) as count from receipt_artifacts where receipt_id = ? and artifact_id = ?',
            )
            .get('rec_valid', 'art_b'),
        ).toEqual({ count: 0 });
        expect(
          ledger.db
            .prepare(
              'select contract_id from receipt_artifacts where receipt_id = ? and artifact_id = ?',
            )
            .get('rec_valid', 'art_a'),
        ).toEqual({ contract_id: 'ctr_a' });

        expect(() => {
          ledger.db
            .prepare(
              `
              insert into verifiers
                (id, contract_id, criterion_id, name, kind, config_json, required, created_at)
              values
                ('ver_after_migration', 'ctr_b', 'crit_a', 'Verifier B', 'command', '{}', 1, '2026-06-11T00:00:00.000Z')
            `,
            )
            .run();
        }).toThrow(/FOREIGN KEY constraint failed/);
        expect(() => {
          ledger.db
            .prepare(
              `
              insert into receipt_artifacts
                (receipt_id, artifact_id, contract_id)
              values
                ('rec_valid', 'art_b', 'ctr_a')
            `,
            )
            .run();
        }).toThrow(/FOREIGN KEY constraint failed/);
      } finally {
        ledger.close();
      }
    });
  });
});
