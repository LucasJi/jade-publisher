// @ts-ignore
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Diff } from "diff-match-patch";
import { Plugin, TFile, type TAbstractFile, Notice } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import { publish } from "./api";
import Ob2JadeSettingTab from "./setting-tab";
import { DEFAULT_SETTINGS, dmp, WEBSOCKET_PATH } from "./constants";
import type { JadePublisherSettings } from "./types";

export default class JadePublisherPlugin extends Plugin {
  settings: JadePublisherSettings;
  vaultName = "";
  activeProvider: HocuspocusProvider | null = null;
  activeIndexeddbPersistence: IndexeddbPersistence | null = null;
  activeFilePath: string | null = null;
  activeDocName: string | null = null;
  activeDocUpdateHandler:
    | ((update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void)
    | null = null;
  // Incremented on each session switch, used to ignore stale async callbacks
  sessionGeneration = 0;

  private isMarkdownFile(file: TAbstractFile | null): boolean {
    return file instanceof TFile && file.extension === "md";
  }

  private destroyActiveDocSession() {
    this.sessionGeneration++;

    if (this.activeProvider && this.activeDocUpdateHandler) {
      this.activeProvider.document.off("updateV2", this.activeDocUpdateHandler);
    }

    // Prevent the old websocket from reconnecting after destroy
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

  private switchActiveDocSession(file: TFile) {
    const filePath = file.path;
    const docName = `${this.vaultName}/${filePath}`;

    if (this.activeDocName === docName) {
      return;
    }

    this.destroyActiveDocSession();

    // Capture the generation at session creation time so stale callbacks are ignored
    const generation = this.sessionGeneration;

    const provider = new HocuspocusProvider({
      url: `${this.settings.endpoint.replace(/^http/, "ws").replace(/\/+$/, "")}${WEBSOCKET_PATH}`,
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

      // null/undefined origin = local changes applied by this plugin's modify handler
      if (origin === null || origin === undefined) {
        console.log("Local update, provider will sync to server");
        return;
      }

      if (origin === indexeddbPersistence) {
        console.log("IndexedDB update (used to restore doc), ignore");
        return;
      }

      // Server update (applied by the HocuspocusProvider): apply to the local file
      if (origin === this.activeProvider) {
        console.log("Server update, try to sync");
        console.log("Changes:", transaction.changed, ", origin:", transaction.origin);
        const content = doc.getText("content");
        transaction.changed.forEach((_, type) => {
          if (content === type) {
            console.log(`Doc ${filePath} changed, try to sync`);
            console.log("Latest content:", content);
            this.app.vault.modify(file, content.toString());
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

  async onload() {
    await this.loadSettings();
    this.vaultName = this.app.vault.getName();

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file: TAbstractFile) => {
          console.log("Create file:", file.path);
        })
      );
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        console.log("Opened file:", file?.name);

        if (!file) {
          return;
        }

        if (this.isMarkdownFile(file)) {
          this.switchActiveDocSession(file);
        } else {
          this.destroyActiveDocSession();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.isMarkdownFile(file)) {
          return;
        }

        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (file === activeFile) {
          // Capture provider reference before async operation to prevent race conditions
          const capturedProvider = this.activeProvider;
          const capturedFilePath = this.activeFilePath;

          if (!capturedProvider) {
            console.log(`Active hocuspocus provider of ${file.path} not found, skip syncing`);
            return;
          }

          const changed = this.app.vault.cachedRead(activeFile);

          changed.then((text) => {
            try {
              // Verify the provider hasn't changed during the async read
              if (this.activeProvider !== capturedProvider || this.activeFilePath !== capturedFilePath) {
                console.log(`Provider switched during async read for ${file.path}, skip syncing`);
                return;
              }

              const doc: Y.Doc = capturedProvider.document;
              const content = doc.getText("content");

              const oldContent = content.toString();
              const diffs: Diff[] = dmp.diff_main(oldContent, text);

              // Optimize the diff
              dmp.diff_cleanupSemantic(diffs);

              // Initialize the cursor position
              let cursor = 0;

              // Apply the diffs as updates to the YDoc
              // Use null origin so the Hocuspocus Provider treats this as a local change to sync
              doc.transact(() => {
                for (const [operation, diffText] of diffs) {
                  switch (operation) {
                    case 1: // Insert
                      content.insert(cursor, diffText);
                      cursor += diffText.length;
                      break;
                    case 0: // Equal
                      cursor += diffText.length;
                      break;
                    case -1: // Delete
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
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        console.log(`rename file from ${oldPath} to ${file.path}`);

        if (oldPath !== this.activeFilePath) {
          return;
        }

        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isMarkdownFile(activeFile)) {
          this.destroyActiveDocSession();
          return;
        }

        this.switchActiveDocSession(activeFile);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        console.log(`delete file ${file.path}`);
      })
    );

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

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new Ob2JadeSettingTab(this.app, this));
  }

  onunload() {
    console.log("onunload");
    this.destroyActiveDocSession();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
