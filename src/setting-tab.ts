import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import type JadePublisherPlugin from "./main";
import { completeSyncTask, startSyncTask, uploadSyncFile } from "./api";

export default class Ob2JadeSettingTab extends PluginSettingTab {
  plugin: JadePublisherPlugin;

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

    new Setting(containerEl)
      .setName("Access token")
      .setDesc(
        "The access token is used to protect your Jade APIs. You can generate it from your Jade admin dashboard."
      )
      .addText((text) => {
        text.setValue(this.plugin.settings.accessToken).onChange(async (value) => {
          this.plugin.settings.accessToken = value;
          await this.plugin.saveSettings();
        });
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
            // Step 1: Create sync task
            const startResult = await startSyncTask(baseUrl, vault);
            const taskId = startResult.data?.taskId as string;
            if (!taskId) {
              throw new Error("Failed to create sync task");
            }

            // Step 2: Upload files one by one
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const content = await this.app.vault.readBinary(file);
              const mimeType = file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);

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

            // Step 3: Complete sync task
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
            new Notice(`❌ Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        });
      });
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
