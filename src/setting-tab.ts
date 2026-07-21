import { type App, Notice, PluginSettingTab, Setting, type TFile } from "obsidian";
import type JadePublisherPlugin from "./main";

export default class Ob2JadeSettingTab extends PluginSettingTab {
  plugin: JadePublisherPlugin;
  private authContainer!: HTMLDivElement;
  private emailInput!: HTMLInputElement;
  private passwordInput!: HTMLInputElement;
  private overwriteCheckbox!: HTMLElement;

  constructor(app: App, plugin: JadePublisherPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Jade endpoint")
      .setDesc("The endpoint of your Jade service. For example: http://localhost:3000")
      .addText((text) =>
        text.setValue(this.plugin.settings.endpoint).onChange(async (value) => {
          this.plugin.settings.endpoint = value;
          await this.plugin.saveSettings();
        })
      );

    this.authContainer = containerEl.createDiv("jade-auth-section");
    this.refreshAuthUI();

    new Setting(containerEl)
      .setName("Access token (fallback)")
      .setDesc("Static token override. Takes precedence over email/password login if set.")
      .addText((text) => {
        text.setValue(this.plugin.settings.accessToken).onChange(async (value) => {
          this.plugin.settings.accessToken = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.type = "password";
        return text;
      });

    new Setting(containerEl)
      .setName("Sync vault")
      .setDesc("Click to sync the entire vault to your Jade service. This may take a while.")
      .addButton((button) => {
        button.setIcon("folder-sync").onClick(async () => {
          const token = await this.plugin.authClient.getToken();
          if (!token) {
            new Notice("Please log in first");
            return;
          }
          const files = this.app.vault.getFiles();
          const notice = new Notice("Syncing vault...", 0);
          let notesUploaded = 0;
          let attachmentsUploaded = 0;

          try {
            const startResult = await this.plugin.apiClient.startSyncTask();
            const taskId = startResult.data?.taskId as string;
            if (!taskId) {
              throw new Error("Failed to create sync task");
            }

            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const content = await this.app.vault.readBinary(file);
              const mimeType = file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);

              await this.plugin.apiClient.uploadSyncFile(taskId, file.path, content, mimeType);

              if (file.extension === "md") {
                notesUploaded++;
              } else {
                attachmentsUploaded++;
              }

              if ((i + 1) % 5 === 0 || i === files.length - 1) {
                notice.setMessage(`Syncing vault... (${i + 1}/${files.length} files)`);
              }
            }

            const completeResult = await this.plugin.apiClient.completeSyncTask(taskId);
            const deletedCount = completeResult.data?.deletedCount as number;
            notice.hide();

            new Notice(
              `Synced ${notesUploaded} notes, ${attachmentsUploaded} attachments` +
                (deletedCount ? `, removed ${deletedCount} old notes` : "")
            );
          } catch (error) {
            notice.hide();
            console.error("Vault sync failed:", error);
            new Notice(` Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        });
      });

    new Setting(containerEl)
      .setName("Pull from remote")
      .setDesc("Download vault from Jade service. This will create or overwrite files in your local vault.")
      .addButton((button) => {
        button.setIcon("folder-sync").onClick(async () => {
          const token = await this.plugin.authClient.getToken();
          if (!token) {
            new Notice("Please log in first");
            return;
          }
          await this.pullVault();
        });
      });

    new Setting(containerEl)
      .setName("Overwrite existing files")
      .setDesc("If enabled, existing local files will be overwritten by the remote version during pull.")
      .addToggle((toggle) => {
        this.overwriteCheckbox = toggle.setValue(false).toggleEl;
      });
  }

  private async pullVault(): Promise<void> {
    const overwrite = (this.overwriteCheckbox as HTMLInputElement)?.checked ?? false;

    const notice = new Notice("Pulling vault...", 0);
    let notesPulled = 0;
    let attachmentsPulled = 0;

    try {
      const notesResult = await this.plugin.apiClient.listNotesForVault();
      const notes: Array<{ vault: string; path: string }> = notesResult?.data?.notes ?? [];
      let total = notes.length;

      let storageResult: { data?: { objects?: Array<{ name: string; path: string }> } } = { data: { objects: [] } };
      try {
        storageResult = await this.plugin.apiClient.listStorageObjects();
      } catch (err) {
        console.warn("Failed to list storage objects:", err);
      }
      const objects = storageResult?.data?.objects ?? [];
      total += objects.length;

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const filePath = note.path;
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);

        if (!overwrite && existingFile) {
          continue;
        }

        const textResult = await this.plugin.apiClient.getNoteText(filePath);
        const text = (textResult?.data?.text as string) ?? "";

        await this.ensureParentFolder(filePath);

        if (existingFile) {
          await this.app.vault.modify(existingFile as TFile, text);
        } else {
          await this.app.vault.create(filePath, text);
        }
        notesPulled++;

        if ((i + 1) % 5 === 0 || i === notes.length - 1) {
          notice.setMessage(`Pulling vault... (${notesPulled + attachmentsPulled}/${total} files)`);
        }
      }

      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const filePath = obj.path;
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);

        if (!overwrite && existingFile) {
          continue;
        }

        const buffer = await this.plugin.apiClient.downloadStorageObject(filePath);

        await this.ensureParentFolder(filePath);

        if (existingFile) {
          await this.app.vault.modifyBinary(existingFile as TFile, buffer);
        } else {
          await this.app.vault.createBinary(filePath, buffer);
        }
        attachmentsPulled++;

        const done = notes.length + i + 1;
        if (done % 5 === 0 || done === total) {
          notice.setMessage(`Pulling vault... (${done}/${total} files)`);
        }
      }

      notice.hide();
      new Notice(`Pulled ${notesPulled} notes, ${attachmentsPulled} attachments`);
    } catch (error) {
      notice.hide();
      console.error("Pull vault failed:", error);
      new Notice(`Pull failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop();
    if (parts.length === 0) return;

    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const exists = this.app.vault.getAbstractFileByPath(currentPath);
      if (!exists) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private refreshAuthUI(): void {
    this.authContainer.empty();
    this.authContainer.createEl("h3", { text: "Authentication" });

    const email = this.plugin.authClient.getUserEmail();

    if (email) {
      new Setting(this.authContainer)
        .setName("Signed in as")
        .setDesc(email)
        .addButton((button) =>
          button.setButtonText("Sign Out").onClick(async () => {
            await this.plugin.authClient.signOut();
            this.plugin.refreshSession();
            new Notice("Signed out");
            this.refreshAuthUI();
          })
        );
    } else {
      const errorEl = this.authContainer.createDiv("jade-auth-error");

      new Setting(this.authContainer).setName("Email").addText((text) => {
        this.emailInput = text.inputEl;
        text.inputEl.type = "email";
        text.inputEl.addClass("jade-auth-input");
      });

      new Setting(this.authContainer).setName("Password").addText((text) => {
        this.passwordInput = text.inputEl;
        text.inputEl.type = "password";
        text.inputEl.addClass("jade-auth-input");
      });

      new Setting(this.authContainer).addButton((button) => {
        button
          .setButtonText("Sign In")
          .setCta()
          .onClick(async () => {
            errorEl.removeClass("is-visible");
            const emailVal = this.emailInput?.value.trim();
            const passwordVal = this.passwordInput?.value;

            if (!emailVal || !passwordVal) {
              errorEl.setText("Please enter email and password");
              errorEl.addClass("is-visible");
              return;
            }

            button.setDisabled(true);
            button.setButtonText("Signing in...");
            try {
              await this.plugin.authClient.signIn(emailVal, passwordVal);
              new Notice("Signed in successfully");
              this.plugin.refreshSession();
              this.refreshAuthUI();
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              errorEl.setText(`Sign in failed: ${msg}`);
              errorEl.addClass("is-visible");
            } finally {
              if (button.buttonEl.isConnected) {
                button.setDisabled(false);
                button.setButtonText("Sign In");
              }
            }
          });
      });
    }
  }

  private getMimeType(ext: string): string {
    const map: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      pdf: "application/pdf",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      webm: "video/webm",
    };
    return map[ext] ?? "application/octet-stream";
  }
}
