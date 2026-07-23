import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
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

    new Setting(containerEl)
      .setName("Access token (fallback)")
      .setDesc("Static token override. Takes precedence over email/password login if set.")
      .addText((text) => {
        text.setValue(this.plugin.settings.accessToken).onChange(async (value) => {
          this.plugin.settings.accessToken = value;
          this.plugin.authClient.setStaticToken(value || null);
          await this.plugin.saveSettings();
        });
        text.inputEl.type = "password";
        return text;
      });

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

          try {
            const result = await this.syncService.syncAll((done, total) => {
              notice.setMessage(`Syncing vault... (${done}/${total} files)`);
            });

            notice.hide();
            new Notice(
              `Synced ${result.notesUploaded} notes, ${result.attachmentsUploaded} attachments` +
                (result.deletedCount ? `, removed ${result.deletedCount} old notes` : "")
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
}
