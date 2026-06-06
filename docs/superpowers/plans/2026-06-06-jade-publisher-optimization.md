# Jade Publisher 全面优化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Jade Publisher Obsidian 插件进行 5 阶段全面优化：健壮性 → 架构拆分 → 性能 → 工具链 → 功能补全

**Architecture:** 将 3 文件 400 行单体拆分为 7 文件模块化架构。每个文件单一职责，通过 SessionManager 和 SyncHandler 类接口通信。main.ts 退化为纯编排层。

**Tech Stack:** TypeScript 5.x, esbuild, Biome, Yjs + Hocuspocus, Obsidian Plugin API

**Execution order:** Phase 1 → Phase 2 → Phase 3 + Phase 4 (parallel) → Phase 5

---

## Phase 1: 健壮性与错误处理

### Task 1.1: 清理死代码

**Files:**
- Modify: `src/api.ts`
- Modify: `src/setting-tab.ts`

- [ ] **Step 1: 删除 api.ts 中未使用的 sync 函数**

```typescript
// src/api.ts — 替换整个文件内容
export const publish = async (baseUrl: string, vault: string) => {
  return fetch(`${baseUrl}/vaults/${vault}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }).then((resp) => resp.json());
};
```

- [ ] **Step 2: 删除 setting-tab.ts 中未使用的导入**

```typescript
// src/setting-tab.ts — 修改第 1-5 行 import block
import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
// 删除: import * as SparkMD5 from "spark-md5";
// 删除: import { sync } from "./api";
// 删除: import { NoteStatus } from "./main";
import type JadePublisherPlugin from "./main";
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors related to removed imports.

- [ ] **Step 4: Commit**

```bash
git add src/api.ts src/setting-tab.ts
git commit -m "chore: remove dead code (unused sync, SparkMD5, NoteStatus imports)"
```

---

### Task 1.2: 添加 API 超时与重试

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: 实现 fetchWithTimeout 和 fetchWithRetry**

```typescript
// src/api.ts — 完整文件
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Request failed after all retries");
}

export const publish = async (baseUrl: string, vault: string) => {
  const response = await fetchWithRetry(`${baseUrl}/vaults/${vault}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Publish failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat: add timeout and retry logic to API calls"
```

---

### Task 1.3: 添加用户可见的错误反馈

**Files:**
- Modify: `src/main.ts`
- Modify: `src/setting-tab.ts`

- [ ] **Step 1: main.ts ribbon publish 添加错误处理**

```typescript
// src/main.ts — 修改 ribbon icon 回调（约第 253-258 行）
this.addRibbonIcon("cloud-upload", "Sync to Jade", async () => {
  const baseUrl = `${this.settings.endpoint}/api`;
  try {
    const resp = await publish(baseUrl, this.vaultName);
    console.log("Publish Resp", resp);
    new Notice("✅ Synced to Jade successfully");
  } catch (error) {
    console.error("Publish failed:", error);
    new Notice(`❌ Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
```

- [ ] **Step 2: main.ts 顶部添加 Notice 导入**

```typescript
// src/main.ts — 修改第 4 行 import
import { Plugin, TFile, type TAbstractFile, Notice } from "obsidian";
```

- [ ] **Step 3: setting-tab.ts vault sync 添加错误处理**

```typescript
// src/setting-tab.ts — 修改 onClick 回调（约第 47 行开始），在 try/catch 中包裹 fetch
button.setIcon("folder-sync").onClick(async () => {
  const baseUrl = `${this.plugin.settings.endpoint}/api`;
  const notice = new Notice("Syncing vault...", 0);
  const formData = new FormData();
  const files = this.app.vault.getFiles();

  try {
    for (const file of files) {
      const content = await this.app.vault.readBinary(file);
      const mimeType = file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);
      const blob = new Blob([content], { type: mimeType });
      formData.append("files", blob, encodeURIComponent(file.path));
    }

    const response = await fetch(`${baseUrl}/vaults/${this.app.vault.getName()}/sync`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    notice.hide();

    if (response.ok) {
      new Notice(
        `✅ Sync done — ${result.data.notes.upserted} notes, ${result.data.attachments.uploaded} attachments`
      );
    } else {
      new Notice(`❌ Sync failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    notice.hide();
    console.error("Vault sync failed:", error);
    new Notice(`❌ Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/setting-tab.ts
git commit -m "feat: add user-facing error notices for all API operations"
```

---

### Task 1.4: 添加 modify 事件异步错误处理

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 用 try/catch 包裹 modify handler 中的异步操作**

```typescript
// src/main.ts — 修改 modify 事件处理器中的 .then() 回调
// 在 changed.then((text) => { ... }) 内部包裹 try/catch

changed.then((text) => {
  try {
    if (this.activeProvider !== capturedProvider || this.activeFilePath !== capturedFilePath) {
      console.log(`Provider switched during async read for ${file.path}, skip syncing`);
      return;
    }

    const doc: Y.Doc = capturedProvider.document;
    const content = doc.getText("content");

    const oldContent = content.toString();
    const diffs: Diff[] = dmp.diff_main(oldContent, text);

    dmp.diff_cleanupSemantic(diffs);

    let cursor = 0;

    doc.transact(() => {
      for (const [operation, diffText] of diffs) {
        switch (operation) {
          case 1:
            content.insert(cursor, diffText);
            cursor += diffText.length;
            break;
          case 0:
            cursor += diffText.length;
            break;
          case -1:
            content.delete(cursor, diffText.length);
            break;
        }
      }
    }, null);
  } catch (error) {
    console.error(`Failed to sync modifications for ${file.path}:`, error);
  }
}).catch((error) => {
  console.error(`Failed to read file ${file.path}:`, error);
});
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix: add error handling to modify event async operations"
```

---

## Phase 2: 代码架构重构

### Task 2.1: 创建 constants.ts 和 types.ts

**Files:**
- Create: `src/constants.ts`
- Create: `src/types.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 创建 src/constants.ts**

```typescript
// src/constants.ts
import { diff_match_patch } from "diff-match-patch";

export const WEBSOCKET_PATH = "/hocuspocus";

export enum NoteStatus {
  CREATED = "created",
  MODIFIED = "modified",
  DELETED = "deleted",
  RENAMED = "renamed",
}

export const DEFAULT_SETTINGS = {
  endpoint: "",
  accessToken: "",
} as const;

export const dmp = new diff_match_patch();
```

- [ ] **Step 2: 创建 src/types.ts**

```typescript
// src/types.ts
export interface JadePublisherSettings {
  endpoint: string;
  accessToken: string;
}
```

- [ ] **Step 3: 从 main.ts 移除已迁移的代码，改为导入**

```typescript
// src/main.ts — 修改 import block 和删除常量/接口定义
// 删除: interface JadePublisherSettings { ... }
// 删除: const DEFAULT_SETTINGS: JadePublisherSettings = { ... };
// 删除: export enum NoteStatus { ... }
// 删除: const dmp = new diff_match_patch();
// 删除: const WEBSOCKET_SERVER_URL = "...";

// 新增 imports:
import { DEFAULT_SETTINGS, dmp, WEBSOCKET_PATH, NoteStatus } from "./constants";
import type { JadePublisherSettings } from "./types";
```

- [ ] **Step 4: 更新 WEBSOCKET_SERVER_URL 引用**

在 main.ts 中找到 `WEBSOCKET_SERVER_URL` 引用（第 28 行定义，第 82 行使用），替换为动态构造：

```typescript
// 在 switchActiveDocSession 方法中，替换硬编码 URL
// 找到: url: WEBSOCKET_SERVER_URL,
// 改为: url: `${this.settings.endpoint.replace(/^http/, "ws")}${WEBSOCKET_PATH}`,
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/constants.ts src/types.ts src/main.ts
git commit -m "refactor: extract constants and types into separate files"
```

---

### Task 2.2: 创建 SessionManager 类

**Files:**
- Create: `src/session-manager.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 创建 src/session-manager.ts**

```typescript
// src/session-manager.ts
import { HocuspocusProvider } from "@hocuspocus/provider";
import { type TFile, type Y, type Transaction } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import { WEBSOCKET_PATH } from "./constants";

export class SessionManager {
  private activeProvider: HocuspocusProvider | null = null;
  private activeIndexeddbPersistence: IndexeddbPersistence | null = null;
  private activeFilePath: string | null = null;
  private activeDocName: string | null = null;
  private activeDocUpdateHandler: ((update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void) | null = null;
  private sessionGeneration = 0;

  constructor(
    private vaultName: string,
    private endpoint: string
  ) {}

  get docName(): string | null {
    return this.activeDocName;
  }

  get provider(): HocuspocusProvider | null {
    return this.activeProvider;
  }

  get filePath(): string | null {
    return this.activeFilePath;
  }

  destroy(): void {
    this.sessionGeneration++;

    if (this.activeProvider && this.activeDocUpdateHandler) {
      this.activeProvider.document.off("updateV2", this.activeDocUpdateHandler);
    }

    if (this.activeProvider?.configuration.websocketProvider) {
      this.activeProvider.configuration.websocketProvider.shouldConnect = false;
    }
    this.activeProvider?.destroy();
    this.activeIndexeddbPersistence?.destroy();

    this.activeProvider = null;
    this.activeIndexeddbPersistence = null;
    this.activeFilePath = null;
    this.activeDocName = null;
    this.activeDocUpdateHandler = null;
  }

  switchTo(file: TFile): void {
    const filePath = file.path;
    const docName = `${this.vaultName}/${filePath}`;

    if (this.activeDocName === docName) {
      return;
    }

    this.destroy();

    const generation = this.sessionGeneration;
    const wsUrl = `${this.endpoint.replace(/^http/, "ws")}${WEBSOCKET_PATH}`;

    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: docName,
      onConnect: () => {
        if (generation !== this.sessionGeneration) return;
        console.log(`Doc "${docName}" connects to server successfully!`);
      },
      onSynced: ({ state }) => {
        if (generation !== this.sessionGeneration) return;
        console.log(`Restore doc "${docName}" from server ${state ? "successfully" : "failed"}!`);
      },
      onDestroy: () => {
        console.log(`Provider of doc "${docName}" destroyed`);
      },
    });

    const indexeddbPersistence = new IndexeddbPersistence(docName, provider.document);

    const updateHandler = (_: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => {
      if (generation !== this.sessionGeneration) return;

      if (origin === null || origin === undefined) {
        console.log("Local update, provider will sync to server");
        return;
      }

      if (origin === indexeddbPersistence) {
        console.log("IndexedDB update (used to restore doc), ignore");
        return;
      }

      if (origin === this.activeProvider) {
        console.log("Server update, try to sync");
        console.log("Changes:", transaction.changed, ", origin:", transaction.origin);
        const content = doc.getText("content");
        transaction.changed.forEach((_, type) => {
          if (content === type) {
            console.log(`Doc ${filePath} changed, try to sync`);
            console.log("Latest content:", content);
            // The caller (main.ts) handles vault.modify
          }
        });
        return;
      }

      console.log("Unknown origin, ignore");
    };

    provider.document.on("updateV2", updateHandler);

    this.activeProvider = provider;
    this.activeIndexeddbPersistence = indexeddbPersistence;
    this.activeFilePath = filePath;
    this.activeDocName = docName;
    this.activeDocUpdateHandler = updateHandler;
  }
}
```

- [ ] **Step 2: 修改 main.ts 使用 SessionManager**

```typescript
// src/main.ts — 删除以下方法:
// - destroyActiveDocSession()
// - switchActiveDocSession()
// 删除以下属性:
// - activeProvider, activeIndexeddbPersistence, activeFilePath, activeDocName, activeDocUpdateHandler, sessionGeneration

// 新增 import:
import { SessionManager } from "./session-manager";

// 新增属性替换旧的多个属性:
private sessionManager!: SessionManager;

// onload() 中初始化:
this.sessionManager = new SessionManager(this.vaultName, this.settings.endpoint);

// 替换所有 this.switchActiveDocSession(file) → this.sessionManager.switchTo(file)
// 替换所有 this.destroyActiveDocSession() → this.sessionManager.destroy()
// 替换所有 this.activeProvider → this.sessionManager.provider
// 替换所有 this.activeFilePath → this.sessionManager.filePath
// 替换所有 this.activeDocName → this.sessionManager.docName

// onunload() 中:
this.sessionManager.destroy();
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors. Fix any type issues with SessionManager integration.

- [ ] **Step 4: Commit**

```bash
git add src/session-manager.ts src/main.ts
git commit -m "refactor: extract SessionManager class for Yjs doc lifecycle"
```

---

### Task 2.3: 创建 SyncHandler 类

**Files:**
- Create: `src/sync-handler.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 创建 src/sync-handler.ts**

```typescript
// src/sync-handler.ts
import { type Diff, diff_match_patch } from "diff-match-patch";
import { type TAbstractFile, type TFile } from "obsidian";
import type * as Y from "yjs";
import type JadePublisherPlugin from "./main";
import type { SessionManager } from "./session-manager";

export class SyncHandler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;
  private readonly dmp = new diff_match_patch();

  constructor(
    private plugin: JadePublisherPlugin,
    private sessionManager: SessionManager
  ) {}

  registerEvents(): void {
    this.registerModifyEvent();
    this.registerRenameEvent();
    this.registerDeleteEvent();
    this.registerCreateEvent();
  }

  private registerModifyEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }

        const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
        if (file !== activeFile) {
          return;
        }

        const capturedProvider = this.sessionManager.provider;
        const capturedFilePath = this.sessionManager.filePath;

        if (!capturedProvider || !capturedFilePath) {
          console.log(`Provider not available for ${file.path}, skip syncing`);
          return;
        }

        // Debounce: clear previous pending sync
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.handleModify(file, capturedProvider as Y.Doc, capturedFilePath);
        }, this.DEBOUNCE_MS);
      })
    );
  }

  private async handleModify(file: TFile, doc: Y.Doc, filePath: string): Promise<void> {
    // Re-verify provider hasn't changed after debounce
    if (this.sessionManager.provider?.document !== doc) {
      console.log(`Provider switched during debounce for ${file.path}, skip syncing`);
      return;
    }

    try {
      const text = await this.plugin.app.vault.cachedRead(file);

      // Re-check after async read
      if (this.sessionManager.provider?.document !== doc || this.sessionManager.filePath !== filePath) {
        console.log(`Provider switched during async read for ${file.path}, skip syncing`);
        return;
      }

      const content = doc.getText("content");
      const oldContent = content.toString();
      const diffs: Diff[] = this.dmp.diff_main(oldContent, text);

      this.dmp.diff_cleanupSemantic(diffs);

      let cursor = 0;

      doc.transact(() => {
        for (const [operation, diffText] of diffs) {
          switch (operation) {
            case 1:
              content.insert(cursor, diffText);
              cursor += diffText.length;
              break;
            case 0:
              cursor += diffText.length;
              break;
            case -1:
              content.delete(cursor, diffText.length);
              break;
          }
        }
      }, null);
    } catch (error) {
      console.error(`Failed to sync modifications for ${file.path}:`, error);
    }
  }

  private registerRenameEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        console.log(`Rename file from ${oldPath} to ${file.path}`);

        if (oldPath !== this.sessionManager.filePath) {
          return;
        }

        const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || !(activeFile instanceof TFile) || activeFile.extension !== "md") {
          this.sessionManager.destroy();
          return;
        }

        this.sessionManager.switchTo(activeFile);
      })
    );
  }

  private registerDeleteEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        console.log(`Delete file ${file.path}`);
      })
    );
  }

  private registerCreateEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file: TAbstractFile) => {
        console.log("Create file:", file.path);
      })
    );
  }
}
```

- [ ] **Step 2: 修改 main.ts 使用 SyncHandler**

```typescript
// src/main.ts — 删除所有事件注册代码（create/modify/rename/delete 事件）
// 新增 import:
import { SyncHandler } from "./sync-handler";

// onload() 中，替换事件注册为:
this.app.workspace.onLayoutReady(() => {
  const syncHandler = new SyncHandler(this, this.sessionManager);
  syncHandler.registerEvents();
});
```

注意：原来的 `file-open` 事件保留在 main.ts 中（它属于 session switching，不属于 sync）。

- [ ] **Step 3: main.ts 中添加必要的 import**

```typescript
// src/main.ts — 确保以下 imports 存在
import { Plugin, TFile, type TAbstractFile, Notice } from "obsidian";
// 删除不再需要的 imports:
// - @hocuspocus/provider (已移到 session-manager.ts)
// - diff-match-patch (已移到 sync-handler.ts)
// - y-indexeddb (已移到 session-manager.ts)
// - yjs (已移到 session-manager.ts)
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/sync-handler.ts src/main.ts
git commit -m "refactor: extract SyncHandler class with debounce for file events"
```

---

## Phase 3: 性能优化

### Task 3.1: 全量同步进度反馈

**Files:**
- Modify: `src/setting-tab.ts`

- [ ] **Step 1: 添加进度计数到 vault sync**

```typescript
// src/setting-tab.ts — 修改 onClick 回调中的 for 循环
button.setIcon("folder-sync").onClick(async () => {
  const baseUrl = `${this.plugin.settings.endpoint}/api`;
  const notice = new Notice("Syncing vault...", 0);
  const formData = new FormData();
  const files = this.app.vault.getFiles();

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await this.app.vault.readBinary(file);
      const mimeType = file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);
      const blob = new Blob([content], { type: mimeType });
      formData.append("files", blob, encodeURIComponent(file.path));

      // Update progress every 5 files to avoid excessive DOM updates
      if ((i + 1) % 5 === 0 || i === files.length - 1) {
        notice.setMessage(`Syncing vault... (${i + 1}/${files.length} files)`);
      }
    }

    // ... rest of try block unchanged
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/setting-tab.ts
git commit -m "feat: add progress feedback during vault sync"
```

---

## Phase 4: 工具链与配置现代化

### Task 4.1: 升级 TypeScript 和依赖

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: 更新 package.json 中的版本**

```json
// package.json — 修改 devDependencies
"devDependencies": {
  "@biomejs/biome": "2.1.4",
  "@types/diff-match-patch": "^1.0.36",
  "@types/node": "^22.0.0",
  "@types/spark-md5": "^3.0.5",
  "builtin-modules": "3.3.0",
  "esbuild": "0.17.3",
  "obsidian": "latest",
  "tslib": "2.4.0",
  "typescript": "^5.5.0"
}
```

删除以下 devDependencies：
```json
// 删除:
"@typescript-eslint/eslint-plugin": "5.29.0",
"@typescript-eslint/parser": "5.29.0",
```

- [ ] **Step 2: 更新 tsconfig.json**

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2020",
    "allowJs": true,
    "noImplicitAny": false,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES2020"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: 安装更新的依赖**

Run: `npm install`
Expected: Installs TypeScript 5.x and @types/node 22.x, removes ESLint packages.

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors with new TypeScript version.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: upgrade TypeScript to 5.x and @types/node to 22.x"
```

---

### Task 4.2: 移除 ESLint，只保留 Biome

**Files:**
- Delete: `.eslintrc`
- Modify: `.eslintignore` → Delete
- Modify: `biome.json`

- [ ] **Step 1: 删除 ESLint 配置文件**

```bash
rm .eslintrc .eslintignore
```

- [ ] **Step 2: 更新 biome.json 强化未使用导入检查**

```json
// biome.json — 在 linter.rules.correctness 中将 noUnusedImports 改为 error
"correctness": {
  "noUnusedImports": {
    "level": "error",
    "options": {}
  }
}
```

- [ ] **Step 3: 运行 Biome 检查**

Run: `npx biome check src/`
Expected: No errors (warnings are acceptable, fix any errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove ESLint in favor of Biome, enforce noUnusedImports"
```

---

### Task 4.3: 删除 .editorconfig 并精简 esbuild 配置

**Files:**
- Delete: `.editorconfig`
- Modify: `esbuild.config.mjs`

- [ ] **Step 1: 删除 .editorconfig**

```bash
rm .editorconfig
```

- [ ] **Step 2: 精简 esbuild.config.mjs external 列表**

```javascript
// esbuild.config.mjs — 移除所有 @codemirror/* 和 @lezer/* external entries
// 保留:
external: [
  "obsidian",
  "electron",
  ...builtins,
],
```

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: Build succeeds, no errors about missing externals.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove .editorconfig, clean up esbuild externals"
```

---

## Phase 5: 功能完整性

### Task 5.1: 添加 deleteNote 和 renameNote API

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: 添加新 API 函数**

```typescript
// src/api.ts — 在 publish 函数后添加

export const deleteNote = async (baseUrl: string, vault: string, filePath: string) => {
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${vault}/notes/${encodeURIComponent(filePath)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const renameNote = async (baseUrl: string, vault: string, oldPath: string, newPath: string) => {
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${vault}/notes/${encodeURIComponent(oldPath)}/rename`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath }),
    }
  );

  if (!response.ok) {
    throw new Error(`Rename failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat: add deleteNote and renameNote API functions"
```

---

### Task 5.2: 在事件处理中调用删除/重命名 API

**Files:**
- Modify: `src/sync-handler.ts`

- [ ] **Step 1: 更新 delete 事件处理**

```typescript
// src/sync-handler.ts — 修改 registerDeleteEvent
import { deleteNote, renameNote } from "./api";

private registerDeleteEvent(): void {
  this.plugin.registerEvent(
    this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
      console.log(`Delete file ${file.path}`);

      // Only sync .md files
      if (file instanceof TFile && file.extension === "md") {
        const baseUrl = `${this.plugin.settings.endpoint}/api`;
        deleteNote(baseUrl, this.plugin.vaultName, file.path).catch((error) => {
          console.error(`Failed to sync deletion of ${file.path}:`, error);
        });
      }
    })
  );
}
```

- [ ] **Step 2: 更新 rename 事件处理**

```typescript
// src/sync-handler.ts — 修改 registerRenameEvent，在 session switch 之前添加 API 调用
private registerRenameEvent(): void {
  this.plugin.registerEvent(
    this.plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      console.log(`Rename file from ${oldPath} to ${file.path}`);

      // Sync rename to server
      if (file instanceof TFile && file.extension === "md") {
        const baseUrl = `${this.plugin.settings.endpoint}/api`;
        renameNote(baseUrl, this.plugin.vaultName, oldPath, file.path).catch((error) => {
          console.error(`Failed to sync rename from ${oldPath} to ${file.path}:`, error);
        });
      }

      if (oldPath !== this.sessionManager.filePath) {
        return;
      }

      const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
      if (!activeFile || !(activeFile instanceof TFile) || activeFile.extension !== "md") {
        this.sessionManager.destroy();
        return;
      }

      this.sessionManager.switchTo(activeFile);
    })
  );
}
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/sync-handler.ts
git commit -m "feat: sync file deletions and renames to server"
```

---

### Task 5.3: WebSocket 连接添加认证 token

**Files:**
- Modify: `src/session-manager.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: SessionManager 接受 accessToken 参数**

```typescript
// src/session-manager.ts — 修改 constructor
constructor(
  private vaultName: string,
  private endpoint: string,
  private accessToken: string
) {}
```

- [ ] **Step 2: switchTo 中传递 token 到 HocuspocusProvider**

```typescript
// src/session-manager.ts — 在 switchTo 方法中，HocuspocusProvider 构造选项添加 token
const provider = new HocuspocusProvider({
  url: wsUrl,
  name: docName,
  token: this.accessToken,
  // ... rest of options unchanged
});
```

- [ ] **Step 3: main.ts 传递 accessToken**

```typescript
// src/main.ts — onload() 中更新 SessionManager 初始化
this.sessionManager = new SessionManager(
  this.vaultName,
  this.settings.endpoint,
  this.settings.accessToken
);
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/session-manager.ts src/main.ts
git commit -m "feat: pass access token for WebSocket authentication"
```

---

### Task 5.4: 最终验证

- [ ] **Step 1: 运行完整构建**

Run: `npm run build`
Expected: tsc noEmit passes, esbuild produces main.js successfully.

- [ ] **Step 2: Run Biome lint and format check**

Run: `npx biome check src/`
Expected: No errors.

- [ ] **Step 3: 最终 review**

检查 main.js 大小是否合理，确认所有导入路径正确。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final verification — all phases complete"
```

---

## Summary

| Phase | Tasks | Files Created | Files Modified | Files Deleted |
|-------|-------|---------------|----------------|---------------|
| 1 | 1.1-1.4 | 0 | 2 (api.ts, main.ts, setting-tab.ts) | 0 |
| 2 | 2.1-2.3 | 3 (constants.ts, types.ts, session-manager.ts, sync-handler.ts) | 1 (main.ts) | 0 |
| 3 | 3.1 | 0 | 1 (setting-tab.ts) | 0 |
| 4 | 4.1-4.3 | 0 | 3 (package.json, tsconfig.json, biome.json, esbuild.config.mjs) | 2 (.eslintrc, .editorconfig) |
| 5 | 5.1-5.4 | 0 | 3 (api.ts, sync-handler.ts, session-manager.ts, main.ts) | 0 |

**Total: 14 tasks, 4 new files, 7 modified files, 2 deleted files.**
