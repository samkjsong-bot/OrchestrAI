// src/providers/geminiImageProvider.ts
// Gemini API 키로 이미지 생성. 모델 폴백 체인 + ListModels 동적 발견.
// OAuth CLI 경로로는 안 됨 — API 키 필수.

import * as fs from 'fs'
import * as path from 'path'
import { log } from '../util/log'

// v1beta가 안 되면 v1도 자동 시도
const ENDPOINTS = [
  'https://generativelanguage.googleapis.com/v1beta/models',
  'https://generativelanguage.googleapis.com/v1/models',
] as const
const ENDPOINT_BASE = ENDPOINTS[0]  // ListModels 기본
// 이미지 생성 모델 폴백 체인 — 사용자 계정/지역 등급에 따라 접근 가능 모델이 다름.
// 위에서부터 시도해서 첫 성공 모델 사용. 404·403·400 오면 다음으로.
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',              // 정식 출시명 (사용자 다른 프로그램에서 쓰는 듯)
  'gemini-2.5-flash-image-preview',      // 옛 preview 이름
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'imagen-3.0-generate-002',
  'imagen-3.0-fast-generate-001',
] as const

export interface GeneratedImage {
  mime: string       // e.g. 'image/png'
  bytes: Buffer
  modelUsed?: string // 어떤 모델로 생성됐는지 (UI 표시용)
}

function isModelUnavailable(status: number): boolean {
  // 404: 모델 없음, 403: 권한 없음, 400: 모델 인자 거부 — 다음 모델로 폴백
  return status === 404 || status === 403 || status === 400
}

async function tryOneModel(
  apiKey: string,
  model: string,
  prompt: string,
  endpointBase: string = ENDPOINT_BASE,
): Promise<{ ok: true; img: GeneratedImage } | { ok: false; status: number; err: string }> {
  // Imagen 모델은 다른 요청 형식 (instances/parameters) 사용
  const isImagen = model.startsWith('imagen-')
  const body = isImagen
    ? {
        instances: [{ prompt }],
        parameters: { sampleCount: 1 },
      }
    : {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }
  const url = isImagen
    ? `${endpointBase}/${model}:predict?key=${encodeURIComponent(apiKey)}`
    : `${endpointBase}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    return { ok: false, status: res.status, err: err.slice(0, 200) }
  }
  const data = await res.json() as any
  // Imagen 응답 구조
  if (isImagen) {
    const pred = data?.predictions?.[0]
    if (pred?.bytesBase64Encoded) {
      return {
        ok: true,
        img: {
          mime: pred.mimeType ?? 'image/png',
          bytes: Buffer.from(pred.bytesBase64Encoded, 'base64'),
          modelUsed: model,
        },
      }
    }
    return { ok: false, status: 200, err: `Imagen 응답에 이미지 데이터 없음: ${JSON.stringify(data).slice(0, 200)}` }
  }
  // Gemini 응답 구조
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find(p => p?.inlineData?.data)
  if (!imagePart) {
    const text = parts.find(p => p?.text)?.text
    return { ok: false, status: 200, err: `이미지 데이터 없음: ${text ?? JSON.stringify(data).slice(0, 200)}` }
  }
  return {
    ok: true,
    img: {
      mime: imagePart.inlineData.mimeType ?? 'image/png',
      bytes: Buffer.from(imagePart.inlineData.data, 'base64'),
      modelUsed: model,
    },
  }
}

// 사용자 API 키로 접근 가능한 모델 목록 조회 (v1beta + v1 둘 다)
async function listAvailableModels(apiKey: string): Promise<{ all: string[]; byEndpoint: Record<string, string[]> }> {
  const byEndpoint: Record<string, string[]> = {}
  const all = new Set<string>()
  for (const base of ENDPOINTS) {
    const url = `${base}?key=${encodeURIComponent(apiKey)}&pageSize=200`
    try {
      const res = await fetch(url)
      if (!res.ok) { byEndpoint[base] = []; continue }
      const data = await res.json() as any
      const models: any[] = data?.models ?? []
      const names = models.map(m => String(m?.name ?? '').replace(/^models\//, '')).filter(Boolean)
      byEndpoint[base] = names
      names.forEach(n => all.add(n))
    } catch {
      byEndpoint[base] = []
    }
  }
  return { all: [...all], byEndpoint }
}

// 모델 이름으로 이미지 생성 지원 여부 휴리스틱 추정
function looksLikeImageModel(name: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('imagen-')) return true
  if (n.includes('image-generation')) return true
  if (n.includes('flash-image')) return true
  if (n.includes('image-preview')) return true
  return false
}

export async function generateGeminiImage(apiKey: string, prompt: string): Promise<GeneratedImage> {
  if (!apiKey) throw new Error('Gemini API 키가 없습니다.')
  const errors: string[] = []

  // 0) ListModels 먼저 — 키가 실제 갖고 있는 모델 발견 후 그 중 image 모델만 시도
  const { all: available, byEndpoint } = await listAvailableModels(apiKey)
  log.info('image', `available models (v1beta=${byEndpoint[ENDPOINTS[0]]?.length ?? 0}, v1=${byEndpoint[ENDPOINTS[1]]?.length ?? 0})`)
  const imageOnly = available.filter(looksLikeImageModel)
  if (imageOnly.length > 0) {
    log.info('image', `image-capable models found: ${imageOnly.join(', ')}`)
  }

  // 모델 시도 순서: 발견된 image 모델 우선 → 정적 폴백 체인
  const tryOrder = [...new Set([...imageOnly, ...IMAGE_MODELS])]

  for (const model of tryOrder) {
    // 이 모델이 어느 endpoint에 있는지 찾아서 거기로 호출. 둘 다 없으면 v1beta로 시도
    const baseList = ENDPOINTS.filter(b => byEndpoint[b]?.includes(model))
    const bases = baseList.length > 0 ? baseList : [ENDPOINTS[0]]
    for (const base of bases) {
      const r = await tryOneModel(apiKey, model, prompt, base)
      if (r.ok) {
        log.info('image', `success: ${model} via ${base.includes('v1beta') ? 'v1beta' : 'v1'}`)
        return r.img
      }
      const tag = `${model} (${base.includes('v1beta') ? 'v1beta' : 'v1'}, ${r.status})`
      errors.push(tag)
      log.warn('image', `${tag}: ${r.err.slice(0, 150)}`)
      if (!isModelUnavailable(r.status)) {
        // 200인데 응답에 이미지 데이터 없는 케이스 (safety 필터, 등) — 즉시 throw
        throw new Error(`Gemini 이미지 생성 실패 (${model}): ${r.err}`)
      }
    }
  }

  // 다 실패 — 정확히 진단
  let diagnosis = ''
  if (available.length === 0) {
    diagnosis = 'ListModels 실패 — API 키 잘못됐거나 Generative Language API 비활성.'
  } else if (imageOnly.length === 0) {
    diagnosis =
      `이 API 키로 발견된 이미지 모델 0개 (텍스트 ${available.length}개만). ` +
      `Output 채널 [image] 로그에 전체 모델 목록 찍었어요. ` +
      `다른 프로그램에서 같은 키로 이미지 만든다면 그 프로그램이 어떤 모델 ID 쓰는지 알려주시면 추가합니다.`
  } else {
    diagnosis = `발견된 이미지 모델 ${imageOnly.length}개 모두 호출 실패: ${imageOnly.join(', ')}`
  }

  log.warn('image', `all models exhausted. available=${available.join(', ')}`)
  throw new Error(
    `이미지 생성 실패. ${diagnosis}\n시도한 모델:\n` + errors.map(e => `  • ${e}`).join('\n')
  )
}

// 워크스페이스 내부 안전한 경로에 저장
export async function saveImageToWorkspace(
  img: GeneratedImage,
  workspaceRoot: string,
  relativePath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const cleaned = relativePath.replace(/^[\\/]+/, '').replace(/\\/g, '/')
  const target = path.resolve(workspaceRoot, cleaned)
  const rel = path.relative(workspaceRoot, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`워크스페이스 밖 경로 거부: ${relativePath}`)
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, img.bytes)
  return { absolutePath: target, relativePath: cleaned }
}
