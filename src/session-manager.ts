// src/session-manager.ts
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { TFile } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { WEBSOCKET_PATH } from "./constants";

export class SessionManager {
  private activeProvider: HocuspocusProvider | null = null;
  private activeIndexeddbPersistence: IndexeddbPersistence | null = null;
  private activeDoc: Y.Doc | null = null;
  private activeFilePath: string | null = null;
  private activeDocName: string | null = null;
  private activeDocUpdateHandler:
    | ((update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void)
    | null = null;
  private sessionGeneration = 0;

  onProviderConnected: (() => void) | null = null;
  onProviderDisconnected: (() => void) | null = null;

  constructor(
    private vaultName: string,
    private endpoint: string,
    private getToken: () => string | null | Promise<string | null>,
    private onServerUpdate: (file: TFile, doc: Y.Doc, content: Y.Text, filePath: string) => void
  ) {}

  get docName(): string | null {
    return this.activeDocName;
  }

  get provider(): HocuspocusProvider | null {
    return this.activeProvider;
  }

  get doc(): Y.Doc | null {
    return this.activeDoc;
  }

  get filePath(): string | null {
    return this.activeFilePath;
  }

  deleteOfflineData(docName: string): void {
    const request = indexedDB.deleteDatabase(docName);
    request.onerror = () => {
      console.warn(`Failed to delete IndexedDB for ${docName}`);
    };
    request.onsuccess = () => {
      console.log(`Deleted IndexedDB for ${docName}`);
    };
  }

  destroy(): void {
    this.sessionGeneration++;

    if (this.activeDoc && this.activeDocUpdateHandler) {
      this.activeDoc.off("updateV2", this.activeDocUpdateHandler);
    }

    if (this.activeProvider?.configuration.websocketProvider) {
      this.activeProvider.configuration.websocketProvider.shouldConnect = false;
    }
    this.activeProvider?.destroy();
    this.activeIndexeddbPersistence?.destroy();

    this.activeProvider = null;
    this.activeIndexeddbPersistence = null;
    this.activeDoc = null;
    this.activeFilePath = null;
    this.activeDocName = null;
    this.activeDocUpdateHandler = null;
  }

  async flushOfflineMutations(onProgress: (synced: number, total: number) => void = () => {}): Promise<number> {
    if (typeof indexedDB?.databases !== "function") {
      console.log("indexedDB.databases() not available, skip offline flush");
      return 0;
    }

    let databases: { name?: string }[];
    try {
      databases = await indexedDB.databases();
    } catch {
      console.log("Failed to list IndexedDB databases, skip offline flush");
      return 0;
    }

    const vaultPrefix = `${this.vaultName}/`;
    const vaultDocNames = databases
      .filter((db): db is { name: string } => db.name != null && db.name.startsWith(vaultPrefix))
      .map((db) => db.name);

    const inactiveDocNames = vaultDocNames.filter((n) => n !== this.activeDocName);

    if (inactiveDocNames.length === 0) {
      return 0;
    }

    const token = await this.getToken();
    if (!token) {
      console.log("No auth token available, skip offline flush");
      return 0;
    }

    const wsUrl = `${this.endpoint.replace(/^http/, "ws").replace(/\/+$/, "")}${WEBSOCKET_PATH}`;
    let syncedCount = 0;
    const total = inactiveDocNames.length;

    onProgress(0, total);

    for (const docName of inactiveDocNames) {
      const doc = new Y.Doc();
      const indexeddbPersistence = new IndexeddbPersistence(docName, doc);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        indexeddbPersistence.on("synced", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const provider = new HocuspocusProvider({
        url: wsUrl,
        name: docName,
        document: doc,
        token,
      });

      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          settled = true;
          provider.destroy();
          indexeddbPersistence.destroy();
          resolve();
        }, 15000);

        const cleanup = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          provider.destroy();
          indexeddbPersistence.destroy();
          resolve();
        };

        provider.on("synced", cleanup);
        provider.on("connectionError", cleanup);
      });

      syncedCount++;
      onProgress(syncedCount, total);
    }

    return syncedCount;
  }

  async switchTo(file: TFile, forceReconnect = false): Promise<void> {
    const filePath = file.path;
    const docName = `${this.vaultName}/${filePath}`;

    if (this.activeDocName === docName && !forceReconnect) {
      return;
    }

    this.destroy();

    const generation = this.sessionGeneration;

    const ydoc = new Y.Doc();
    const indexeddbPersistence = new IndexeddbPersistence(docName, ydoc);

    const token = await this.getToken();

    let provider: HocuspocusProvider | null = null;

    if (token) {
      const wsUrl = `${this.endpoint.replace(/^http/, "ws").replace(/\/+$/, "")}${WEBSOCKET_PATH}`;

      provider = new HocuspocusProvider({
        url: wsUrl,
        name: docName,
        document: ydoc,
        token,
        onConnect: () => {
          if (generation !== this.sessionGeneration) return;
          console.log(`Doc "${docName}" connects to server successfully!`);
          this.onProviderConnected?.();
        },
        onDisconnect: () => {
          if (generation !== this.sessionGeneration) return;
          console.log(`Doc "${docName}" disconnected from server`);
          this.onProviderDisconnected?.();
        },
        onSynced: ({ state }) => {
          if (generation !== this.sessionGeneration) return;
          console.log(`Restore doc "${docName}" from server ${state ? "successfully" : "failed"}!`);
        },
        onDestroy: () => {
          console.log(`Provider of doc "${docName}" destroyed`);
        },
      });
    } else {
      console.log(`No auth token, skipping WebSocket for "${docName}"`);
    }

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
          if (type instanceof Y.Text) {
            console.log(`Doc ${filePath} changed, try to sync`);
            console.log("Latest content:", content);
            this.onServerUpdate(file, doc, content, filePath);
          }
        });
        return;
      }

      console.log("Unknown origin, ignore");
    };

    ydoc.on("updateV2", updateHandler);

    this.activeProvider = provider;
    this.activeIndexeddbPersistence = indexeddbPersistence;
    this.activeDoc = ydoc;
    this.activeFilePath = filePath;
    this.activeDocName = docName;
    this.activeDocUpdateHandler = updateHandler;
  }
}
