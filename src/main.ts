import { Notice, Plugin, type TAbstractFile, TFile } from "obsidian";
import { publish } from "./api";
import { DEFAULT_SETTINGS } from "./constants";
import { SessionManager } from "./session-manager";
import Ob2JadeSettingTab from "./setting-tab";
import { SyncHandler } from "./sync-handler";
import type { JadePublisherSettings } from "./types";

export default class JadePublisherPlugin extends Plugin {
  settings: JadePublisherSettings;
  vaultName = "";
  private sessionManager!: SessionManager;

  private isMarkdownFile(file: TAbstractFile | null): boolean {
    return file instanceof TFile && file.extension === "md";
  }

  async onload() {
    await this.loadSettings();
    this.vaultName = this.app.vault.getName();
    this.sessionManager = new SessionManager(
      this.vaultName,
      this.settings.endpoint,
      this.settings.accessToken,
      (file, _doc, content, _filePath) => {
        this.app.vault.modify(file, content.toString());
      }
    );

    const syncHandler = new SyncHandler(this, this.sessionManager);
    syncHandler.registerEvents();

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        console.log("Opened file:", file?.name);

        if (!file) {
          return;
        }

        if (this.isMarkdownFile(file)) {
          this.sessionManager.switchTo(file);
        } else {
          this.sessionManager.destroy();
        }
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
    this.sessionManager.destroy();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
