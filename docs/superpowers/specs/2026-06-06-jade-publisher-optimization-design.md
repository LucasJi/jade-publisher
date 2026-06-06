# Jade Publisher 全面优化 — 设计文档

> **方案：** 分阶段渐进式优化，5 个独立阶段，每阶段产出可工作的版本。

---

## 1. 架构目标

当前 3 个源文件，main.ts（277 行）承载了所有业务逻辑。优化后拆分为 7 个文件，各司其职：

```
src/
├── main.ts              # 插件生命周期、Ribbon、设置加载
├── api.ts               # API 封装（超时、重试、错误处理）
├── session-manager.ts   # Yjs 文档会话管理
├── sync-handler.ts      # 文件增删改事件处理 + 防抖
├── setting-tab.ts       # 设置面板 + 全量同步
├── constants.ts         # 常量、枚举、默认值
└── types.ts             # 接口定义
```

**核心原则：** 每个文件单一职责，通过明确接口通信。main.ts 作为编排层，不包含业务逻辑细节。

---

## 2. Phase 1: 健壮性与错误处理

### 问题
- 所有 API 调用无超时/重试/错误反馈
- modify 事件中异步操作无 try/catch，出错静默失败
- 用户看不到任何连接/同步状态
- 存在未使用的死代码

### 变更

#### api.ts 重写
- `fetchWithTimeout(url, options, timeoutMs)` — 15s 超时，AbortController
- `fetchWithRetry(url, options, maxRetries)` — 指数退避，最多 3 次
- `publish(baseUrl, vault)` — 包装重试+超时，失败抛错
- `deleteNote(baseUrl, vault, filePath)` — 新增
- `renameNote(baseUrl, vault, oldPath, newPath)` — 新增
- 移除未使用的 `sync()` 函数

#### main.ts 修改
- publish ribbon 点击添加 `.catch()` + Notice 错误提示
- 硬编码 `WEBSOCKET_SERVER_URL` 移入 constants.ts
- 移除 `@ts-ignore`（如 Hocuspocus 无类型，添加声明文件或改用动态 import）

#### setting-tab.ts 修改
- vault sync 添加 error handling + 用户 Notice
- 移除未使用的 `SparkMD5` 和 `NoteStatus` 导入

### 验收标准
- API 调用失败时用户看到 Notice（非静默）
- 网络抖动时自动重试，最多 3 次
- 无死代码（编译器 + Biome 检查通过）

---

## 3. Phase 2: 代码架构重构

### 拆分方案

| 新文件 | 内容来源 | 预估行数 |
|--------|---------|---------|
| `constants.ts` | WEBSOCKET_SERVER_URL、DEFAULT_SETTINGS、NoteStatus 枚举、dmp 实例 | ~20 |
| `types.ts` | JadePublisherSettings 接口、WebSocket 配置类型 | ~15 |
| `session-manager.ts` | destroyActiveDocSession、switchActiveDocSession | ~120 |
| `sync-handler.ts` | modify/rename/delete/create 事件处理 + 防抖 | ~80 |
| `main.ts` | onload/onunload/设置 + 事件注册 | ~80 |

### 关键接口

```typescript
// session-manager.ts
export class SessionManager {
  constructor(vaultName: string, endpoint: string);
  switchTo(file: TFile): void;
  destroy(): void;
  get activeDocName(): string | null;
  get activeProvider(): HocuspocusProvider | null;
}

// sync-handler.ts
export class SyncHandler {
  constructor(plugin: JadePublisherPlugin, sessionManager: SessionManager);
  registerEvents(): void;
}
```

### 验收标准
- 所有现有功能正常工作（打开/切换/编辑文件同步）
- 单元测试覆盖 SessionManager 生命周期
- main.ts 不超过 100 行

---

## 4. Phase 3: 性能优化

### 3.1 modify 事件防抖（300ms）
- SyncHandler 中维护 debounce timer
- 连续编辑时只在 300ms 无新修改后才执行 diff + Yjs transact
- 注意：防抖期间需要保留最新的文件内容用于 diff

### 3.2 WebSocket URL 动态化
- 从 `settings.endpoint`（如 `http://localhost:3000`）派生 WebSocket URL
- HTTP → WS 协议转换：`http://` → `ws://`，`https://` → `wss://`
- 路径固定为 `/hocuspocus`

### 3.3 全量同步进度反馈
- vault sync 中 Notice 实时更新计数：`Syncing vault... (15/200 files)`
- 使用 Notice 的 `setMessage()` 更新而非新建 Notice

### 验收标准
- 快速打字时 console 中 diff/transact 日志显著减少
- WebSocket 连接到配置的 endpoint 而非硬编码 localhost
- vault sync 显示实时进度

---

## 5. Phase 4: 工具链与配置现代化

### 变更清单

| 项目 | 当前 | 优化后 |
|------|------|--------|
| TypeScript | 4.7.4 | ^5.5 |
| @types/node | ^16.18.126 | ^22 |
| ESLint | 有，与 Biome 重复 | **移除** |
| .eslintrc | 存在 | **删除** |
| .editorconfig | tab 缩进 | **删除**（与 biome.json 的 space 冲突） |
| tsconfig target | ES6 | ES2020 |
| esbuild external | 含未使用的 @codemirror/* | 精简 |
| biome.json | 已有 | 补充 `noUnusedImports` 为 error 级别 |
| 注释 | 中英混用 | 统一英文 |

### 关键决策
- **移除 ESLint 和 .editorconfig：** Biome 同时承担格式化和 linting，保留两个工具会导致配置漂移
- **TypeScript target ES2020：** Obsidian 基于 Electron/Chromium，完全支持 ES2020

### 验收标准
- `npm run build` 通过（tsc + esbuild）
- `npx biome check` 无错误
- 无 ESLint 残留配置
- 缩进风格统一为 2 space

---

## 6. Phase 5: 功能完整性

### 6.1 删除同步
- `delete` 事件触发时调用 `DELETE /api/vaults/:vault/notes/:encodedPath`
- 需要确认当前打开的 session 是否需要销毁

### 6.2 重命名同步
- `rename` 事件触发时调用 `PUT /api/vaults/:vault/notes/:encodedPath/rename`
- body: `{ newPath: string }`
- 本地 session 重建（已有逻辑，保持不变）

### 6.3 WebSocket 认证
- HocuspocusProvider 创建时传入 token 参数
- 通过 URL query 或 header 传递 `accessToken`

### 6.4 非 md 文件过滤
- vault sync 中 `.md` 文件始终包含
- 其他附件（图片、PDF）默认上传（保持现有行为）

### 验收标准
- 删除文件后服务端对应笔记被删除
- 重命名文件后服务端笔记路径更新
- WebSocket 连接携带认证 token

---

## 7. 优先级与依赖关系

```
Phase 1 (错误处理) → 无依赖，可立即开始
Phase 2 (架构拆分) → 依赖 Phase 1 的 api.ts 重写
Phase 3 (性能优化) → 依赖 Phase 2 的 sync-handler.ts 拆分
Phase 4 (工具链)    → 独立，可并行
Phase 5 (功能补全) → 依赖 Phase 1 的 api.ts + Phase 2 的 sync-handler.ts
```

推荐执行顺序：1 → 2 → 3 + 4（并行）→ 5
