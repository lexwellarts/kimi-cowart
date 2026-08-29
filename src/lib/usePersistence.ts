import { useEffect, useRef } from 'react'
import { Editor, getSnapshot, loadSnapshot, type TLEditorSnapshot } from 'tldraw'

const SAVE_DEBOUNCE_MS = 800
const POLL_INTERVAL_MS = 4000

/**
 * 画布持久化 + 服务器端变更轮询：
 * - 本地编辑（document scope、user source）防抖 800ms 自动 PUT /api/canvas
 * - 每 4s GET /api/canvas 比较 updatedAt；
 *   服务器端更新（Agent 已完成请求并改写画布文件）且本地无未保存修改时，整体 loadSnapshot 重载；
 *   本地 dirty 时跳过本次同步（保存成功后以本地为准，冲突策略：本地优先）。
 */
export function usePersistence(editor: Editor | null) {
  const stateRef = useRef({
    dirty: false,
    loading: false,
    changeCount: 0,
    serverUpdatedAt: null as number | null,
  })

  useEffect(() => {
    if (!editor) return
    const st = stateRef.current
    let disposed = false
    let saveTimer: number | undefined

    const save = async () => {
      const n = st.changeCount
      try {
        const res = await fetch('/api/canvas', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getSnapshot(editor.store)),
        })
        if (!res.ok) return
        const data = await res.json()
        st.serverUpdatedAt = data.updatedAt ?? st.serverUpdatedAt
        // 保存期间没有新的本地修改，才算真正干净
        if (st.changeCount === n) st.dirty = false
      } catch {
        /* 网络错误留待下次防抖/变更重试 */
      }
    }

    const loadFrom = (snapshot: TLEditorSnapshot, updatedAt: number | null) => {
      st.loading = true
      try {
        loadSnapshot(editor.store, snapshot)
        st.serverUpdatedAt = updatedAt
        st.dirty = false
      } catch (err) {
        console.error('[kimi-cowart] 画布快照加载失败', err)
      } finally {
        st.loading = false
      }
    }

    // 首次加载：恢复画布
    fetch('/api/canvas')
      .then(r => r.json())
      .then(data => {
        if (disposed) return
        st.serverUpdatedAt = data.updatedAt ?? null
        if (data.snapshot) loadFrom(data.snapshot as TLEditorSnapshot, data.updatedAt ?? null)
      })
      .catch(() => {})

    // 本地变更 → 防抖自动保存（只关心 document 范围内的用户修改，忽略相机等 session 状态）
    const unlisten = editor.store.listen(
      () => {
        if (st.loading) return
        st.dirty = true
        st.changeCount++
        window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
      },
      { source: 'user', scope: 'document' }
    )

    // 每 4s 轮询服务器端版本
    const poll = window.setInterval(async () => {
      try {
        const res = await fetch('/api/canvas')
        if (!res.ok) return
        const data = await res.json()
        const remote: number | null = data.updatedAt ?? null
        if (remote && remote !== st.serverUpdatedAt && !st.dirty && data.snapshot) {
          loadFrom(data.snapshot as TLEditorSnapshot, remote)
        }
        // 本地有未保存修改则跳过本次同步
      } catch {
        /* 离线时静默跳过 */
      }
    }, POLL_INTERVAL_MS)

    return () => {
      disposed = true
      unlisten()
      window.clearInterval(poll)
      window.clearTimeout(saveTimer)
    }
  }, [editor])
}
