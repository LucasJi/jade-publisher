import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import type JadePublisherPlugin from "./main";

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
          const accessToken = this.plugin.settings.accessToken;
          const notice = new Notice("Syncing vault...", 0);
          const formData = new FormData();
          const files = this.app.vault.getFiles();

          for (const file of files) {
            const content = await this.app.vault.readBinary(file);

            // 根据扩展名设置合适的 MIME type
            const mimeType = file.extension === "md" ? "text/markdown" : this.getMimeType(file.extension);

            const blob = new Blob([content], { type: mimeType });

            // 第三个参数是 multipart 里的 filename，服务端通过 file.originalname 读取
            formData.append("files", blob, encodeURIComponent(file.path));
          }

          const response = await fetch(`${baseUrl}/vaults/${this.app.vault.getName()}/sync`, {
            method: "POST",
            body: formData,
          });

          const result = await response.json();
          notice.hide();
          if (response.ok) {
            new Notice(
              `✅ Sync done — ${result.data.notes.upserted} notes, ${result.data.attachments.uploaded} attachments`
            );
          } else {
            new Notice("Sync failed");
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
