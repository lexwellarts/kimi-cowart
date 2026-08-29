import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createShapeId,
  Editor,
  Tldraw,
  toRichText,
  useValue,
  type TLAssetStore,
  type TLGeoShape,
  type TLImageShape,
} from 'tldraw'
import 'tldraw/tldraw.css'
import './app.css'
import { usePersistence } from './lib/usePersistence'
import { assetUrlToPath, postAiRequest } from './lib/api'
import { AiFramePanel } from './components/AiFramePanel'

const AI_FRAME_W = 512
const AI_FRAME_H = 512
const POLL_REQUESTS_MS = 4000

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  usePersistence(editor)

  // 拖入/粘贴的图片经 API 落到 canvas/assets/，画布引用 /api/assets/ URL
  const assetStore = useMemo<TLAssetStore>(
    () => ({
      async upload(_asset, file) {
        const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name || 'image.png')}`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '图片上传失败')
        return { src: data.url as string }
      },
      async resolve(asset) {
        return (asset.props as { src?: string }).src ?? null
      },
    }),
    []
  )

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const refreshPending = useCallback(async () => {
    try {
      const res = await fetch('/api/requests')
      const data = await res.json()
      const list = (data.requests ?? []) as { status?: string }[]
      setPendingCount(list.filter(r => r.status === 'pending').length)
    } catch {
      /* 离线时保持原值 */
    }
  }, [])

  useEffect(() => {
    void refreshPending()
    const t = window.setInterval(() => void refreshPending(), POLL_REQUESTS_MS)
    return () => window.clearInterval(t)
  }, [refreshPending])

  // 创建一个带虚线边框的「AI 图片」占位框（geo shape + meta 标记）
  const createAiFrame = useCallback(() => {
    if (!editor) return
    const vb = editor.getViewportPageBounds()
    const id = createShapeId()
    editor.createShape<TLGeoShape>({
      id,
      type: 'geo',
      x: vb.x + vb.w / 2 - AI_FRAME_W / 2,
      y: vb.y + vb.h / 2 - AI_FRAME_H / 2,
      props: {
        geo: 'rectangle',
        w: AI_FRAME_W,
        h: AI_FRAME_H,
        dash: 'dashed',
        fill: 'none',
        color: 'blue',
        size: 'm',
        font: 'sans',
        richText: toRichText('AI 图片'),
      },
      meta: { aiFrame: true },
    })
    editor.setSelectedShapes([id])
  }, [editor])

  // 「按标注修改」：导出选中形状为 PNG → 存 annotations/ → 写 image-edit 请求
  const editByAnnotation = useCallback(async () => {
    if (!editor) return
    const selected = editor.getSelectedShapes()
    const imageShape = selected.find((s): s is TLImageShape => s.type === 'image')
    if (!imageShape) {
      showToast('请先选中一张图片（可同时选中叠加在上面的箭头、文字等标注）')
      return
    }
    try {
      const { blob } = await editor.toImage(
        selected.map(s => s.id),
        { format: 'png', background: true, pixelRatio: 2 }
      )
      const name = `anno-${Date.now().toString(36)}.png`
      const up = await fetch(`/api/annotations?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      })
      const upData = await up.json()
      if (!up.ok) throw new Error(upData.error || '标注图上传失败')

      const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined
      const refPath =
        asset && asset.type === 'image' ? assetUrlToPath(asset.props.src) : null
      const b = editor.getShapePageBounds(imageShape.id)
      const note = window.prompt('补充修改说明（可选）：') ?? ''

      await postAiRequest({
        type: 'image-edit',
        prompt: note,
        references: refPath ? [refPath] : [],
        annotationPng: upData.path,
        bounds: b ? { shapeId: imageShape.id, x: b.x, y: b.y, w: b.w, h: b.h } : null,
      })
      showToast('已提交「按标注修改」请求，等待 Kimi 处理')
      void refreshPending()
    } catch (err) {
      showToast(`提交失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editor, refreshPending, showToast])

  // 当前选中的 AI 占位框（有 meta.aiFrame 标记的 geo 形状）
  const selectedShapes = useValue('selection', () => editor?.getSelectedShapes() ?? [], [editor])
  const aiFrame = selectedShapes.find(
    (s): s is TLGeoShape => s.type === 'geo' && Boolean((s.meta as { aiFrame?: boolean })?.aiFrame)
  )

  return (
    <div className="kc-app">
      <div className="kc-canvas">
        <Tldraw assets={assetStore} onMount={setEditor} />
        <div className="kc-toolbar">
          <button className="kc-btn" disabled={!editor} onClick={createAiFrame}>
            ✨ AI 图片
          </button>
          <button className="kc-btn" disabled={!editor} onClick={() => void editByAnnotation()}>
            🖍️ 按标注修改
          </button>
        </div>
        {pendingCount > 0 && (
          <div className="kc-badge">
            ⏳ {pendingCount} 个请求待处理 · 在 Kimi 对话中让 Kimi 检查画布请求
          </div>
        )}
        {toast && <div className="kc-toast">{toast}</div>}
      </div>
      {aiFrame && editor && (
        <AiFramePanel editor={editor} frame={aiFrame} onSent={refreshPending} showToast={showToast} />
      )}
    </div>
  )
}
