import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  it('registers the contract CLI name', () => {
    const program = createProgram();
    expect(program.name()).toBe('contract');
  });
});
