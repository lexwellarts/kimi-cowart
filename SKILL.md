---
name: kimi-cowart
description: Kimi Cowart 无限画布协作技能。当用户使用 kimi-cowart 项目（本地无限画布 Web 应用）并要求生成图片、按标注修改图片、检查画布请求时使用。Agent 通过读写画布数据目录（canvas/requests/*.json、canvas/kimi-cowart.json、canvas/assets/）与浏览器画布协作：读取 pending 请求 → 用 image_generation 插件生成图片 → 编辑画布快照 JSON（删除占位框、插入图片形状与 asset 记录）→ 将请求标记为 done → 用户画布自动刷新看到结果。
---

# Kimi Cowart —— 画布协作技能

Kimi Cowart 是一个本地无限画布 Web 应用（Vite + React + tldraw）。用户在浏览器画布上排图、圈注、发起 AI 生图请求；请求以 JSON 文件形式落到磁盘；你（Kimi Agent）读取请求文件、生成图片、更新画布文件；用户刷新画布看到结果。即「浏览器画布 + Agent 通过文件协作」。

## 一、安装与启动

在 kimi-cowart 仓库根目录（含 package.json 的目录）：

```bash
npm install
npm run dev              # 默认端口 5173
npm run dev -- --port 7100   # 指定端口
```

浏览器打开对应端口（如 http://localhost:7100/）即可使用画布。

## 二、数据目录（dataDir）规则

- 优先读环境变量 `KIMI_COWART_DATA_DIR`；否则默认 `<启动目录>/canvas`，即**用户在哪个项目目录启动 dev server，画布数据就存哪里**。
- 所有 API 与 Agent 的文件读写都必须限制在 dataDir 内。

目录结构：

```
canvas/
├── kimi-cowart.json        # tldraw store 快照（getSnapshot/loadSnapshot 格式）
├── kimi-cowart.json.bak    # 服务器保存前的自动备份
├── assets/                 # 图片资源（用户拖入的、AI 生成的）
├── requests/               # AI 请求文件，每个请求一个 <requestId>.json
└── annotations/            # 「按标注修改」导出的标注 PNG
```

## 三、请求 JSON Schema

请求文件位于 `requests/<id>.json`，`status` 初始为 `pending`。

### 1. type: "image-gen"（AI 生图）

```json
{
  "id": "req-m5k3x9a1-4f2c8d",
  "type": "image-gen",
  "prompt": "一只放在原木桌面上的香薰蜡烛，柔光，产品摄影风格",
  "references": ["assets/u-m5k2aaaa-photo.png"],
  "frame": { "shapeId": "shape:AbC123", "x": 120, "y": -40, "w": 512, "h": 512 },
  "annotationPng": null,
  "bounds": null,
  "status": "pending",
  "createdAt": "2026-06-01T08:30:00.000Z"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `id` | 请求 ID，即文件名（不含 .json） |
| `type` | `"image-gen"` 或 `"image-edit"` |
| `prompt` | 用户的生成/修改提示词（image-edit 时可能为空字符串） |
| `references` | 相对 dataDir 的参考图路径数组（用户在画布上选的已有图片），可为空数组 |
| `frame` | 占位框信息：`shapeId` 是要替换的占位框形状 ID，`x/y/w/h` 是页面坐标与尺寸。仅 image-gen 有值 |
| `annotationPng` | 标注导出图路径（`annotations/xxx.png`）。仅 image-edit 有值 |
| `bounds` | 原图信息：`shapeId` 是原图形状 ID，`x/y/w/h` 是其页面坐标与尺寸。仅 image-edit 有值 |
| `status` | `pending` → `done`（失败可写 `failed` 并加 `error` 字段） |
| `createdAt` | ISO 8601 创建时间 |

### 2. type: "image-edit"（按标注修改）

结构同上，差异：`frame` 为 null，`annotationPng` 与 `bounds` 有值。`annotationPng` 是用户把「原图 + 箭头/文字等标注」整体导出的 PNG；`references[0]` 通常是原图 asset 路径。

## 四、履行请求的完整步骤

1. **列出待处理请求**：读 `canvas/requests/*.json`，筛出 `status === "pending"` 的，按 `createdAt` 升序处理。
2. **生成图片**：
   - `image-gen`：用 image_generation 插件按 `prompt` 生成图片；若 `references` 非空，把对应文件作为参考图。尺寸按 `frame.w : frame.h` 的比例生成（如 512:512 → 方形）。
   - `image-edit`：先把 `annotationPng` 作为参考图（它包含用户的圈注意图），结合 `prompt` 与 `references` 中的原图生成修改后的图片，尺寸按 `bounds.w : bounds.h` 比例。
   - 生成结果保存为 `canvas/assets/ai-<请求id>.png`（jpg/png 均可，路径相对 dataDir）。
3. **编辑画布快照** `canvas/kimi-cowart.json`（结构：`{ "store": { "<recordId>": <record>, ... }, "schema": {...} }`）：
   - **先备份**：复制为 `kimi-cowart.json.agent-bak`。
   - `image-gen`：从 `store` 中**删除** `frame.shapeId` 对应的占位框 shape 记录；在**同一 x/y/w/h** 插入 image shape + asset 两条记录（见下方示例）。
   - `image-edit`：通常把原图形状（`bounds.shapeId`）的 `props.assetId` 改为新 asset id，并把 `props.w/h` 调回 `bounds.w/h`；或者同样「删除旧图、原位插入新图」。不要改动无关记录。
   - **schema 字段原样保留**，不要改动。
4. **更新请求状态**：把请求文件的 `status` 改为 `"done"`，追加 `"doneAt": "<ISO时间>"` 与 `"result": "assets/ai-<id>.png"`。
5. **提醒用户**：画布每 4 秒自动轮询，本地无未保存修改时会自动刷新显示结果；也可以手动刷新页面。

### tldraw record 结构要点

- 每条 record 都有 `id`、`typeName`、`meta`；shape 还有 `x/y/rotation/isLocked/opacity/parentId/index/props`。
- `parentId` 必须是当前页 id：在 `store` 里找 `typeName === "page"` 的记录（通常叫 `page:page`），用它的 `id`。
- `index` 是分式索引字符串（如 `"a1"`、`"a2"`），**只有 shape 记录需要**，asset 记录不能带 `index`（v5 校验会报 Unexpected property 导致整个快照加载失败）；同层 shape 里保持唯一且按字典序递增即可；取已有最大 index 之后的一个值（如已有最大为 `"a4"` 则用 `"a5"`）。
- asset 的 `props.src` 写 `/api/assets/ai-<请求id>.png`（与文件名一致），`props.w/h` 写图片真实像素尺寸。
- shape 的 `props.w/h` 用 `frame`/`bounds` 里的画布尺寸（保持占位框大小，图片按比例填充）。

### 最小可用 record 示例（v5 结构）

asset 记录（key 为 `asset:ai-req-xxx`）：

```json
{
  "id": "asset:ai-req-xxx",
  "typeName": "asset",
  "type": "image",
  "props": {
    "name": "ai-req-xxx.png",
    "src": "/api/assets/ai-req-xxx.png",
    "w": 1024,
    "h": 1024,
    "mimeType": "image/png",
    "isAnimated": false
  },
  "meta": {}
}
```

image shape 记录（key 为 `shape:ai-req-xxx`）：

```json
{
  "id": "shape:ai-req-xxx",
  "typeName": "shape",
  "type": "image",
  "x": 120,
  "y": -40,
  "rotation": 0,
  "isLocked": false,
  "opacity": 1,
  "parentId": "page:page",
  "index": "aA",
  "props": {
    "w": 512,
    "h": 512,
    "assetId": "asset:ai-req-xxx",
    "playing": true,
    "url": "",
    "crop": null,
    "flipX": false,
    "flipY": false,
    "altText": ""
  },
  "meta": {}
}
```

## 五、注意事项

- **编辑 `kimi-cowart.json` 前务必备份**（`cp kimi-cowart.json kimi-cowart.json.agent-bak`）。
- 保持 tldraw store 结构合法：只增删改上述记录，不要动 `schema`、页面记录、相机记录等无关内容；JSON 必须是合法 UTF-8。
- 图片尺寸按 `frame`/`bounds` 的 w:h 比例生成，避免画布上拉伸变形。
- 若快照正在被用户写入（mtime 很近，例如 2 秒内），稍等再改，改完尽快落盘；客户端发现本地有未保存修改时会跳过该次自动同步，属正常现象。
- 写文件建议「先写 .tmp 再 rename」，避免客户端读到半截 JSON。
- 客户端冲突策略为**本地优先**：若用户正在编辑，Agent 的更新要等用户保存后下一轮轮询才会被看到，这不是 bug。
