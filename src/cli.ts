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
