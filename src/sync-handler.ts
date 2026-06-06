import type { Diff } from "diff-match-patch";
import { type TAbstractFile, TFile } from "obsidian";
import type * as Y from "yjs";
import { deleteNote, renameNote } from "./api";
import { dmp } from "./constants";
import type JadePublisherPlugin from "./main";
import type { SessionManager } from "./session-manager";

export class SyncHandler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;

  constructor(
    private plugin: JadePublisherPlugin,
    private sessionManager: SessionManager
  ) {}

  registerEvents(): void {
    this.registerModifyEvent();
    this.registerRenameEvent();
    this.registerDeleteEvent();
    this.registerCreateEvent();
  }

  private registerModifyEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }

        const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
        if (file !== activeFile) {
          return;
        }

        const capturedProvider = this.sessionManager.provider;
        const capturedFilePath = this.sessionManager.filePath;

        if (!capturedProvider || !capturedFilePath) {
          console.log(`Provider not available for ${file.path}, skip syncing`);
          return;
        }

        // Debounce: clear previous pending sync
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.handleModify(file, capturedProvider.document as Y.Doc, capturedFilePath);
        }, this.DEBOUNCE_MS);
      })
    );
  }

  private async handleModify(file: TFile, doc: Y.Doc, filePath: string): Promise<void> {
    // Re-verify provider hasn't changed after debounce
    if (this.sessionManager.provider?.document !== doc) {
      console.log(`Provider switched during debounce for ${file.path}, skip syncing`);
      return;
    }

    try {
      const text = await this.plugin.app.vault.cachedRead(file);

      // Re-check after async read
      if (this.sessionManager.provider?.document !== doc || this.sessionManager.filePath !== filePath) {
        console.log(`Provider switched during async read for ${file.path}, skip syncing`);
        return;
      }

      const content = doc.getText("content");
      const oldContent = content.toString();
      const diffs: Diff[] = dmp.diff_main(oldContent, text);

      dmp.diff_cleanupSemantic(diffs);

      let cursor = 0;

      doc.transact(() => {
        for (const [operation, diffText] of diffs) {
          switch (operation) {
            case 1:
              content.insert(cursor, diffText);
              cursor += diffText.length;
              break;
            case 0:
              cursor += diffText.length;
              break;
            case -1:
              content.delete(cursor, diffText.length);
              break;
          }
        }
      }, null);
    } catch (error) {
      console.error(`Failed to sync modifications for ${file.path}:`, error);
    }
  }

  private registerRenameEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        console.log(`Rename file from ${oldPath} to ${file.path}`);

        // Sync rename to server
        if (file instanceof TFile && file.extension === "md") {
          const baseUrl = `${this.plugin.settings.endpoint}/api`;
          renameNote(baseUrl, this.plugin.vaultName, oldPath, file.path).catch((error) => {
            console.error(`Failed to sync rename from ${oldPath} to ${file.path}:`, error);
          });
        }

        if (oldPath !== this.sessionManager.filePath) {
          return;
        }

        const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || !(activeFile instanceof TFile) || activeFile.extension !== "md") {
          this.sessionManager.destroy();
          return;
        }

        this.sessionManager.switchTo(activeFile);
      })
    );
  }

  private registerDeleteEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        console.log(`Delete file ${file.path}`);

        if (file instanceof TFile && file.extension === "md") {
          const baseUrl = `${this.plugin.settings.endpoint}/api`;
          deleteNote(baseUrl, this.plugin.vaultName, file.path).catch((error) => {
            console.error(`Failed to sync deletion of ${file.path}:`, error);
          });
        }
      })
    );
  }

  private registerCreateEvent(): void {
    this.plugin.app.workspace.onLayoutReady(() => {
      this.plugin.registerEvent(
        this.plugin.app.vault.on("create", (file: TAbstractFile) => {
          console.log("Create file:", file.path);
        })
      );
    });
  }
}
