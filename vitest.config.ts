import { defineConfig } from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // vscode + Claude SDK 등 런타임 의존성 — 단위 테스트에선 mock으로 stub
    alias: {
      vscode: path.resolve(__dirname, 'test/mocks/vscode.ts'),
      '@anthropic-ai/claude-agent-sdk': path.resolve(__dirname, 'test/mocks/claude-sdk.ts'),
    },
  },
})
