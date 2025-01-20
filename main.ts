import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";
import * as SparkMD5 from "spark-md5";

interface Obsidian2JadeSettings {
	mySetting: string;
	modifiedFiles: Record<string, string>;
}

const DEFAULT_SETTINGS: Obsidian2JadeSettings = {
	mySetting: "default",
	modifiedFiles: {},
};

const CHUNK_SIZE = 1 * 1024 * 1024;

export default class Obsidian2JadePlugin extends Plugin {
	settings: Obsidian2JadeSettings;

	async onload() {
		await this.loadSettings();

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const activeFile: TFile | null =
					this.app.workspace.getActiveFile();
				if (file === activeFile) {
					if (this.settings.modifiedFiles[file.path] !== "created") {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: "modified",
						};
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on(
				"rename",
				(file: TAbstractFile, oldPath: string) => {
					if (this.settings.modifiedFiles[oldPath] === "created") {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: "created",
						};
						delete this.settings.modifiedFiles[oldPath];
					} else {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: `renamed:${oldPath}`,
							[oldPath]: "renamed",
						};
					}
				}
			)
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (this.settings.modifiedFiles[file.path] !== "created") {
					this.settings.modifiedFiles = {
						...this.settings.modifiedFiles,
						[file.path]: "deleted",
					};
				} else {
					delete this.settings.modifiedFiles[file.path];
				}
			})
		);

		// This creates an icon in the left ribbon.
		this.addRibbonIcon("dice", "Sample Plugin", (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.saveSettings();
		});

		this.addRibbonIcon("dice", "Publish", (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			Object.keys(this.settings.modifiedFiles).forEach((key) => {
				const file = this.app.vault.getFileByPath(key);
				console.log(file);
				this.app.vault.readBinary(file!).then((data) => {
					const md5 = SparkMD5.ArrayBuffer.hash(data);
					console.log(`${file?.basename} md5: ${md5}`);
				});
			});
			// this.settings.modifiedFiles = {};
			// this.saveSettings();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (file: TAbstractFile) => {
					this.settings.modifiedFiles = {
						...this.settings.modifiedFiles,
						[file.path]: "created",
					};
				})
			);
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: Obsidian2JadePlugin;

	constructor(app: App, plugin: Obsidian2JadePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
