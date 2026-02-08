import { PackwerkOutput } from './packwerkOutput';

export function parseOutput(str: string): PackwerkOutput {
  return JSON.parse(str);
}
