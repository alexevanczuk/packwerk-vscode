import * as vs from 'vscode';
import { Pks } from './pks';

export interface PksConfig {
  executable: string;
  onSave: boolean;
}

/**
 * Read the workspace configuration for 'ruby.pks' and return a PksConfig.
 * @return {PksConfig} config object
 */
export const getConfig: () => PksConfig = () => {
  const conf = vs.workspace.getConfiguration('ruby.pks');
  let executable = conf.get('executable', 'pks check');

  return {
    executable,
    onSave: conf.get('onSave', true),
  };
};

export const onDidChangeConfiguration: (pks: Pks) => () => void = (
  pks
) => {
  return () => (pks.config = getConfig());
};
