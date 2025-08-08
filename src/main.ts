import { type App, moment, Notice, Plugin, type PluginManifest, type TAbstractFile, type TFile } from "obsidian";
import * as SparkMD5 from "spark-md5";
import { checkHealth, rebuild, sync, syncDoc } from "./api";

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
