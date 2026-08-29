/** 把 /api/assets/xxx 形式的 URL 转成相对 dataDir 的路径（assets/xxx），用于写进请求 JSON */
export function assetUrlToPath(src: string | null | undefined): string | null {
  if (!src) return null
  const m = src.match(/^\/api\/(assets\/.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

/** 提交 AI 请求，失败时抛出带服务器错误信息的 Error */
export async function postAiRequest(body: Record<string, unknown>): Promise<{ ok: boolean; id: string }> {
  const res = await fetch('/api/ai-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '提交失败')
  return data
}
