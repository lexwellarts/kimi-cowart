# Kimi Cowart

给 [Kimi Work](https://www.kimi.com/)（本地 AI Agent 桌面环境）用的**无限画布协作工具**：在浏览器画布上排图、圈注、发起 AI 生图请求；请求以 JSON 文件落到磁盘；Kimi Agent 读取请求、生成图片、更新画布文件；画布自动刷新出结果。

**浏览器画布 + Agent 文件协作** —— 没有插件协议、没有 WebSocket，只有 JSON 文件。

## 功能截图

> 占位：画布主界面截图（待补充）
>
> 占位：AI 图片生成面板截图（待补充）

## 快速开始

```bash
npm install
npm run dev                 # 默认 http://localhost:5173/
npm run dev -- --port 7100  # 指定端口
```

浏览器打开对应端口即可。画布数据默认保存在**启动目录**的 `canvas/` 下（在哪个项目目录启动，数据就存哪里）；也可以用环境变量 `KIMI_COWART_DATA_DIR` 指定其他位置。

## 功能

- **无限画布**：tldraw 全功能画布，支持拖入/粘贴图片（图片经 API 存到 `canvas/assets/`，画布引用 `/api/assets/...` URL）。
- **自动持久化**：编辑防抖自动保存到 `canvas/kimi-cowart.json`，刷新页面自动恢复。
- **AI 图片框**：工具栏「✨ AI 图片」创建虚线占位框 → 选中后在画布下方输入提示词、可选参考图 → 发送给 Kimi。
- **按标注修改**：选中一张图片（可叠加箭头/文字标注）→ 点「🖍️ 按标注修改」→ 自动导出标注 PNG 并生成修改请求。
- **结果自动同步**：画布每 4 秒轮询，Kimi 完成请求并改写画布文件后自动刷新显示（本地有未保存修改时跳过）。
- **状态提示**：画布左上角显示待处理请求数量，附「在 Kimi 对话中让 Kimi 检查画布请求」。

## Agent 协作模式

1. 用户在画布上发起请求 → 服务器写入 `canvas/requests/<id>.json`（`status: pending`）。
2. 在 Kimi 对话中说一句「检查画布请求」→ Kimi 读取请求、用 image_generation 插件生成图片到 `canvas/assets/`、编辑 `canvas/kimi-cowart.json`（删除占位框、原位插入图片）、把请求标记为 `done`。
3. 画布 4 秒内自动刷新，占位框变成生成好的图片。

完整的请求 JSON Schema 与 Agent 操作步骤见 [SKILL.md](./SKILL.md)。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/canvas` | 读取画布快照与更新时间 |
| PUT | `/api/canvas` | 保存画布快照（自动备份 .bak） |
| POST | `/api/assets?name=` | 上传图片到 assets/ |
| GET | `/api/assets/<file>` | 读取 assets 图片 |
| POST | `/api/annotations?name=` | 保存标注导出 PNG |
| GET | `/api/annotations/<file>` | 读取标注图 |
| POST | `/api/ai-request` | 写入 AI 请求 JSON |
| GET | `/api/requests` | 列出全部请求 |

## 与 Codex Cowart 的关系

本项目的灵感来自 Codex 生态的 Cowart 插件（同样基于 tldraw 的「画布 + 文件」协作思路），但 **Kimi Cowart 是面向 Kimi Work 的独立实现**：代码完全重写，与 Codex Cowart 没有任何官方关联，也不使用其代码。差异包括：单一 Vite dev server 内置 JSON API（无额外服务框架）、请求/目录契约按 Kimi Work 技能（SKILL.md）格式文档化、按标注修改走「导出 PNG + image-edit 请求」流程等。

## License

- 本项目代码以 [MIT](./LICENSE) 发布（Copyright © lexwellarts）。
- 依赖的 [tldraw](https://github.com/tldraw/tldraw) 遵循其自身 license：免费使用需保留画布上的水印；商用授权见其官方说明。
