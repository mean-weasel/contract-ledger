import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';
import { openLedger, type Ledger } from '../src/db/connection.js';

async function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contract-cli-commands-'));

  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function runCli(input: {
  cwd: string;
  argv: string[];
  actor?: string;
  stdout?: string[];
  stderr?: string[];
}): Promise<void> {
  const stdout = input.stdout ?? [];
  const stderr = input.stderr ?? [];
  const fullArgv = ['node', 'contract', ...input.argv];
  const program = createProgram({
    cwd: input.cwd,
    actor: input.actor ?? 'test-agent',
    argv: fullArgv,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  await program.parseAsync(fullArgv);
}

function withLedger<T>(cwd: string, fn: (ledger: Ledger) => T): T {
  const ledger = openLedger({ cwd });

  try {
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

describe('CLI commands', () => {
  it('init creates a contract and records command invocation audit', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'CLI demo',
          '--intent',
          'Prove CLI wiring works',
          '--scope',
          'CLI command coverage',
        ],
        stdout,
      });

      const contractId = stdout.join('\n').trim();
      expect(contractId).toMatch(/^ctr_/);

      withLedger(root, (ledger) => {
        const contract = ledger.db
          .prepare('select id, title, intent, scope, created_by from contracts where id = ?')
          .get(contractId) as
          | {
              id: string;
              title: string;
              intent: string;
              scope: string;
              created_by: string;
            }
          | undefined;
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code, argv_json
            from command_invocations
            where subcommand = 'init'
          `,
          )
          .get() as { id: string; status: string; exit_code: number; argv_json: string };
        const events = ledger.db
          .prepare(
            `
            select event_type, command_invocation_id
            from events
            where command_invocation_id = ?
            order by created_at, rowid
          `,
          )
          .all(invocation.id) as Array<{ event_type: string; command_invocation_id: string }>;

        expect(contract).toEqual({
          id: contractId,
          title: 'CLI demo',
          intent: 'Prove CLI wiring works',
          scope: 'CLI command coverage',
          created_by: 'test-agent',
        });
        expect(invocation).toMatchObject({
          status: 'ok',
          exit_code: 0,
        });
        expect(JSON.parse(invocation.argv_json)).toEqual([
          'node',
          'contract',
          'init',
          'CLI demo',
          '--intent',
          'Prove CLI wiring works',
          '--scope',
          'CLI command coverage',
        ]);
        expect(events.map((event) => event.event_type)).toEqual([
          'cli_invoked',
          'contract_created',
          'cli_completed',
        ]);
      });
    });
  });

  it('links domain events created by CLI commands to the command invocation id', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: ['init', 'Linked audit', '--intent', 'Check linkage', '--scope', 'CLI tests'],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await runCli({
        cwd: root,
        argv: ['accept', contractId ?? 'missing'],
        stdout,
      });

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id
            from command_invocations
            where subcommand = 'accept'
          `,
          )
          .get() as { id: string };
        const event = ledger.db
          .prepare(
            `
            select command_invocation_id, contract_id
            from events
            where event_type = 'contract_accepted'
          `,
          )
          .get() as { command_invocation_id: string; contract_id: string };

        expect(event.command_invocation_id).toBe(invocation.id);
        expect(event.contract_id).toBe(contractId);
      });
    });
  });

  it('failed CLI commands record failed invocation and no success completion event', async () => {
    await withTempWorkspace(async (root) => {
      await expect(
        runCli({
          cwd: root,
          argv: ['accept', 'ctr_missing'],
        }),
      ).rejects.toThrow('Contract not found: ctr_missing');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'accept'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completions = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .all(invocation.id) as Array<{ payload_json: string }>;
        const successCount = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
              and json_extract(payload_json, '$.status') = 'ok'
          `,
          )
          .get(invocation.id) as { count: number };

        expect(invocation).toEqual({
          id: invocation.id,
          status: 'failed',
          exit_code: 1,
        });
        expect(completions).toHaveLength(1);
        expect(JSON.parse(completions[0]?.payload_json ?? '{}')).toMatchObject({
          status: 'failed',
          exitCode: 1,
          error: 'Contract not found: ctr_missing',
        });
        expect(successCount.count).toBe(0);
      });
    });
  });

  it('criteria-add creates a criterion through the CLI', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: ['init', 'Criteria demo', '--intent', 'Add criteria', '--scope', 'CLI tests'],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await runCli({
        cwd: root,
        argv: [
          'criteria-add',
          contractId ?? 'missing',
          'The CLI records criteria.',
          '--requires',
          'command',
        ],
        stdout,
      });
      const criterionId = stdout.at(-1)?.trim();

      withLedger(root, (ledger) => {
        const criterion = ledger.db
          .prepare(
            `
            select id, statement, required_evidence_kind
            from criteria
            where id = ?
          `,
          )
          .get(criterionId) as
          | {
              id: string;
              statement: string;
              required_evidence_kind: string;
            }
          | undefined;
        const event = ledger.db
          .prepare(
            `
            select events.command_invocation_id
            from events
            join command_invocations on command_invocations.id = events.command_invocation_id
            where command_invocations.subcommand = 'criteria-add'
              and events.event_type = 'criterion_added'
          `,
          )
          .get() as { command_invocation_id: string } | undefined;

        expect(criterion).toEqual({
          id: criterionId,
          statement: 'The CLI records criteria.',
          required_evidence_kind: 'command',
        });
        expect(event?.command_invocation_id).toMatch(/^cmd_/);
      });
    });
  });
});
