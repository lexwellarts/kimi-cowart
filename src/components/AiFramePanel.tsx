import { useState } from 'react'
import { Editor, TLGeoShape, TLImageShape, toRichText, useValue } from 'tldraw'
import { assetUrlToPath, postAiRequest } from '../lib/api'

interface AiFramePanelProps {
  editor: Editor
  frame: TLGeoShape
  onSent: () => void
  showToast: (msg: string) => void
}

/** 选中「AI 图片」占位框时，画布下方出现的生成面板 */
export function AiFramePanel({ editor, frame, onSent, showToast }: AiFramePanelProps) {
  const [prompt, setPrompt] = useState('')
  const [refId, setRefId] = useState('')
  const [sending, setSending] = useState(false)

  // 画布上已有的图片形状，可作为参考图
  const imageShapes = useValue(
    'image-shapes',
    () => editor.getCurrentPageShapes().filter((s): s is TLImageShape => s.type === 'image'),
    [editor]
  )

  const alreadySent = Boolean((frame.meta as { requestId?: string }).requestId)

  const send = async () => {
    if (!prompt.trim()) {
      showToast('请先输入提示词')
      return
    }
    const bounds = editor.getShapePageBounds(frame.id)
    if (!bounds) return
    const refShape = imageShapes.find(s => s.id === refId)
    const refAsset =
      refShape && refShape.props.assetId ? editor.getAsset(refShape.props.assetId) : null
    const refPath =
      refAsset && refAsset.type === 'image' ? assetUrlToPath(refAsset.props.src) : null

    setSending(true)
    try {
      const res = await postAiRequest({
        type: 'image-gen',
        prompt: prompt.trim(),
        references: refPath ? [refPath] : [],
        frame: { shapeId: frame.id, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      })
      // 占位框进入等待状态
      editor.updateShape<TLGeoShape>({
        id: frame.id,
        type: 'geo',
        props: { richText: toRichText('等待 Kimi 生成…') },
        meta: { ...(frame.meta as Record<string, unknown>), requestId: res.id },
      })
      showToast('已发送生成请求，等待 Kimi 处理')
      onSent()
    } catch (err) {
      showToast(`发送失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="kc-panel">
      <div className="kc-panel-title">✨ AI 图片生成</div>
      <textarea
        className="kc-prompt"
        placeholder="描述想生成的图片，例如：一只放在原木桌面上的香薰蜡烛，柔光，产品摄影风格"
        value={prompt}
        rows={2}
        disabled={alreadySent}
        onChange={e => setPrompt(e.target.value)}
      />
      <div className="kc-panel-row">
        <label htmlFor="kc-ref">参考图（可选）：</label>
        <select
          id="kc-ref"
          value={refId}
          disabled={alreadySent}
          onChange={e => setRefId(e.target.value)}
        >
          <option value="">不使用参考图</option>
          {imageShapes.map((s, i) => (
            <option key={s.id} value={s.id}>
              画布图片 {i + 1}
            </option>
          ))}
        </select>
        <button
          className="kc-btn kc-btn-primary"
          disabled={sending || alreadySent}
          onClick={() => void send()}
        >
          {alreadySent ? '已提交，等待 Kimi 生成' : sending ? '发送中…' : '发送给 Kimi'}
        </button>
      </div>
    </div>
  )
}
