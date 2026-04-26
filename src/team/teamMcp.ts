// src/team/teamMcp.ts
// Claude(architect)가 team 모드에서 동료를 부를 때 쓰는 SDK MCP 툴 모음.
// - consult_codex(task): Codex(GPT-5)한테 코드 작성 위임. Codex는 워크스페이스 툴(Read/Write/Edit/Bash) 사용.
// - consult_gemini(question): Gemini한테 질문/요약/긴문서 분석 위임 (텍스트, 무료 OAuth 경로).
// - generate_image(prompt, save_to): Gemini API로 이미지 생성 후 워크스페이스에 저장.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { generateGeminiImage, saveImageToWorkspace } from '../providers/geminiImageProvider'
import { log } from '../util/log'

export interface TeamMcpContext {
  codexToken?: string
  codexAccountId?: string
  geminiAvailable: boolean   // OAuth CLI 로그인 여부
  geminiApiKey?: string      // 이미지 생성용 (없으면 generate_image 비활성)
  workspacePath: string
  // Hub UI에 진행상황 보여주기 위한 콜백
  onActivity?: (text: string) => void
  // ★ Codex/Gemini를 실제 에이전트 루프로 돌리는 콜백 (provider가 주입)
  // 이게 있으면 consult_codex/consult_gemini가 진짜 툴 호출(파일 수정 등)까지 함
  runCodexAgent?: (task: string) => Promise<{ content: string; inputTokens: number; outputTokens: number }>
  runGeminiAgent?: (task: string) => Promise<{ content: string; inputTokens: number; outputTokens: number }>
}

export function buildTeamMcpServer(ctx: TeamMcpContext) {
  const activity = (text: string) => {
    log.info('team', text)
    ctx.onActivity?.(text)
  }

  return createSdkMcpServer({
    name: 'orchestrai-team',
    version: '1.0.0',
    tools: [
      tool(
        'consult_codex',
        'Delegate a coding task to Codex (OpenAI GPT-5). Codex runs a FULL agent loop with workspace tools (read_file/write_file/replace_in_file/list_files/mcp) and ACTUALLY modifies files. Use for: writing code, implementing features, fixing bugs, generating boilerplate. Pass a CONCRETE task with file paths + requirements + acceptance criteria. Returns Codex\'s summary after files are written.',
        {
          task: z.string().describe('Specific coding task with file paths, requirements, and acceptance criteria'),
        },
        async ({ task }) => {
          if (!ctx.runCodexAgent) {
            return { content: [{ type: 'text' as const, text: 'ERROR: Codex agent runner not wired. Single-shot fallback would not write files.' }] }
          }
          activity(`📤 → Codex: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`)
          try {
            const result = await ctx.runCodexAgent(task)
            activity(`📥 ← Codex (${result.outputTokens} tok)`)
            return { content: [{ type: 'text' as const, text: result.content }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            activity(`❌ Codex 실패: ${msg}`)
            return { content: [{ type: 'text' as const, text: `Codex error: ${msg}` }] }
          }
        },
      ),

      tool(
        'consult_gemini',
        'Delegate to Gemini for: long-context analysis (whole codebase scan), summarization, quick lookups. Runs FULL agent loop — can read/write files too. Uses Google free tier. NOT for image generation (use generate_image).',
        {
          question: z.string().describe('Focused question or task'),
        },
        async ({ question }) => {
          if (!ctx.runGeminiAgent) {
            return { content: [{ type: 'text' as const, text: 'ERROR: Gemini agent runner not wired.' }] }
          }
          activity(`📤 → Gemini: ${question.slice(0, 120)}${question.length > 120 ? '…' : ''}`)
          try {
            const result = await ctx.runGeminiAgent(question)
            activity(`📥 ← Gemini (${result.outputTokens} tok)`)
            return { content: [{ type: 'text' as const, text: result.content }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            activity(`❌ Gemini 실패: ${msg}`)
            return { content: [{ type: 'text' as const, text: `Gemini error: ${msg}` }] }
          }
        },
      ),

      tool(
        'generate_image',
        'Generate an image with Gemini and save it inside the workspace. Use for: cover images, mockups, icons, illustrations. Returns the saved file path. Requires Gemini API key (separate from OAuth).',
        {
          prompt: z.string().describe('Detailed image description (style, content, mood)'),
          save_to: z.string().describe('Workspace-relative save path including extension (e.g. "public/cover.png")'),
        },
        async ({ prompt, save_to }) => {
          if (!ctx.geminiApiKey) {
            return { content: [{ type: 'text' as const, text: 'ERROR: Gemini API key not registered. User must register it via Settings → Gemini API key.' }] }
          }
          activity(`🎨 → image: ${prompt.slice(0, 100)}…`)
          try {
            const img = await generateGeminiImage(ctx.geminiApiKey, prompt)
            const saved = await saveImageToWorkspace(img, ctx.workspacePath, save_to)
            activity(`🖼 ← saved: ${saved.relativePath}`)
            return {
              content: [{
                type: 'text' as const,
                text: `Image saved to ${saved.relativePath} (${img.bytes.length} bytes, ${img.mime}).`,
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            activity(`❌ image 실패: ${msg}`)
            return { content: [{ type: 'text' as const, text: `Image generation error: ${msg}` }] }
          }
        },
      ),
    ],
  })
}
