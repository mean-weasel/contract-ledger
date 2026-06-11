#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const cliVersion = '0.1.0';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('contract')
    .description('SQLite-backed local contract ledger')
    .version(cliVersion);

  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      const writeOut =
        program.configureOutput().writeOut ?? process.stdout.write.bind(process.stdout);
      writeOut(`${cliVersion}\n`);
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
  await createProgram().parseAsync(process.argv);
}
