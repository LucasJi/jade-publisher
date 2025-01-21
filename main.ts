import {
	type App,
	Plugin,
	PluginSettingTab,
	Setting,
	type TAbstractFile,
	type TFile
} from "obsidian";
import * as SparkMD5 from "spark-md5";
import {check, sync} from "./api";

interface Obsidian2JadeSettings {
	mySetting: string;
	modifiedFiles: Record<string, string>;
}

const DEFAULT_SETTINGS: Obsidian2JadeSettings = {
	mySetting: "default",
	modifiedFiles: {},
};

// --- created ---
// When file is created, no matter modifying or renaming it, the final behavior is still `created`.
// When file is created, if it is deleted before publishing, it's record should not in modified files.

// --- modified ---
// When file is modified, it's final behavior will be `modified` only if it is not deleted.
// When file is deleted after modified, it's final behavior should be `deleted`.

// --- deleted ---
// When file is deleted, it's final behavior is `deleted`.

// --- renamed ---
// When file is renamed, it's final behavior will be `renamed` only if it is not deleted.
// When file is deleted after renamed, the behavior of the file before renamed should be deleted.
// the record of the renamed file in the modified files should be removed.
enum Behaviors {
	CREATED = 'created',
	MODIFIED = 'modified',
	DELETED = 'deleted',
	RENAMED = 'renamed'
}

export default class Obsidian2JadePlugin extends Plugin {
	settings: Obsidian2JadeSettings;

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (file: TAbstractFile) => {
					this.settings.modifiedFiles = {
						...this.settings.modifiedFiles,
						[file.path]: Behaviors.CREATED,
					};
					this.saveSettings();
				})
			);
		});

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const activeFile: TFile | null =
					this.app.workspace.getActiveFile();
				if (file === activeFile) {
					if (this.settings.modifiedFiles[file.path] !== Behaviors.CREATED) {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.MODIFIED,
						};
						this.saveSettings();
						console.log('file modified');
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on(
				"rename",
				(file: TAbstractFile, oldPath: string) => {
					if (this.settings.modifiedFiles[oldPath] === Behaviors.CREATED) {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.CREATED,
						};
					} else {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: `${Behaviors.RENAMED}:${oldPath}`,
						};
					}
					delete this.settings.modifiedFiles[oldPath];
					this.saveSettings();
				}
			)
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (this.settings.modifiedFiles[file.path] !== Behaviors.CREATED) {
					this.settings.modifiedFiles = {
						...this.settings.modifiedFiles,
						[file.path]: Behaviors.DELETED,
					};
				} else {
					delete this.settings.modifiedFiles[file.path];
				}
				this.saveSettings();
			})
		);

		const baseUrl = 'http://localhost:3000/api/sync';

		this.addRibbonIcon("dice", "Publish", async (evt: MouseEvent) => {
			for (const key of Object.keys(this.settings.modifiedFiles)) {
				const behavior = this.settings.modifiedFiles[key];

				const formData = new FormData();
				formData.append('path', key);

				if (behavior === Behaviors.CREATED) {
					formData.append('behavior', Behaviors.CREATED);

					const file = this.app.vault.getFileByPath(key);
					if (!file) {
						continue;
					}

					this.app.vault.readBinary(file).then(async (data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						const {data: {exists}} = await check(baseUrl, md5)
						formData.append('md5', md5);
						formData.append('extension', file.extension)
						formData.append('exists', `${exists}`);
						if (!exists) {
							formData.append('file', new Blob([data]));
						}
						const resp = await sync(baseUrl, formData)
						console.log(resp);
					});
				} else if (behavior === Behaviors.DELETED) {
					formData.append('behavior', Behaviors.DELETED);

					const resp = await sync(baseUrl, formData)
					console.log(resp);
				} else if (behavior.includes(Behaviors.RENAMED)) {
					formData.append('behavior', Behaviors.RENAMED);

					const oldPath = behavior.split(":")[1]
					formData.append('oldPath', oldPath);
					const resp = await sync(baseUrl, formData)
					// TODO: Solve the situation when file content changes
					console.log(resp);
				} else {
					// do nothing
				}

			}
			this.settings.modifiedFiles = {};
			await this.saveSettings();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

	}

	onunload() {
	}

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
		const {containerEl} = this;

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
