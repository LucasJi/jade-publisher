// @ts-ignore
import { HocuspocusProvider } from "@hocuspocus/provider";
import { type Diff, diff_match_patch } from "diff-match-patch";
import { Plugin, type TAbstractFile, TFile } from "obsidian";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import Ob2JadeSettingTab from "./setting-tab";
import type { StateData } from "./utils/file-tracker";

interface JadePublisherSettings {
  endpoint: string;
  state: StateData;
  accessToken: string;
}

const DEFAULT_SETTINGS: JadePublisherSettings = {
  endpoint: "",
  accessToken: "",
  state: {
    files: {},
    lastSyncTime: 0,
  },
};

export enum NoteStatus {
  CREATED = "created",
  MODIFIED = "modified",
  DELETED = "deleted",
  RENAMED = "renamed",
}

const dmp = new diff_match_patch();
const LOCAL_ORIGIN = "Obsidian";

export default class JadePublisherPlugin extends Plugin {
  settings: JadePublisherSettings;
  doc: Y.Doc;
  noteRoot: Y.Map<Y.Text>;

  async onload() {
    await this.loadSettings();

    // yjs
    this.doc = new Y.Doc();
    this.noteRoot = this.doc.getMap("noteRoot");
    const vaultName = this.app.vault.getName();

    const provider = new HocuspocusProvider({
      url: "ws://127.0.0.1:3001/hocuspocus",
      name: vaultName,
      document: this.doc,
      onSynced: ({ state }) => {
        console.log(`Restore doc from server ${state ? "successfully" : "failed"}!`);
      },
      onOutgoingMessage: () => {
        console.log("out going message", this.noteRoot.toJSON());
      },
    });

    const indexeddbPersistence = new IndexeddbPersistence(vaultName, this.doc);
    indexeddbPersistence.on("synced", () => {
      console.log("Restore doc from indexedDB successfully!");
    });

    this.doc.on("updateV2", (_, origin, doc, transaction) => {
      console.log(
        "Receive update, origin:",
        origin,
        "doc:",
        doc,
        "transaction:",
        transaction,
        "current client ID:",
        this.doc.clientID
      );
      if (origin === LOCAL_ORIGIN) {
        console.log("Echo update, ignore");
        return;
      }

      if (origin === indexeddbPersistence) {
        console.log("IndexedDB update(used to restore doc), ignore");
        return;
      }

      if (origin === provider) {
        console.log("Server update, try to sync");
        console.log("Changes:", transaction.changed, "origin:", transaction.origin);
        transaction.changed.forEach((_, type) => {
          this.noteRoot.forEach((t, p) => {
            if (t === type) {
              console.log(`Doc ${p} changed, try to sync`);
              const content = t.toString();
              console.log("Latest content:", content);
              const file = this.app.vault.getAbstractFileByPath(p);
              if (file && file instanceof TFile) {
                this.app.vault.modify(file, content);
              }
            }
          });
        });
        return;
      }

      console.log("Unknown origin, ignore");
    });

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file: TAbstractFile) => {
          this.noteRoot.set(file.path, new Y.Text());
        })
      );
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        console.log("Opened file:", file?.name);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (file === activeFile) {
          console.log("modify");
          this.saveSettings();

          const changed = this.app.vault.cachedRead(activeFile);

          changed.then((text) => {
            let yText = this.noteRoot.get(file.path);

            if (!yText) {
              yText = new Y.Text();
              this.noteRoot.set(file.path, yText);
            }

            const currentContent = yText.toString();
            const diffs: Diff[] = dmp.diff_main(currentContent, text);

            // Optimize the diff
            dmp.diff_cleanupSemantic(diffs);

            // Initialize the cursor position
            let cursor = 0;

            // Apply the diffs as updates to the YDoc
            this.doc.transact(() => {
              for (const [operation, text] of diffs) {
                switch (operation) {
                  case 1: // Insert
                    // console.log(`Inserting "${text}" at position ${cursor}`);
                    yText?.insert(cursor, text);
                    cursor += text.length;
                    break;
                  case 0: // Equal
                    // console.log(`Keeping "${text}" (length: ${text.length})`);
                    cursor += text.length;
                    break;
                  case -1: // Delete
                    // console.log(`Deleting "${text}" at position ${cursor}`);
                    yText?.delete(cursor, text.length);
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
        const text = this.noteRoot.get(oldPath);
        if (text) {
          // If text._pending is null, console will show an error log which can be ignored
          this.noteRoot.set(file.path, text.clone());
        } else {
          this.noteRoot.set(file.path, new Y.Text());
        }

        this.noteRoot.delete(oldPath);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.noteRoot.delete(file.path);
      })
    );

    this.addRibbonIcon("cloud-upload", "Sync to Jade", async () => {
      const files = this.app.vault.getFiles();
      const filePaths = files.map((file) => file.path);
      for (const key of this.noteRoot.keys()) {
        if (!filePaths.includes(key)) {
          this.noteRoot.delete(key);
        }
      }
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new Ob2JadeSettingTab(this.app, this));
  }

  onunload() {
    console.log("onunload");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
