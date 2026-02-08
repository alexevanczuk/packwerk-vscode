import * as vs from 'vscode';
import { Packwerk } from './packwerk';

export interface PackwerkConfig {
  executable: string;
  onSave: boolean;
}

/**
 * Read the workspace configuration for 'ruby.pks' and return a PackwerkConfig.
 * @return {PackwerkConfig} config object
 */
export const getConfig: () => PackwerkConfig = () => {
  const conf = vs.workspace.getConfiguration('ruby.pks');
  let executable = conf.get('executable', 'pks check');

  return {
    executable,
    onSave: conf.get('onSave', true),
  };
};

export const onDidChangeConfiguration: (packwerk: Packwerk) => () => void = (
  packwerk
) => {
  return () => (packwerk.config = getConfig());
};
