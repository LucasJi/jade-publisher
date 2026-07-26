import { type App, ButtonComponent, Notice, PluginSettingTab, Setting, type TFile } from "obsidian";
import type JadePublisherPlugin from "./main";
import { VaultPullService, VaultSyncService } from "./vault-operations";

export default class Ob2JadeSettingTab extends PluginSettingTab {
  plugin: JadePublisherPlugin;
  private authContainer!: HTMLDivElement;
  private emailInput!: HTMLInputElement;
  private passwordInput!: HTMLInputElement;
  private overwriteCheckbox!: HTMLElement;
  private syncService: VaultSyncService;
  private pullService: VaultPullService;

  constructor(app: App, plugin: JadePublisherPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.syncService = new VaultSyncService(plugin.apiClient, app.vault);
    this.pullService = new VaultPullService(plugin.apiClient, app.vault);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Jade endpoint")
      .setDesc("The endpoint of your Jade service. For example: http://localhost:3000")
      .addText((text) =>
        text.setValue(this.plugin.settings.endpoint).onChange(async (value) => {
          await this.plugin.updateEndpoint(value);
        })
      );

    this.authContainer = containerEl.createDiv("jade-auth-section");
    this.refreshAuthUI();

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
          const notice = new Notice("Syncing vault...", 0);

          const activeFile = this.app.workspace.getActiveFile();
          const readFile = async (file: TFile): Promise<ArrayBuffer> => {
            if (file === activeFile && file.extension === "md") {
              const text = await this.app.vault.cachedRead(file);
              return new TextEncoder().encode(text).buffer;
            }
            return this.app.vault.readBinary(file);
          };

          try {
            const result = await this.syncService.syncAll((done, total) => {
              notice.setMessage(`Syncing vault... (${done}/${total} files)`);
            }, readFile);

            notice.hide();
            new Notice(
              `Synced ${result.notesUploaded} notes, ${result.attachmentsUploaded} attachments` +
                (result.deletedCount ? `, removed ${result.deletedCount} old notes` : "")
            );
            this.plugin.resetOfflineCache();
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

    this.plugin.contentWriter.beginSuppress();
    try {
      const result = await this.pullService.pullAll(overwrite, (done, total) => {
        notice.setMessage(`Pulling vault... (${done}/${total} files)`);
      });

      notice.hide();
      new Notice(`Pulled ${result.notesPulled} notes, ${result.attachmentsPulled} attachments`);
    } catch (error) {
      notice.hide();
      console.error("Pull vault failed:", error);
      new Notice(`Pull failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      this.plugin.contentWriter.endSuppress();
    }

    await this.plugin.resetOfflineCache();
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
      const authSetting = new Setting(this.authContainer).setName("Authentication");

      authSetting.controlEl.empty();
      authSetting.controlEl.addClass("jade-auth-form");

      this.emailInput = authSetting.controlEl.createEl("input", {
        type: "email",
        placeholder: "Email",
        cls: "jade-auth-input",
      });

      this.passwordInput = authSetting.controlEl.createEl("input", {
        type: "password",
        placeholder: "Password",
        cls: "jade-auth-input",
      });

      const btn = new ButtonComponent(authSetting.controlEl);
      btn
        .setButtonText("Sign In")
        .setCta()
        .onClick(() => {
          const emailVal = this.emailInput.value.trim();
          const passwordVal = this.passwordInput.value;

          if (!emailVal || !passwordVal) {
            new Notice("Please enter email and password");
            return;
          }

          btn.setDisabled(true);
          btn.setButtonText("Signing in...");

          setTimeout(async () => {
            try {
              await this.plugin.authClient.signIn(emailVal, passwordVal);
              new Notice("Signed in successfully");
              this.plugin.refreshSession();
              this.refreshAuthUI();
            } catch (err) {
              btn.setDisabled(false);
              btn.setButtonText("Sign In");
              const msg = err instanceof Error ? err.message : "Unknown error";
              new Notice(`Sign in failed: ${msg}`);
            }
          }, 100);
        });
    }
  }
}
