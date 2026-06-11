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

  it('blocked closeout records a failed invocation and no success completion', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: ['init', 'Blocked close', '--intent', 'Check close gates', '--scope', 'CLI tests'],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await runCli({
        cwd: root,
        argv: ['accept', contractId ?? 'missing'],
        stdout,
      });
      await runCli({
        cwd: root,
        argv: [
          'criteria-add',
          contractId ?? 'missing',
          'This criterion remains pending.',
          '--requires',
          'manual',
        ],
        stdout,
      });

      await expect(
        runCli({
          cwd: root,
          argv: ['close', contractId ?? 'missing'],
          stdout,
        }),
      ).rejects.toThrow(/blocked: Pending criteria/);
      expect(stdout.at(-1)).toMatch(/blocked: Pending criteria/);

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'close'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };
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
        const closedEvents = ledger.db
          .prepare(
            `
            select count(*) as count
            from events
            where contract_id = ?
              and event_type = 'contract_closed'
          `,
          )
          .get(contractId) as { count: number };

        expect(invocation).toMatchObject({
          status: 'failed',
          exit_code: 1,
        });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          exitCode: 1,
        });
        expect(successCount.count).toBe(0);
        expect(closedEvents.count).toBe(0);
      });
    });
  });

  it('receipt-run executes child commands with flags after the separator', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Receipt command',
          '--intent',
          'Run a child command',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await runCli({
        cwd: root,
        argv: ['receipt-run', contractId ?? 'missing', '--', process.execPath, '-e', "console.log('proof')"],
        stdout,
      });
      const [receiptId, status] = stdout.at(-1)?.split(' ') ?? [];

      withLedger(root, (ledger) => {
        const receipt = ledger.db
          .prepare(
            `
            select id, status, command, stdout_excerpt
            from receipts
            where id = ?
          `,
          )
          .get(receiptId) as
          | {
              id: string;
              status: string;
              command: string;
              stdout_excerpt: string;
            }
          | undefined;
        const invocation = ledger.db
          .prepare(
            `
            select status, exit_code
            from command_invocations
            where subcommand = 'receipt-run'
          `,
          )
          .get() as { status: string; exit_code: number };

        expect(status).toBe('pass');
        expect(receipt?.status).toBe('pass');
        expect(receipt?.command).toContain(`${process.execPath} -e`);
        expect(receipt?.stdout_excerpt).toContain('proof');
        expect(invocation).toEqual({ status: 'ok', exit_code: 0 });
      });
    });
  });

  it('receipt-run without a child command separator is audited as a failed command', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Missing separator',
          '--intent',
          'Check receipt-run errors',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await expect(
        runCli({
          cwd: root,
          argv: ['receipt-run', contractId ?? 'missing', process.execPath, '-e', "console.log('proof')"],
          stdout,
        }),
      ).rejects.toThrow('receipt-run requires "--" before the child command');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'receipt-run'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };

        expect(invocation).toMatchObject({ status: 'failed', exit_code: 1 });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          error:
            'receipt-run requires "--" before the child command: receipt-run <contractId> -- <command...>',
        });
      });
    });
  });

  it('receipt-run rejects a later separator and does not create a receipt', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Late separator',
          '--intent',
          'Check strict receipt-run separator',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await expect(
        runCli({
          cwd: root,
          argv: [
            'receipt-run',
            contractId ?? 'missing',
            process.execPath,
            '-e',
            "console.log('proof')",
            '--',
            'sentinel',
          ],
          stdout,
        }),
      ).rejects.toThrow('receipt-run requires "--" before the child command');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'receipt-run'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };
        const receipts = ledger.db
          .prepare('select count(*) as count from receipts where contract_id = ?')
          .get(contractId) as { count: number };

        expect(invocation).toMatchObject({ status: 'failed', exit_code: 1 });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          error:
            'receipt-run requires "--" before the child command: receipt-run <contractId> -- <command...>',
        });
        expect(receipts.count).toBe(0);
      });
    });
  });

  it('receipt-run with an empty pass-through command is audited as failed and creates no receipt', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Empty receipt command',
          '--intent',
          'Check empty receipt-run pass-through',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await expect(
        runCli({
          cwd: root,
          argv: ['receipt-run', contractId ?? 'missing', '--'],
          stdout,
        }),
      ).rejects.toThrow('receipt-run requires a command');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'receipt-run'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };
        const receipts = ledger.db
          .prepare('select count(*) as count from receipts where contract_id = ?')
          .get(contractId) as { count: number };

        expect(invocation).toMatchObject({ status: 'failed', exit_code: 1 });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          error: 'receipt-run requires a command',
        });
        expect(receipts.count).toBe(0);
      });
    });
  });

  it('verifier-add-command preserves child command separators after the pass-through marker', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: ['init', 'Verifier command', '--intent', 'Store verifier', '--scope', 'CLI tests'],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await runCli({
        cwd: root,
        argv: [
          'verifier-add-command',
          contractId ?? 'missing',
          'billing-tests',
          '--',
          'npm',
          'test',
          '--',
          'billing',
        ],
        stdout,
      });
      const verifierId = stdout.at(-1)?.trim();

      withLedger(root, (ledger) => {
        const verifier = ledger.db
          .prepare('select config_json from verifiers where id = ?')
          .get(verifierId) as { config_json: string } | undefined;

        expect(JSON.parse(verifier?.config_json ?? '{}')).toEqual({
          command: 'npm test -- billing',
        });
      });
    });
  });

  it('verifier-add-command with an empty pass-through command is audited as failed and creates no verifier', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Empty verifier command',
          '--intent',
          'Check empty verifier pass-through',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await expect(
        runCli({
          cwd: root,
          argv: ['verifier-add-command', contractId ?? 'missing', 'empty-command', '--'],
          stdout,
        }),
      ).rejects.toThrow('verifier-add-command requires a command');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'verifier-add-command'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };
        const verifiers = ledger.db
          .prepare('select count(*) as count from verifiers where contract_id = ?')
          .get(contractId) as { count: number };

        expect(invocation).toMatchObject({ status: 'failed', exit_code: 1 });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          error: 'verifier-add-command requires a command',
        });
        expect(verifiers.count).toBe(0);
      });
    });
  });

  it('verifier-add-command rejects old nested-separator syntax and does not create a verifier', async () => {
    await withTempWorkspace(async (root) => {
      const stdout: string[] = [];

      await runCli({
        cwd: root,
        argv: [
          'init',
          'Old verifier syntax',
          '--intent',
          'Check strict verifier separator',
          '--scope',
          'CLI tests',
        ],
        stdout,
      });
      const contractId = stdout.at(-1)?.trim();
      expect(contractId).toMatch(/^ctr_/);

      await expect(
        runCli({
          cwd: root,
          argv: [
            'verifier-add-command',
            contractId ?? 'missing',
            'billing-tests',
            'npm',
            'test',
            '--',
            'billing',
          ],
          stdout,
        }),
      ).rejects.toThrow('verifier-add-command requires "--" before the child command');

      withLedger(root, (ledger) => {
        const invocation = ledger.db
          .prepare(
            `
            select id, status, exit_code
            from command_invocations
            where subcommand = 'verifier-add-command'
          `,
          )
          .get() as { id: string; status: string; exit_code: number };
        const completion = ledger.db
          .prepare(
            `
            select payload_json
            from events
            where command_invocation_id = ?
              and event_type = 'cli_completed'
          `,
          )
          .get(invocation.id) as { payload_json: string };
        const verifiers = ledger.db
          .prepare('select count(*) as count from verifiers where contract_id = ?')
          .get(contractId) as { count: number };

        expect(invocation).toMatchObject({ status: 'failed', exit_code: 1 });
        expect(JSON.parse(completion.payload_json)).toMatchObject({
          status: 'failed',
          error:
            'verifier-add-command requires "--" before the child command: verifier-add-command <contractId> <name> -- <command...>',
        });
        expect(verifiers.count).toBe(0);
      });
    });
  });
});
