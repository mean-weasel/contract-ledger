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
