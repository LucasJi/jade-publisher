import {
	type App,
	moment,
	Plugin,
	PluginSettingTab,
	Setting,
	type TAbstractFile,
	type TFile
} from "obsidian";
import * as SparkMD5 from "spark-md5";
import {check, rebuild, sync} from "./api";

interface Obsidian2JadeSettings {
	mySetting: string;
	modifiedFiles: Record<string, string>;
}

const DEFAULT_SETTINGS: Obsidian2JadeSettings = {
	mySetting: "default",
	modifiedFiles: {},
};

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

		// If a file can be modified, it's previous behavior must be `created`, `renamed` or empty.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const activeFile: TFile | null =
					this.app.workspace.getActiveFile();
				if (file === activeFile) {
					if (this.settings.modifiedFiles[file.path] === Behaviors.CREATED) {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.CREATED,
						};
					} else if (this.settings.modifiedFiles[file.path] === Behaviors.RENAMED) {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.RENAMED,
						};
					} else {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.MODIFIED,
						};
					}

					this.saveSettings();
				}
			})
		);

		// If a file can be renamed, it's previous behavior must be `created`, `renamed`, `modified` or empty.
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

		// If a file can be deleted, it's previous behavior must be `created`, `renamed`, `modified` or empty.
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
		this.addRibbonIcon("folder-sync", "Sync Vault", async () => {
			const files = this.app.vault.getFiles();
			const responses: Promise<{ path: string; md5: string }>[] = [];

			for (const file of files) {
				const formData = new FormData();
				formData.append('path', file.path);
				formData.append('behavior', Behaviors.CREATED);
				const resp = this.app.vault.readBinary(file).then(async buff => {
					const md5 = SparkMD5.ArrayBuffer.hash(buff);
					return check(baseUrl, md5).then(async ({data: {exists}}) => {
						formData.append('md5', md5);
						formData.append('extension', file.extension);
						formData.append('exists', `${exists}`);
						formData.append('lastModified', moment(file.stat.mtime).format('YYYY-MM-DD HH:mm:ss'));
						if (!exists) {
							formData.append('file', new Blob([buff]));
						}
						return sync(baseUrl, formData).then(() => ({
							path: file.path,
							md5,
						}));
					})
				});
				responses.push(resp);
			}

			Promise.all(responses).then((details) => {
				rebuild(baseUrl, {files: details, clearOthers: true});
			});

		});

		this.addRibbonIcon("rocket", "Publish to Jade", async (evt: MouseEvent) => {
			for (const key of Object.keys(this.settings.modifiedFiles)) {
				const behavior = this.settings.modifiedFiles[key];

				const formData = new FormData();
				formData.append('path', key);

				if (behavior === Behaviors.CREATED) {
					formData.append('behavior', Behaviors.CREATED);

					const createdFile = this.app.vault.getFileByPath(key);
					if (!createdFile) {
						continue;
					}

					this.app.vault.readBinary(createdFile).then((data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						check(baseUrl, md5).then(({data: {exists}}) => {
							formData.append('md5', md5);
							formData.append('extension', createdFile.extension)
							formData.append('exists', `${exists}`);
							formData.append('lastModified', moment(createdFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss'))
							if (!exists) {
								formData.append('file', new Blob([data]));
							}
							sync(baseUrl, formData)
						});
					});
				} else if (behavior === Behaviors.DELETED) {
					formData.append('behavior', Behaviors.DELETED);

					await sync(baseUrl, formData)
				} else if (behavior.includes(Behaviors.RENAMED)) {
					const oldPath = behavior.split(":")[1]

					formData.append('behavior', Behaviors.RENAMED);
					formData.append('oldPath', oldPath);

					const renamedFile = this.app.vault.getFileByPath(key);
					if (!renamedFile) {
						continue;
					}

					this.app.vault.readBinary(renamedFile).then((data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						check(baseUrl, md5).then(({data: {exists}}) => {
							formData.append('md5', md5);
							formData.append('extension', renamedFile.extension)
							formData.append('exists', `${exists}`);
							formData.append('lastModified', moment(renamedFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss'))
							if (!exists) {
								formData.append('file', new Blob([data]));
							}
							sync(baseUrl, formData)
						});
					});
				} else if (behavior === Behaviors.DELETED) {
					const modifiedFile = this.app.vault.getFileByPath(key);
					if (!modifiedFile) {
						continue;
					}

					this.app.vault.readBinary(modifiedFile).then((data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						formData.append('md5', md5);
						formData.append('extension', modifiedFile.extension)
						formData.append('lastModified', moment(modifiedFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss'))
						formData.append('file', new Blob([data]));
						sync(baseUrl, formData)
					});
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
