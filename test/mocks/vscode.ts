// vitest용 vscode 모듈 stub — 단위 테스트만 돌리는 용도
export const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({ get: () => undefined }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
}
export const window = {
  showInformationMessage: () => undefined,
  showWarningMessage: () => undefined,
  showErrorMessage: () => undefined,
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    show: () => {},
    clear: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: '',
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
}
export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
  parse: (s: string) => ({ fsPath: s, toString: () => s }),
}
export const commands = { executeCommand: () => undefined, registerCommand: () => ({ dispose: () => {} }) }
export const env = { language: 'en' }
export const StatusBarAlignment = { Right: 2, Left: 1 }
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
export const ProgressLocation = { Notification: 15, Window: 10 }
export default {}
