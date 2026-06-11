import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  it('openLedger creates schema tables including contract and audit foundations', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const tables = ledger.db
          .prepare("select name from sqlite_master where type = 'table' order by name")
          .all() as Array<{ name: string }>;
        const tableNames = tables.map((row) => row.name);

        expect(tableNames).toContain('contracts');
        expect(tableNames).toContain('command_invocations');
        expect(tableNames).toContain('events');
        expect(tableNames).toContain('verifier_adapters');
      } finally {
        ledger.close();
      }
    });
  });

  it('seed data includes the limner adapter', async () => {
    await withTempWorkspace((root) => {
      const ledger = openLedger({ cwd: root });

      try {
        const limner = ledger.db
          .prepare('select name from verifier_adapters where name = ?')
          .get('limner');

        expect(limner).toBeTruthy();
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
});
