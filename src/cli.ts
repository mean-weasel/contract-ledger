#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

import {
  completeCommandInvocation,
  createCommandInvocation,
  recordEvent,
  withAuditContext,
} from './audit/audit.js';
import { weakCloseoutReport } from './audits/reports.js';
import { acceptContract, closeContract, createContract } from './contracts/contracts.js';
import { addCriterion } from './criteria/criteria.js';
import { openLedger, type Ledger } from './db/connection.js';
import { exportContractMarkdown } from './exports/markdown.js';
import {
  addFailureMode,
  listFailureModes,
  resolveFailureMode,
  type FailureModeResolutionStatus,
} from './failure-modes/failure-modes.js';
import { addReceipt, runCommandReceipt, type ReceiptStatus } from './receipts/receipts.js';
import { addTodo } from './todos/todos.js';
import { addVerifier, listAdapters, listProfiles } from './verifiers/verifiers.js';

const cliVersion = '0.1.0';

export type ProgramDeps = {
  cwd?: string;
  actor?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  argv?: string[];
};

type AuditedInput = {
  cwd: string;
  actor: string;
  argv: string[];
  subcommand: string;
  scopeType: string;
  scopeId?: string;
  contractId?: string;
};

function writeDefaultOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

function writeDefaultErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function defaultActor(): string {
  return process.env.USER ?? process.env.USERNAME ?? 'agent';
}

function getInvocationArgv(deps: ProgramDeps, program: Command): string[] {
  return deps.argv ?? program.args;
}

function parseStatus(status: string): ReceiptStatus {
  if (status === 'pass' || status === 'fail' || status === 'inconclusive') {
    return status;
  }

  throw new Error(`Invalid receipt status: ${status}`);
}

function parseFailureModeStatus(status: string): FailureModeResolutionStatus {
  if (
    status === 'ruled_out' ||
    status === 'confirmed' ||
    status === 'inconclusive' ||
    status === 'accepted_risk'
  ) {
    return status;
  }

  throw new Error(`Invalid failure mode status: ${status}`);
}

function usingLedger<T>(cwd: string, fn: (ledger: Ledger) => T): T {
  const ledger = openLedger({ cwd });

  try {
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

async function usingLedgerAsync<T>(cwd: string, fn: (ledger: Ledger) => Promise<T>): Promise<T> {
  const ledger = openLedger({ cwd });

  try {
    return await fn(ledger);
  } finally {
    ledger.close();
  }
}

async function audited<T>(input: AuditedInput, fn: () => T | Promise<T>): Promise<T> {
  const contractId = input.contractId ?? (input.scopeType === 'contract' ? input.scopeId : undefined);
  let invocationId = '';

  usingLedger(input.cwd, (ledger) => {
    const invocation = createCommandInvocation(ledger, {
      actor: input.actor,
      contractId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      command: 'contract',
      subcommand: input.subcommand,
      argv: input.argv,
      cwd: input.cwd,
    });
    invocationId = invocation.id;
    recordEvent(ledger, {
      commandInvocationId: invocation.id,
      contractId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      actor: input.actor,
      eventType: 'cli_invoked',
      payload: {
        subcommand: input.subcommand,
      },
    });
  });

  try {
    const result = await withAuditContext(invocationId, fn);

    usingLedger(input.cwd, (ledger) => {
      completeCommandInvocation(ledger, invocationId, { exitCode: 0, status: 'ok' });
      recordEvent(ledger, {
        commandInvocationId: invocationId,
        contractId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        actor: input.actor,
        eventType: 'cli_completed',
        payload: {
          subcommand: input.subcommand,
          exitCode: 0,
          status: 'ok',
        },
      });
    });

    return result;
  } catch (error) {
    usingLedger(input.cwd, (ledger) => {
      completeCommandInvocation(ledger, invocationId, { exitCode: 1, status: 'failed' });
      recordEvent(ledger, {
        commandInvocationId: invocationId,
        contractId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        actor: input.actor,
        eventType: 'cli_completed',
        payload: {
          subcommand: input.subcommand,
          exitCode: 1,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });

    throw error;
  }
}

export function createProgram(deps: ProgramDeps = {}): Command {
  const cwd = deps.cwd ?? process.cwd();
  const actor = deps.actor ?? defaultActor();
  const stdout = deps.stdout ?? writeDefaultOut;
  const stderr = deps.stderr ?? writeDefaultErr;
  const program = new Command();
  const emit = (line: string) => {
    const writeOut = program.configureOutput().writeOut;

    if (writeOut === undefined) {
      stdout(line);
      return;
    }

    writeOut(`${line}\n`);
  };

  program
    .name('contract')
    .description('SQLite-backed local contract ledger')
    .version(cliVersion);

  program.configureOutput({
    writeOut: (value) => stdout(value.endsWith('\n') ? value.slice(0, -1) : value),
    writeErr: (value) => stderr(value.endsWith('\n') ? value.slice(0, -1) : value),
  });

  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      emit(cliVersion);
    });

  program
    .command('init')
    .description('Create a draft contract')
    .argument('<title>')
    .requiredOption('--intent <intent>', 'Contract intent')
    .requiredOption('--scope <scope>', 'Contract scope')
    .action(
      async (
        title: string,
        options: {
          intent: string;
          scope: string;
        },
        command: Command,
      ) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'init',
            scopeType: 'contract',
          },
          () => {
            const contract = usingLedger(cwd, (ledger) =>
              createContract(ledger, {
                title,
                intent: options.intent,
                scope: options.scope,
                createdBy: actor,
              }),
            );
            emit(contract.id);
          },
        );
      },
    );

  program
    .command('accept')
    .description('Accept a draft contract')
    .argument('<contractId>')
    .action(async (contractId: string, _options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'accept',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const contract = usingLedger(cwd, (ledger) => acceptContract(ledger, { contractId, actor }));
          emit(`${contract.id} ${contract.status}`);
        },
      );
    });

  program
    .command('criteria-add')
    .description('Add an acceptance criterion')
    .argument('<contractId>')
    .argument('<statement>')
    .requiredOption('--requires <kind>', 'Required evidence kind')
    .action(
      async (
        contractId: string,
        statement: string,
        options: { requires: string },
        command: Command,
      ) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'criteria-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const criterion = usingLedger(cwd, (ledger) =>
              addCriterion(ledger, {
                contractId,
                statement,
                requiredEvidenceKind: options.requires,
                actor,
              }),
            );
            emit(criterion.id);
          },
        );
      },
    );

  program
    .command('todo-add')
    .description('Add a todo for a contract')
    .argument('<contractId>')
    .argument('<title>')
    .action(async (contractId: string, title: string, _options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'todo-add',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const todo = usingLedger(cwd, (ledger) => addTodo(ledger, { contractId, title, actor }));
          emit(todo.id);
        },
      );
    });

  program
    .command('verifier-add-command')
    .description('Add a command verifier')
    .argument('<contractId>')
    .argument('<name>')
    .argument('<command...>')
    .action(
      async (contractId: string, name: string, commandArgs: string[], command: Command) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'verifier-add-command',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const verifier = usingLedger(cwd, (ledger) =>
              addVerifier(ledger, {
                contractId,
                name,
                kind: 'command',
                config: { command: commandArgs.join(' ') },
                required: true,
                actor,
              }),
            );
            emit(verifier.id);
          },
        );
      },
    );

  program
    .command('adapter-list')
    .description('List verifier adapters')
    .action(async (_options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'adapter-list',
          scopeType: 'adapter',
        },
        () => {
          emit(JSON.stringify(usingLedger(cwd, listAdapters), null, 2));
        },
      );
    });

  program
    .command('profile-list')
    .description('List acceptance profiles')
    .action(async (_options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'profile-list',
          scopeType: 'profile',
        },
        () => {
          emit(JSON.stringify(usingLedger(cwd, listProfiles), null, 2));
        },
      );
    });

  program
    .command('failure-modes-add')
    .description('Add a required failure mode to disprove')
    .argument('<contractId>')
    .argument('<failureMode>')
    .requiredOption('--why <why>', 'Why this failure mode is plausible')
    .requiredOption('--check <check>', 'How to check the failure mode')
    .action(
      async (
        contractId: string,
        failureMode: string,
        options: { why: string; check: string },
        command: Command,
      ) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'failure-modes-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const item = usingLedger(cwd, (ledger) =>
              addFailureMode(ledger, {
                contractId,
                failureMode,
                whyPlausible: options.why,
                checkDescription: options.check,
                expectedProof: {},
                resolutionRule: 'Record a receipt or residual risk before closeout.',
                required: true,
                actor,
              }),
            );
            emit(item.id);
          },
        );
      },
    );

  program
    .command('failure-modes-list')
    .description('List failure modes for a contract')
    .argument('<contractId>')
    .action(async (contractId: string, _options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'failure-modes-list',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(cwd, (ledger) => listFailureModes(ledger, contractId)), null, 2));
        },
      );
    });

  program
    .command('failure-modes-resolve')
    .description('Resolve a failure mode')
    .argument('<failureModeId>')
    .requiredOption('--status <status>', 'ruled_out, confirmed, inconclusive, or accepted_risk')
    .action(
      async (
        failureModeId: string,
        options: { status: string },
        command: Command,
      ) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'failure-modes-resolve',
            scopeType: 'failure_mode',
            scopeId: failureModeId,
          },
          () => {
            usingLedger(cwd, (ledger) =>
              resolveFailureMode(ledger, {
                id: failureModeId,
                status: parseFailureModeStatus(options.status),
                actor,
              }),
            );
            emit(`${failureModeId} ${options.status}`);
          },
        );
      },
    );

  program
    .command('receipt-add')
    .description('Add a manual receipt')
    .argument('<contractId>')
    .requiredOption('--summary <summary>', 'Receipt summary')
    .requiredOption('--status <status>', 'pass, fail, or inconclusive')
    .action(
      async (
        contractId: string,
        options: { summary: string; status: string },
        command: Command,
      ) => {
        await audited(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'receipt-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const receipt = usingLedger(cwd, (ledger) =>
              addReceipt(ledger, {
                contractId,
                kind: 'manual',
                status: parseStatus(options.status),
                summary: options.summary,
                actor,
              }),
            );
            emit(receipt.id);
          },
        );
      },
    );

  program
    .command('receipt-run')
    .description('Run a command and record its receipt')
    .argument('<contractId>')
    .argument('<command...>')
    .action(async (contractId: string, commandArgs: string[], command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'receipt-run',
          scopeType: 'contract',
          scopeId: contractId,
        },
        async () => {
          const [bin, ...args] = commandArgs;
          if (bin === undefined) {
            throw new Error('receipt-run requires a command');
          }

          const receipt = await usingLedgerAsync(cwd, (ledger) =>
            runCommandReceipt(ledger, {
              contractId,
              command: bin,
              args,
              actor,
            }),
          );
          emit(`${receipt.id} ${receipt.status}`);
        },
      );
    });

  program
    .command('close')
    .description('Attempt contract closeout')
    .argument('<contractId>')
    .action(async (contractId: string, _options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'close',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const result = usingLedger(cwd, (ledger) => closeContract(ledger, { contractId, actor }));
          emit(result.ok ? `${contractId} closed` : `blocked: ${result.problems.join('; ')}`);
        },
      );
    });

  program
    .command('export')
    .description('Export a contract as Markdown')
    .argument('<contractId>')
    .action(async (contractId: string, _options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'export',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const markdown = usingLedger(cwd, (ledger) => {
            const exported = exportContractMarkdown(ledger, contractId);
            recordEvent(ledger, {
              contractId,
              scopeType: 'contract',
              scopeId: contractId,
              actor,
              eventType: 'export_created',
              payload: { format: 'markdown' },
            });
            return exported;
          });
          emit(markdown);
        },
      );
    });

  program
    .command('audit-weak-closeouts')
    .description('Report closed contracts with weak evidence')
    .action(async (_options: unknown, command: Command) => {
      await audited(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'audit-weak-closeouts',
          scopeType: 'audit',
        },
        () => {
          const report = usingLedger(cwd, (ledger) => {
            const generated = weakCloseoutReport(ledger);
            recordEvent(ledger, {
              scopeType: 'audit',
              actor,
              eventType: 'audit_run',
              payload: { report: 'weak-closeouts' },
            });
            return generated;
          });
          emit(report);
        },
      );
    });

  return program;
}

function isCliEntrypoint(moduleUrl: string, argvPath = process.argv[1]): boolean {
  if (argvPath === undefined) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  await createProgram({ argv: process.argv }).parseAsync(process.argv);
}
