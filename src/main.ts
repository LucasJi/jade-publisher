// @ts-ignore
import { HocuspocusProvider } from "@hocuspocus/provider";
import { type Diff, diff_match_patch } from "diff-match-patch";
import { Plugin, type TAbstractFile, type TFile } from "obsidian";
import * as Y from "yjs";
import { syncDoc } from "./api";
import Ob2JadeSettingTab from "./setting-tab";
import type { StateData } from "./utils/file-tracker";
import { FileTracker } from "./utils/file-tracker";

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

const ydoc = new Y.Doc();
const ytext = ydoc.getText("textarea");
const yXmlF = ydoc.getXmlFragment("body");

const provider = new HocuspocusProvider({
  url: "ws://127.0.0.1:3001/hocuspocus",
  name: "demo",
  document: ydoc,
});

const dmp = new diff_match_patch();

export default class JadePublisherPlugin extends Plugin {
  settings: JadePublisherSettings;
  fileTracker: FileTracker;

  async onload() {
    await this.loadSettings();
    this.loadFileTracker(this.settings.state);

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file: TAbstractFile) => {
          this.fileTracker.trackCreated(file.path);
          this.saveSettings();
        })
      );
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (file === activeFile) {
          this.fileTracker.trackModified(file.path);
          this.saveSettings();

          const changed = this.app.vault.cachedRead(activeFile);
          changed.then((text) => {
            const currentContent = ytext.toString();
            const diffs: Diff[] = dmp.diff_main(currentContent, text);

            console.log(yXmlF.toJSON());

            // Optimize the diff
            dmp.diff_cleanupSemantic(diffs);

            // Initialize the cursor position
            let cursor = 0;

            // Apply the diffs as updates to the YDoc
            ydoc.transact(() => {
              for (const [operation, text] of diffs) {
                switch (operation) {
                  case 1: // Insert
                    console.log(`Inserting "${text}" at position ${cursor}`);
                    ytext.insert(cursor, text);
                    cursor += text.length;
                    break;
                  case 0: // Equal
                    console.log(`Keeping "${text}" (length: ${text.length})`);
                    cursor += text.length;
                    break;
                  case -1: // Delete
                    console.log(`Deleting "${text}" at position ${cursor}`);
                    ytext.delete(cursor, text.length);
                    break;
                }
                console.log("intermediate", ytext.toString());
              }
            });
          });
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        this.fileTracker.trackRenamed(oldPath, file.path);
        this.saveSettings();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.fileTracker.trackDeleted(file.path);
        this.saveSettings();
      })
    );

    this.addRibbonIcon("cloud-upload", "Sync to Jade", async () => {
      const operations = this.fileTracker.generateSyncOperations();
      for (const operation of operations) {
        const file = this.app.vault.getFileByPath(operation.path);
        if (!file) {
          continue;
        }
        syncDoc({
          path: operation.path,
          content: await this.app.vault.read(file),
          lastPatchId: operation.lastPatchId,
          operation: operation.operation,
        }).then(async ({ data = {} }) => {
          console.log("sync resp", data);
          const { patchId, content } = data;
          if (patchId) {
            this.fileTracker.updateLastPatchId(operation.path, patchId);
          }

          if (content !== undefined) {
            await this.app.vault.modify(file, content);
          }
        });
      }
      this.fileTracker.markSynced();
      this.saveSettings();
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new Ob2JadeSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  loadFileTracker(state: StateData) {
    this.fileTracker = new FileTracker(state);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
