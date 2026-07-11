// src/session-manager.ts
// @ts-ignore
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { TFile } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { WEBSOCKET_PATH } from "./constants";

export class SessionManager {
  private activeProvider: HocuspocusProvider | null = null;
  private activeIndexeddbPersistence: IndexeddbPersistence | null = null;
  private activeFilePath: string | null = null;
  private activeDocName: string | null = null;
  private activeDocUpdateHandler:
    | ((update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void)
    | null = null;
  private sessionGeneration = 0;

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
    const wsUrl = `${this.endpoint.replace(/^http/, "ws").replace(/\/+$/, "")}${WEBSOCKET_PATH}`;

    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: docName,
      token: this.getToken() as string | (() => string) | (() => Promise<string>) | null,
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

    provider.document.on("updateV2", updateHandler);

    this.activeProvider = provider;
    this.activeIndexeddbPersistence = indexeddbPersistence;
    this.activeFilePath = filePath;
    this.activeDocName = docName;
    this.activeDocUpdateHandler = updateHandler;
  }
}
