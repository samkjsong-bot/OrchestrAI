// vitest용 vscode 모듈 stub — patternRouter/orchestrator 단위 테스트만 돌리는 용도
export const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({ get: () => undefined }),
}
export const window = {
  showInformationMessage: () => undefined,
  showWarningMessage: () => undefined,
}
export const Uri = { file: (p: string) => ({ fsPath: p }) }
export const commands = { executeCommand: () => undefined }
export default {}
