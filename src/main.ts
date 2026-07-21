import { Notice, Plugin, type TAbstractFile, TFile } from "obsidian";
import { publish, setTokenProvider } from "./api";
import { getAccessToken, getAuthState, isAuthenticated, loadAuthState, setEndpoint, setOnAuthChange } from "./auth";
import { DEFAULT_SETTINGS } from "./constants";
import { SessionManager } from "./session-manager";
import Ob2JadeSettingTab from "./setting-tab";
import { SyncHandler } from "./sync-handler";
import type { ContentWriter, JadePublisherSettings } from "./types";

class VaultContentWriter implements ContentWriter {
  private _isWriting = false;

  get isWriting(): boolean {
    return this._isWriting;
  }

  constructor(
    private vault: { modify: (file: TFile, data: string) => Promise<void> },
    private resolveFile: (filePath: string) => TFile | null
  ) {}

  writeContent(filePath: string, content: string): void {
    const file = this.resolveFile(filePath);
    if (!file) return;

    this._isWriting = true;
    try {
      this.vault.modify(file, content);
    } finally {
      this._isWriting = false;
    }
  }
}

export default class JadePublisherPlugin extends Plugin {
  settings!: JadePublisherSettings;
  vaultName = "";
  private sessionManager!: SessionManager;
  private statusBarItem!: HTMLElement;
  private needsFlush = false;
  private flushing = false;
  private deferredFlush = false;

  private isMarkdownFile(file: TAbstractFile | null): boolean {
    return file instanceof TFile && file.extension === "md";
  }

  private async triggerFlush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      const synced = await this.sessionManager.flushOfflineMutations((done, total) => {
        this.statusBarItem.setText(`Syncing ${done}/${total} offline docs...`);
      });

      if (synced > 0) {
        this.statusBarItem.setText(`Synced ${synced} offline docs`);
        setTimeout(() => {
          this.statusBarItem.setText("");
        }, 5000);
      } else {
        this.statusBarItem.setText("");
      }
    } catch (error) {
      console.error("Offline flush failed:", error);
      this.statusBarItem.setText("");
    } finally {
      this.flushing = false;
    }
  }

  async onload() {
    const rawData = (await this.loadData()) ?? {};
    loadAuthState(rawData as Record<string, unknown>);

    this.settings = Object.assign({}, DEFAULT_SETTINGS, (rawData as Record<string, unknown>).settings ?? rawData);
    this.vaultName = this.app.vault.getName();

    setEndpoint(this.settings.endpoint);
    setTokenProvider(async () => {
      if (this.settings.accessToken) return this.settings.accessToken;
      return getAccessToken();
    });

    setOnAuthChange(async () => {
      await this.saveData({ settings: this.settings, auth: getAuthState() });
    });

    const contentWriter = new VaultContentWriter(this.app.vault, (filePath: string) =>
      this.app.vault.getAbstractFileByPath(filePath) instanceof TFile
        ? (this.app.vault.getAbstractFileByPath(filePath) as TFile)
        : null
    );

    this.sessionManager = new SessionManager(
      this.vaultName,
      this.settings.endpoint,
      () => (this.settings.accessToken ? this.settings.accessToken : getAccessToken()),
      contentWriter
    );

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("");

    this.sessionManager.onProviderConnected = () => {
      if (this.needsFlush) {
        this.needsFlush = false;
        this.triggerFlush();
      }
    };

    this.sessionManager.onProviderDisconnected = () => {
      console.log("Provider disconnected, will flush on reconnect");
      this.needsFlush = true;
    };

    setTimeout(async () => {
      const token = this.settings.accessToken || (await getAccessToken());
      if (!token) {
        this.deferredFlush = true;
        return;
      }
      this.needsFlush = true;
      this.triggerFlush();
    }, 3000);

    const syncHandler = new SyncHandler(this, this.sessionManager, contentWriter);
    syncHandler.registerEvents();

    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        console.log("Opened file:", file?.name);

        if (!file) {
          return;
        }

        if (this.isMarkdownFile(file)) {
          await this.sessionManager.switchTo(file);
        } else {
          this.sessionManager.destroy();
        }
      })
    );

    this.addRibbonIcon("cloud-upload", "Sync to Jade", async () => {
      if (!(await isAuthenticated(this.settings.accessToken))) {
        new Notice("Please log in first");
        return;
      }
      const baseUrl = `${this.settings.endpoint}/api`;
      try {
        const resp = await publish(baseUrl, this.vaultName);
        console.log("Publish Resp", resp);
        const paths = resp?.data?.publishedPaths as string[] | undefined;
        if (paths && paths.length > 0) {
          new Notice(`Published ${paths.length} notes`);
        } else {
          new Notice("No new notes to publish");
        }
      } catch (error) {
        console.error("Publish failed:", error);
        new Notice(`Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    });

    this.addSettingTab(new Ob2JadeSettingTab(this.app, this));
  }

  onunload() {
    console.log("onunload");
    this.sessionManager.destroy();
  }

  async refreshSession() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && this.isMarkdownFile(activeFile)) {
      await this.sessionManager.switchTo(activeFile, true);
    }

    if (this.deferredFlush) {
      this.deferredFlush = false;
      this.triggerFlush();
    }
  }

  async saveSettings() {
    await this.saveData({ settings: this.settings, auth: getAuthState() });
  }
}
