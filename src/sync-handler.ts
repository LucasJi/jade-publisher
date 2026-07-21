import type { Diff } from "diff-match-patch";
import { type TAbstractFile, TFile } from "obsidian";
import type * as Y from "yjs";
import { dmp } from "./constants";
import type JadePublisherPlugin from "./main";
import type { SessionManager } from "./session-manager";
import type { ContentWriter } from "./types";

export class SyncHandler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;

  constructor(
    private plugin: JadePublisherPlugin,
    private sessionManager: SessionManager,
    private contentWriter: ContentWriter
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

        if (this.contentWriter.isWriting) {
          return;
        }

        const activeFile: TFile | null = this.plugin.app.workspace.getActiveFile();
        if (file !== activeFile) {
          return;
        }

        const capturedDoc = this.sessionManager.doc;
        const capturedFilePath = this.sessionManager.filePath;

        if (!capturedDoc || !capturedFilePath) {
          console.log(`Session not available for ${file.path}, skip syncing`);
          return;
        }

        // Debounce: clear previous pending sync
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.handleModify(file, capturedDoc, capturedFilePath);
        }, this.DEBOUNCE_MS);
      })
    );
  }

  private async handleModify(file: TFile, doc: Y.Doc, filePath: string): Promise<void> {
    // Re-verify doc hasn't changed after debounce
    if (this.sessionManager.doc !== doc) {
      console.log(`Session switched during debounce for ${file.path}, skip syncing`);
      return;
    }

    try {
      const text = await this.plugin.app.vault.cachedRead(file);

      // Re-check after async read
      if (this.sessionManager.doc !== doc || this.sessionManager.filePath !== filePath) {
        console.log(`Session switched during async read for ${file.path}, skip syncing`);
        return;
      }

      const content = doc.getText("content");
      const oldContent = content.toString();
      const diffs: Diff[] = dmp.diff_main(oldContent, text);

      dmp.diff_cleanupSemantic(diffs);

      let cursor = 0;

      doc.transact(() => {
        const currentContent = content.toString();
        if (currentContent !== oldContent) {
          console.log(`Content changed during diff computation for ${file.path}, skip applying diffs`);
          return;
        }

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
      this.plugin.app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
        console.log(`Rename file from ${oldPath} to ${file.path}`);

        // Sync rename to server
        if (file instanceof TFile && file.extension === "md") {
          this.plugin.apiClient.renameNote(oldPath, file.path).catch((error) => {
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

        await this.sessionManager.switchTo(activeFile);
      })
    );
  }

  private registerDeleteEvent(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        console.log(`Delete file ${file.path}`);

        if (file instanceof TFile && file.extension === "md") {
          this.plugin.apiClient.deleteNote(file.path).catch((error) => {
            console.error(`Failed to sync deletion of ${file.path}:`, error);
          });

          const docName = `${this.plugin.vaultName}/${file.path}`;
          this.sessionManager.deleteOfflineData(docName);
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
