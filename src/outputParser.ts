import { PksOutput } from './pksOutput';

export function parseOutput(str: string): PksOutput {
  return JSON.parse(str);
}
