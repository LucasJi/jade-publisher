import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import { completeSyncTask, startSyncTask, uploadSyncFile } from "./api";
import { getUserEmail, signIn, signOut } from "./auth";
import type JadePublisherPlugin from "./main";

export default class Ob2JadeSettingTab extends PluginSettingTab {
  plugin: JadePublisherPlugin;
  private authContainer!: HTMLDivElement;
  private emailInput!: HTMLInputElement;
  private passwordInput!: HTMLInputElement;

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
        }),
      );

    this.authContainer = containerEl.createDiv("jade-auth-section");
    this.refreshAuthUI();

    new Setting(containerEl)
      .setName("Access token (fallback)")
      .setDesc(
        "Static token override. Takes precedence over email/password login if set.",
      )
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
          const baseUrl = `${this.plugin.settings.endpoint}/api`;
          const vault = this.app.vault.getName();
          const files = this.app.vault.getFiles();
          const notice = new Notice("Syncing vault...", 0);
          let notesUploaded = 0;
          let attachmentsUploaded = 0;

          try {
            const startResult = await startSyncTask(baseUrl, vault);
            const taskId = startResult.data?.taskId as string;
            if (!taskId) {
              throw new Error("Failed to create sync task");
            }

            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const content = await this.app.vault.readBinary(file);
              const mimeType =
                file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);

              await uploadSyncFile(baseUrl, vault, taskId, file.path, content, mimeType);

              if (file.extension === "md") {
                notesUploaded++;
              } else {
                attachmentsUploaded++;
              }

              if ((i + 1) % 5 === 0 || i === files.length - 1) {
                notice.setMessage(`Syncing vault... (${i + 1}/${files.length} files)`);
              }
            }

            const completeResult = await completeSyncTask(baseUrl, vault, taskId);
            const deletedCount = completeResult.data?.deletedCount as number;
            notice.hide();

            new Notice(
              `✅ Synced ${notesUploaded} notes, ${attachmentsUploaded} attachments` +
                (deletedCount ? `, removed ${deletedCount} old notes` : ""),
            );
          } catch (error) {
            notice.hide();
            console.error("Vault sync failed:", error);
            new Notice(
              `❌ Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        });
      });
  }

  private refreshAuthUI(): void {
    this.authContainer.empty();
    this.authContainer.createEl("h3", { text: "Authentication" });

    const email = getUserEmail();

    if (email) {
      this.authContainer.createEl("p", { text: `Signed in as ${email}` });

      new Setting(this.authContainer)
        .addButton((button) =>
          button.setButtonText("Sign Out").onClick(async () => {
            await signOut();
            new Notice("Signed out");
            this.refreshAuthUI();
          }),
        );
    } else {
      new Setting(this.authContainer)
        .setName("Email")
        .addText((text) => {
          this.emailInput = text.inputEl;
          text.inputEl.type = "email";
        });

      new Setting(this.authContainer)
        .setName("Password")
        .addText((text) => {
          this.passwordInput = text.inputEl;
          text.inputEl.type = "password";
        });

      new Setting(this.authContainer)
        .addButton((button) =>
          button.setButtonText("Sign In").onClick(async () => {
            const emailVal = this.emailInput?.value.trim();
            const passwordVal = this.passwordInput?.value;

            if (!emailVal || !passwordVal) {
              new Notice("Please enter email and password");
              return;
            }

            const notice = new Notice("Signing in...", 0);
            try {
              await signIn(emailVal, passwordVal);
              notice.hide();
              new Notice("Signed in successfully");
              this.refreshAuthUI();
            } catch (err) {
              notice.hide();
              new Notice(
                `Sign in failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              );
            }
          }),
        );
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
