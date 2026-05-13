// src/context/secretScanner.ts
// directive 13절 — 컨텍스트 모으기 전 secret 파일/내용 차단.
// Phase 1: 파일명 + 내용 정규식 휴리스틱. 정교한 entropy-based 는 Phase 2+.

import * as path from 'path'

const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|[\\/])\.env(\..+)?$/i,
  /(^|[\\/])\.npmrc$/i,
  /(^|[\\/])\.pypirc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /(^|[\\/])id_rsa(\.pub)?$/i,
  /(^|[\\/])id_ed25519(\.pub)?$/i,
  /(^|[\\/])id_ecdsa(\.pub)?$/i,
  /(^|[\\/])secrets?(\.local)?\.json$/i,
  /(^|[\\/])credentials\.json$/i,
  /(^|[\\/])service-account.*\.json$/i,
  /(^|[\\/])\.aws[\\/]credentials$/i,
  /(^|[\\/])\.ssh[\\/]/i,
  /(^|[\\/])known_hosts$/i,
]

// 명백한 키 prefix — 파일 안 내용 스캔용 (Phase 1 은 보수적으로 짧은 목록).
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/,                   // OpenAI
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,             // Anthropic
  /\bAIza[A-Za-z0-9_-]{30,}\b/,                // Google API key
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,          // Slack
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,                      // AWS access key id
]

// 기본 제외 경로 — directive 13절. lock 파일, dist 등 큰 generated 파일.
const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  /(^|[\\/])node_modules[\\/]/i,
  /(^|[\\/])dist[\\/]/i,
  /(^|[\\/])build[\\/]/i,
  /(^|[\\/])coverage[\\/]/i,
  /(^|[\\/])\.next[\\/]/i,
  /(^|[\\/])\.git[\\/]/i,
  /(^|[\\/])out[\\/]/i,
  /(^|[\\/])\.cache[\\/]/i,
  /\.lock$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /\.min\.js$/i,
  /\.map$/i,
]

/** 파일 경로가 secret 후보면 true. */
export function isSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return SECRET_PATH_PATTERNS.some(re => re.test(normalized))
}

/** 파일 경로가 기본 ignore 대상이면 true (secret 아님, 단순 ignore). */
export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return DEFAULT_IGNORE_PATTERNS.some(re => re.test(normalized))
}

/** 텍스트 안에 명백한 secret value 가 있으면 true. */
export function containsSecretValue(text: string | undefined | null): boolean {
  if (!text) return false
  return SECRET_VALUE_PATTERNS.some(re => re.test(text))
}

export interface ScanResult {
  blockedFiles: string[]   // secret 의심 (보내지 않음)
  ignoredFiles: string[]   // 단순 ignore (보내지 않음)
  warnings: string[]
  hasSecretContent: boolean // 일반 코드 텍스트에서 secret 값 발견
}

/** 후보 파일 목록 + 본문 텍스트 받아서 분류. */
export function scanCandidates(args: {
  filePaths?: string[]
  inlineText?: string  // selectedText / focusedSnippet / 등 합쳐서 한 번에
}): ScanResult {
  const result: ScanResult = {
    blockedFiles: [], ignoredFiles: [], warnings: [], hasSecretContent: false,
  }
  for (const fp of args.filePaths ?? []) {
    const base = path.basename(fp)
    if (isSecretPath(fp)) {
      result.blockedFiles.push(fp)
      result.warnings.push(`Excluded ${base} — potential secret file`)
    } else if (isIgnoredPath(fp)) {
      result.ignoredFiles.push(fp)
    }
  }
  if (args.inlineText && containsSecretValue(args.inlineText)) {
    result.hasSecretContent = true
    result.warnings.push('Inline text contains a possible API key / private key pattern — review before sending in Full mode')
  }
  return result
}
