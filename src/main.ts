// @ts-ignore
import { HocuspocusProvider } from "@hocuspocus/provider";
import { type Diff, diff_match_patch } from "diff-match-patch";
import { Plugin, type TAbstractFile, type TFile } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import { publish } from "./api";
import Ob2JadeSettingTab from "./setting-tab";

interface JadePublisherSettings {
  endpoint: string;
  accessToken: string;
}

const DEFAULT_SETTINGS: JadePublisherSettings = {
  endpoint: "",
  accessToken: "",
};

export enum NoteStatus {
  CREATED = "created",
  MODIFIED = "modified",
  DELETED = "deleted",
  RENAMED = "renamed",
}

const dmp = new diff_match_patch();
const LOCAL_ORIGIN = "Obsidian";
const WEBSOCKET_SERVER_URL = "ws://127.0.0.1:8080/hocuspocus";

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

  private destroyActiveDocSession() {
    if (this.activeProvider && this.activeDocUpdateHandler) {
      this.activeProvider.document.off("updateV2", this.activeDocUpdateHandler);
    }

    this.activeProvider?.configuration.websocketProvider.disconnect();
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

    const provider = new HocuspocusProvider({
      url: WEBSOCKET_SERVER_URL,
      name: docName,
      onConnect: () => {
        console.log(`Doc "${docName}" connects to server successfully!`);
      },
      onSynced: ({ state }) => {
        console.log(`Restore doc "${docName}" from server ${state ? "successfully" : "failed"}!`);
      },
      onOutgoingMessage: ({ message }) => {
        // console.log("outgoing message", this.noteRoot.toJSON(), message);
      },
      onDestroy: () => {
        console.log(`Provider of doc "${docName}" destroyed`);
      },
    });

    const indexeddbPersistence = new IndexeddbPersistence(docName, provider.document);

    const updateHandler = (_, origin, doc, transaction) => {
      console.log(
        "Receive update, origin:",
        origin,
        "doc:",
        doc,
        "transaction:",
        transaction,
        "current client ID:",
        this.activeProvider?.document.clientID
      );

      if (origin === LOCAL_ORIGIN) {
        console.log("Echo update, ignore");
        return;
      }

      if (origin === this.activeIndexeddbPersistence) {
        console.log("IndexedDB update(used to restore doc), ignore");
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

        this.switchActiveDocSession(file);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (file === activeFile) {
          if (!this.activeProvider) {
            console.log(`Active hocuspocus provider of ${file.path} not found, skip syncing`);
            return;
          }

          const changed = this.app.vault.cachedRead(activeFile);

          changed.then((text) => {
            const doc: Y.Doc = this.activeProvider.document;
            const content = doc.getText("content");

            const origin = content.toString();
            const diffs: Diff[] = dmp.diff_main(origin, text);

            // Optimize the diff
            dmp.diff_cleanupSemantic(diffs);

            // Initialize the cursor position
            let cursor = 0;

            // Apply the diffs as updates to the YDoc
            doc.transact(() => {
              for (const [operation, text] of diffs) {
                switch (operation) {
                  case 1: // Insert
                    // console.log(`Inserting "${text}" at position ${cursor}`);
                    content.insert(cursor, text);
                    cursor += text.length;
                    break;
                  case 0: // Equal
                    // console.log(`Keeping "${text}" (length: ${text.length})`);
                    cursor += text.length;
                    break;
                  case -1: // Delete
                    // console.log(`Deleting "${text}" at position ${cursor}`);
                    content.delete(cursor, text.length);
                    break;
                }
                // console.log("intermediate", ytext.toString());
              }
            }, LOCAL_ORIGIN);
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
        if (!activeFile) {
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
      const baseUrl = `http://127.0.0.1:8080/api`;
      publish(baseUrl, this.vaultName).then((resp) => {
        console.log("Publish Resp", resp);
      });
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
