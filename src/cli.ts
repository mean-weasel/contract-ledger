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
import {
  getContractSnapshot,
  getNextActionReport,
  listAuditLog,
  listContractStatuses,
} from './contracts/views.js';
import {
  getExplicitLedgerPaths,
  getGlobalLedgerPaths,
  getWorkspacePaths,
  type WorkspacePaths,
} from './core/fs.js';
import {
  addCriterion,
  updateCriterionStatus,
  type CriterionStatus,
} from './criteria/criteria.js';
import { openLedger, type Ledger } from './db/connection.js';
import { exportContractMarkdown } from './exports/markdown.js';
import {
  addFailureMode,
  listFailureModes,
  resolveFailureMode,
  type FailureModeResolutionStatus,
} from './failure-modes/failure-modes.js';
import { addReceipt, runCommandReceipt, type ReceiptStatus } from './receipts/receipts.js';
import { installContractLedgerSkill } from './skills/install.js';
import { addTodo } from './todos/todos.js';
import {
  addVerifier,
  getAdapterByNameOrId,
  listAdapters,
  listProfiles,
  registerAdapter,
} from './verifiers/verifiers.js';

const cliVersion = '0.1.6';

export type ProgramDeps = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  actor?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  argv?: string[];
};

type LedgerMode = 'workspace' | 'global' | 'explicit';

type LedgerTarget = {
  cwd: string;
  mode: LedgerMode;
  paths: WorkspacePaths;
};

type AuditedInput = {
  cwd: string;
  ledgerTarget: LedgerTarget;
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

function hasChildCommandSeparator(
  argv: string[],
  subcommand: string,
  argsBeforeSeparator: number,
): boolean {
  const commandIndex = argv.indexOf(subcommand);

  return commandIndex >= 0 && argv[commandIndex + argsBeforeSeparator + 1] === '--';
}

function assertChildCommandSeparator(
  argv: string[],
  subcommand: string,
  argsBeforeSeparator: number,
  usage: string,
): void {
  if (!hasChildCommandSeparator(argv, subcommand, argsBeforeSeparator)) {
    throw new Error(`${subcommand} requires "--" before the child command: ${usage}`);
  }
}

function assertReceiptRunSeparator(argv: string[]): void {
  const commandIndex = argv.indexOf('receipt-run');
  if (commandIndex < 0) {
    throw new Error('receipt-run requires "--" before the child command: receipt-run <contractId> [options] -- <command...>');
  }

  for (let index = commandIndex + 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--') {
      return;
    }

    if (item === '--criterion' || item === '--verifier') {
      index += 1;
      continue;
    }

    throw new Error(
      'receipt-run requires "--" before the child command: receipt-run <contractId> [options] -- <command...>',
    );
  }

  throw new Error(
    'receipt-run requires "--" before the child command: receipt-run <contractId> [options] -- <command...>',
  );
}

function parseStatus(status: string): ReceiptStatus {
  if (status === 'pass' || status === 'fail' || status === 'inconclusive') {
    return status;
  }

  throw new Error(`Invalid receipt status: ${status}`);
}

function parseCriterionStatus(status: string): CriterionStatus {
  if (
    status === 'pending' ||
    status === 'satisfied' ||
    status === 'deferred' ||
    status === 'rejected'
  ) {
    return status;
  }

  throw new Error(`Invalid criterion status: ${status}`);
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

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveLedgerTarget(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
  options: {
    globalLedger?: boolean;
    ledgerPath?: string;
  };
}): LedgerTarget {
  const explicitLedgerPath = input.options.ledgerPath ?? input.env.CONTRACT_LEDGER_PATH;

  if (explicitLedgerPath !== undefined && explicitLedgerPath.length > 0) {
    return {
      cwd: input.cwd,
      mode: 'explicit',
      paths: getExplicitLedgerPaths(explicitLedgerPath),
    };
  }

  if (input.options.globalLedger === true || input.env.CONTRACT_LEDGER_SCOPE === 'global') {
    return {
      cwd: input.cwd,
      mode: 'global',
      paths: getGlobalLedgerPaths(input.homeDir),
    };
  }

  return {
    cwd: input.cwd,
    mode: 'workspace',
    paths: getWorkspacePaths(input.cwd),
  };
}

function usingLedger<T>(target: LedgerTarget, fn: (ledger: Ledger) => T): T {
  const ledger = openLedger({ cwd: target.cwd, paths: target.paths });

  try {
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

async function usingLedgerAsync<T>(target: LedgerTarget, fn: (ledger: Ledger) => Promise<T>): Promise<T> {
  const ledger = openLedger({ cwd: target.cwd, paths: target.paths });

  try {
    return await fn(ledger);
  } finally {
    ledger.close();
  }
}

async function audited<T>(input: AuditedInput, fn: () => T | Promise<T>): Promise<T> {
  const contractId = input.contractId ?? (input.scopeType === 'contract' ? input.scopeId : undefined);
  let invocationId = '';

  usingLedger(input.ledgerTarget, (ledger) => {
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
        ledgerMode: input.ledgerTarget.mode,
        ledgerPath: input.ledgerTarget.paths.ledgerPath,
      },
    });
  });

  try {
    const result = await withAuditContext(invocationId, fn);

    usingLedger(input.ledgerTarget, (ledger) => {
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
    usingLedger(input.ledgerTarget, (ledger) => {
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
  const env = deps.env ?? process.env;
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
  const ledgerTarget = () =>
    resolveLedgerTarget({
      cwd,
      env,
      homeDir: deps.homeDir,
      options: program.opts() as { globalLedger?: boolean; ledgerPath?: string },
    });
  const auditedInLedger = <T>(
    input: Omit<AuditedInput, 'ledgerTarget'>,
    fn: () => T | Promise<T>,
  ): Promise<T> =>
    audited(
      {
        ...input,
        ledgerTarget: ledgerTarget(),
      },
      fn,
    );

  program
    .name('contract')
    .description('SQLite-backed local contract ledger')
    .version(cliVersion)
    .option('--global-ledger', 'Use the global ledger at ~/.contract-ledger/ledger.sqlite')
    .option('--ledger-path <path>', 'Use an explicit SQLite ledger file path');

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
    .command('ledger-info')
    .description('Show which ledger this invocation will use')
    .action(async () => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'ledger-info',
          scopeType: 'workspace',
        },
        () => {
          const target = ledgerTarget();
          emit(
            JSON.stringify(
              {
                mode: target.mode,
                cwd: target.cwd,
                ledgerPath: target.paths.ledgerPath,
                contractsDir: target.paths.contractsDir,
                artifactsDir: target.paths.artifactsDir,
                exportsDir: target.paths.exportsDir,
              },
              null,
              2,
            ),
          );
        },
      );
    });

  program
    .command('skill-install')
    .description('Install the bundled Contract Ledger Codex skill')
    .option('--target-dir <path>', 'Directory that should contain the installed SKILL.md')
    .option('--overwrite', 'Overwrite an existing installed skill')
    .action(
      async (options: {
        targetDir?: string;
        overwrite?: boolean;
      }) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'skill-install',
            scopeType: 'skill',
          },
          () => {
            const result = installContractLedgerSkill({
              targetDir: options.targetDir,
              overwrite: options.overwrite === true,
            });

            usingLedger(ledgerTarget(), (ledger) => {
              recordEvent(ledger, {
                scopeType: 'skill',
                scopeId: 'contract-ledger',
                actor,
                eventType: result.installed ? 'skill_installed' : 'skill_install_skipped',
                payload: {
                  targetPath: result.targetPath,
                  sourcePath: result.sourcePath,
                  overwrite: options.overwrite === true,
                },
              });
            });

            emit(result.installed ? `installed ${result.targetPath}` : `exists ${result.targetPath}`);
          },
        );
      },
    );

  program
    .command('init')
    .description('Create a draft contract')
    .argument('<title>')
    .requiredOption('--intent <intent>', 'Contract intent')
    .option('--scope <scope>', 'Contract scope', '')
    .action(
      async (
        title: string,
        options: {
          intent: string;
          scope: string;
        },
        command: Command,
      ) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'init',
            scopeType: 'contract',
          },
          () => {
            const contract = usingLedger(ledgerTarget(), (ledger) =>
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
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'accept',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const contract = usingLedger(ledgerTarget(), (ledger) => acceptContract(ledger, { contractId, actor }));
          emit(`${contract.id} ${contract.status}`);
        },
      );
    });

  program
    .command('show')
    .description('Show a contract with criteria, todos, verifiers, failure modes, receipts, and closeout problems')
    .argument('<contractId>')
    .action(async (contractId: string) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'show',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), (ledger) => getContractSnapshot(ledger, contractId)), null, 2));
        },
      );
    });

  program
    .command('status')
    .description('Show contract status summaries')
    .argument('[contractId]')
    .action(async (contractId: string | undefined) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'status',
          scopeType: contractId === undefined ? 'workspace' : 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), (ledger) => listContractStatuses(ledger, contractId)), null, 2));
        },
      );
    });

  program
    .command('next')
    .description('Show the next actions needed before closeout')
    .argument('<contractId>')
    .action(async (contractId: string) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'next',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), (ledger) => getNextActionReport(ledger, contractId)), null, 2));
        },
      );
    });

  program
    .command('audit-log')
    .description('Show audit events for a contract or workspace')
    .argument('[contractId]')
    .action(async (contractId: string | undefined) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'audit-log',
          scopeType: contractId === undefined ? 'workspace' : 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), (ledger) => listAuditLog(ledger, contractId)), null, 2));
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
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'criteria-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const criterion = usingLedger(ledgerTarget(), (ledger) =>
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
    .command('criteria-set-status')
    .description('Set an acceptance criterion status')
    .argument('<criterionId>')
    .requiredOption('--status <status>', 'pending, satisfied, deferred, or rejected')
    .option('--rationale <rationale>', 'Rationale for deferred or rejected criteria')
    .option('--residual-risk <risk>', 'Residual risk for deferred or rejected criteria')
    .action(
      async (
        criterionId: string,
        options: {
          status: string;
          rationale?: string;
          residualRisk?: string;
        },
        command: Command,
      ) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'criteria-set-status',
            scopeType: 'criterion',
            scopeId: criterionId,
          },
          () => {
            const criterion = usingLedger(ledgerTarget(), (ledger) =>
              updateCriterionStatus(ledger, {
                id: criterionId,
                status: parseCriterionStatus(options.status),
                rationale: options.rationale,
                residualRisk: options.residualRisk,
                actor,
              }),
            );
            emit(`${criterion.id} ${criterion.status}`);
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
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'todo-add',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const todo = usingLedger(ledgerTarget(), (ledger) => addTodo(ledger, { contractId, title, actor }));
          emit(todo.id);
        },
      );
    });

  program
    .command('verifier-add-command')
    .description('Add a command verifier')
    .allowUnknownOption(true)
    .argument('<contractId>')
    .argument('<name>')
    .argument('[command...]')
    .action(
      async (
        contractId: string,
        name: string,
        commandArgs: string[] | undefined,
        command: Command,
      ) => {
        const argv = getInvocationArgv(deps, program);
        await auditedInLedger(
          {
            cwd,
            actor,
            argv,
            subcommand: 'verifier-add-command',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            assertChildCommandSeparator(
              argv,
              'verifier-add-command',
              2,
              'verifier-add-command <contractId> <name> -- <command...>',
            );
            if (commandArgs === undefined || commandArgs.length === 0) {
              throw new Error('verifier-add-command requires a command');
            }
            const verifier = usingLedger(ledgerTarget(), (ledger) =>
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
    .command('adapter-add')
    .description('Register or update a verifier adapter')
    .argument('<name>')
    .requiredOption('--kind <kind>', 'Adapter kind, such as command, visual, browser, or coverage')
    .option('--adapter-version <version>', 'Adapter definition version', '1')
    .option('--status <status>', 'Adapter status', 'active')
    .option('--source-type <type>', 'Adapter source type, such as builtin, npm, github, local, binary, docker, python, go, mcp, or manual', '')
    .option('--source-name <name>', 'Adapter source name, package name, binary name, repo name, or plugin name', '')
    .option('--source-version <version>', 'Adapter source version or version range', '')
    .option('--source-url <url>', 'Adapter source URL', '')
    .option('--repo-url <url>', 'Adapter repository URL', '')
    .option('--docs-url <url>', 'Adapter documentation URL', '')
    .option('--homepage-url <url>', 'Adapter homepage URL', '')
    .option('--registry-url <url>', 'Adapter registry or package listing URL', '')
    .option('--skill-refs-json <json>', 'Optional skill references JSON array', '[]')
    .option('--config-schema-json <json>', 'Adapter config schema JSON', '{}')
    .option('--artifact-patterns-json <json>', 'Adapter artifact patterns JSON array', '[]')
    .option('--receipt-mapper-json <json>', 'Adapter receipt mapper JSON', '{}')
    .option('--requires-judgment', 'Mark receipts from this adapter as requiring judgment')
    .action(
      async (
        name: string,
        options: {
          kind: string;
          adapterVersion: string;
          status: string;
          sourceType: string;
          sourceName: string;
          sourceVersion: string;
          sourceUrl: string;
          repoUrl: string;
          docsUrl: string;
          homepageUrl: string;
          registryUrl: string;
          skillRefsJson: string;
          configSchemaJson: string;
          artifactPatternsJson: string;
          receiptMapperJson: string;
          requiresJudgment?: boolean;
        },
      ) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'adapter-add',
            scopeType: 'adapter',
          },
          () => {
            const adapter = usingLedger(ledgerTarget(), (ledger) =>
              registerAdapter(ledger, {
                name,
                version: options.adapterVersion,
                kind: options.kind,
                status: options.status,
                sourceType: options.sourceType,
                sourceName: options.sourceName,
                sourceVersion: options.sourceVersion,
                sourceUrl: options.sourceUrl,
                repoUrl: options.repoUrl,
                docsUrl: options.docsUrl,
                homepageUrl: options.homepageUrl,
                registryUrl: options.registryUrl,
                configSchema: parseJsonOption(options.configSchemaJson, '--config-schema-json'),
                artifactPatterns: parseJsonOption(options.artifactPatternsJson, '--artifact-patterns-json'),
                receiptMapper: parseJsonOption(options.receiptMapperJson, '--receipt-mapper-json'),
                skillRefs: parseJsonOption(options.skillRefsJson, '--skill-refs-json'),
                requiresJudgment: options.requiresJudgment === true,
                actor,
              }),
            );
            emit(adapter.id);
          },
        );
      },
    );

  program
    .command('verifier-add-adapter')
    .description('Add a verifier using a registered adapter')
    .argument('<contractId>')
    .argument('<adapter>')
    .argument('<name>')
    .requiredOption('--config-json <json>', 'Verifier config JSON')
    .option('--criterion <criterionId>', 'Criterion this verifier proves')
    .option('--optional', 'Do not require this verifier for closeout')
    .action(
      async (
        contractId: string,
        adapterNameOrId: string,
        name: string,
        options: {
          configJson: string;
          criterion?: string;
          optional?: boolean;
        },
      ) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'verifier-add-adapter',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const verifier = usingLedger(ledgerTarget(), (ledger) => {
              const adapter = getAdapterByNameOrId(ledger, adapterNameOrId);
              if (adapter === undefined) {
                throw new Error(`Adapter not found: ${adapterNameOrId}`);
              }

              return addVerifier(ledger, {
                contractId,
                criterionId: options.criterion,
                adapterId: adapter.id,
                name,
                kind: adapter.kind,
                config: parseJsonOption(options.configJson, '--config-json'),
                required: options.optional !== true,
                actor,
              });
            });
            emit(verifier.id);
          },
        );
      },
    );

  program
    .command('adapter-list')
    .description('List verifier adapters')
    .action(async (_options: unknown, command: Command) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'adapter-list',
          scopeType: 'adapter',
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), listAdapters), null, 2));
        },
      );
    });

  program
    .command('profile-list')
    .description('List acceptance profiles')
    .action(async (_options: unknown, command: Command) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'profile-list',
          scopeType: 'profile',
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), listProfiles), null, 2));
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
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'failure-modes-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const item = usingLedger(ledgerTarget(), (ledger) =>
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
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'failure-modes-list',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          emit(JSON.stringify(usingLedger(ledgerTarget(), (ledger) => listFailureModes(ledger, contractId)), null, 2));
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
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'failure-modes-resolve',
            scopeType: 'failure_mode',
            scopeId: failureModeId,
          },
          () => {
            usingLedger(ledgerTarget(), (ledger) =>
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
    .option('--criterion <criterionId>', 'Criterion proven by this receipt')
    .option('--verifier <verifierId>', 'Verifier proven by this receipt')
    .action(
      async (
        contractId: string,
        options: {
          summary: string;
          status: string;
          criterion?: string;
          verifier?: string;
        },
        command: Command,
      ) => {
        await auditedInLedger(
          {
            cwd,
            actor,
            argv: getInvocationArgv(deps, program),
            subcommand: 'receipt-add',
            scopeType: 'contract',
            scopeId: contractId,
          },
          () => {
            const receipt = usingLedger(ledgerTarget(), (ledger) =>
              addReceipt(ledger, {
                contractId,
                criterionId: options.criterion,
                verifierId: options.verifier,
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
    .allowUnknownOption(true)
    .argument('<contractId>')
    .option('--criterion <criterionId>', 'Criterion proven by this receipt')
    .option('--verifier <verifierId>', 'Verifier proven by this receipt')
    .argument('[command...]')
    .action(async (
      contractId: string,
      commandArgs: string[] | undefined,
      options: { criterion?: string; verifier?: string },
    ) => {
      const argv = getInvocationArgv(deps, program);
      await auditedInLedger(
        {
          cwd,
          actor,
          argv,
          subcommand: 'receipt-run',
          scopeType: 'contract',
          scopeId: contractId,
        },
        async () => {
          assertReceiptRunSeparator(argv);
          const [bin, ...args] = commandArgs ?? [];
          if (bin === undefined) {
            throw new Error('receipt-run requires a command');
          }

          const receipt = await usingLedgerAsync(ledgerTarget(), (ledger) =>
            runCommandReceipt(ledger, {
              contractId,
              criterionId: options.criterion,
              verifierId: options.verifier,
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
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'close',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const result = usingLedger(ledgerTarget(), (ledger) => closeContract(ledger, { contractId, actor }));
          if (!result.ok) {
            const message = `blocked: ${result.problems.join('; ')}`;
            emit(message);
            throw new Error(message);
          }

          emit(`${contractId} closed`);
        },
      );
    });

  program
    .command('export')
    .description('Export a contract as Markdown')
    .argument('<contractId>')
    .action(async (contractId: string, _options: unknown, command: Command) => {
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'export',
          scopeType: 'contract',
          scopeId: contractId,
        },
        () => {
          const markdown = usingLedger(ledgerTarget(), (ledger) => {
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
      await auditedInLedger(
        {
          cwd,
          actor,
          argv: getInvocationArgv(deps, program),
          subcommand: 'audit-weak-closeouts',
          scopeType: 'audit',
        },
        () => {
          const report = usingLedger(ledgerTarget(), (ledger) => {
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
