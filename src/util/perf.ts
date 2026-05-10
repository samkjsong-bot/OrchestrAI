// src/util/perf.ts
// 핵심 함수의 실행 시간 누적 측정. 사용자가 /perf 명령으로 통계 확인.
// 절대 production 트래픽 차단 안 함 — 단순 측정 + 출력만.

interface Metric {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
}

const _metrics = new Map<string, Metric>()

export function record(name: string, durationMs: number): void {
  const m = _metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 }
  m.count++
  m.totalMs += durationMs
  m.maxMs = Math.max(m.maxMs, durationMs)
  m.lastMs = durationMs
  _metrics.set(name, m)
}

// 동기/비동기 함수 wrap — 자동 측정
export function timed<T>(name: string, fn: () => T): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    record(name, performance.now() - start)
  }
}

export async function timedAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    record(name, performance.now() - start)
  }
}

export function getMetrics(): Array<{ name: string; count: number; avgMs: number; totalMs: number; maxMs: number; lastMs: number }> {
  return [..._metrics.entries()]
    .map(([name, m]) => ({
      name,
      count: m.count,
      avgMs: m.count > 0 ? m.totalMs / m.count : 0,
      totalMs: m.totalMs,
      maxMs: m.maxMs,
      lastMs: m.lastMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

export function reset(): void {
  _metrics.clear()
}

// 사용자 표시용 markdown 포맷
export function formatReport(): string {
  const m = getMetrics()
  if (m.length === 0) return '_(no perf data — 사용 후 다시 시도)_'
  const fmt = (n: number) => n < 1 ? `${(n * 1000).toFixed(0)}μs` : n < 1000 ? `${n.toFixed(1)}ms` : `${(n / 1000).toFixed(2)}s`
  const lines = ['| Function | Count | Avg | Max | Last | Total |', '|---|---|---|---|---|---|']
  for (const x of m) {
    lines.push(`| \`${x.name}\` | ${x.count} | ${fmt(x.avgMs)} | ${fmt(x.maxMs)} | ${fmt(x.lastMs)} | ${fmt(x.totalMs)} |`)
  }
  return lines.join('\n')
}
