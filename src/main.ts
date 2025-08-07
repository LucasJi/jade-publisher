import { type App, moment, Notice, Plugin, type PluginManifest, type TAbstractFile, type TFile } from "obsidian";
import * as SparkMD5 from "spark-md5";
import { checkHealth, rebuild, sync } from "./api";
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
  state: {
    files: {},
    lastSyncTime: 0,
  },
  accessToken: "",
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

    this.addRibbonIcon("cloud-upload", "Sync your changes to Jade", async () => {
      if (!this.settings.endpoint) {
        new Notice("Please setup your Jade endpoint");
        return;
      }
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
