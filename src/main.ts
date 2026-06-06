import type { Diff } from "diff-match-patch";
import { Plugin, TFile, type TAbstractFile, Notice } from "obsidian";
import type * as Y from "yjs";
import { publish } from "./api";
import Ob2JadeSettingTab from "./setting-tab";
import { DEFAULT_SETTINGS, dmp } from "./constants";
import { SessionManager } from "./session-manager";
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
      (file, _doc, content, _filePath) => {
        this.app.vault.modify(file, content.toString());
      }
    );

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
          this.sessionManager.switchTo(file);
        } else {
          this.sessionManager.destroy();
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
          const capturedProvider = this.sessionManager.provider;
          const capturedFilePath = this.sessionManager.filePath;

          if (!capturedProvider) {
            console.log(`Active hocuspocus provider of ${file.path} not found, skip syncing`);
            return;
          }

          const changed = this.app.vault.cachedRead(activeFile);

          changed.then((text) => {
            try {
              // Verify the provider hasn't changed during the async read
              if (this.sessionManager.provider !== capturedProvider || this.sessionManager.filePath !== capturedFilePath) {
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

        if (oldPath !== this.sessionManager.filePath) {
          return;
        }

        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isMarkdownFile(activeFile)) {
          this.sessionManager.destroy();
          return;
        }

        this.sessionManager.switchTo(activeFile);
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
    this.sessionManager.destroy();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
