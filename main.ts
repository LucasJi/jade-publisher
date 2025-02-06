import {
	type App,
	moment,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	type TAbstractFile,
	type TFile
} from "obsidian";
import * as SparkMD5 from "spark-md5";
import {checkFileExists, checkHealth, rebuild, sync} from "./api";

interface Obsidian2JadeSettings {
	endpoint: string;
	modifiedFiles: Record<string, string>;
}

const DEFAULT_SETTINGS: Obsidian2JadeSettings = {
	endpoint: "",
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

		const baseUrl = `${this.settings.endpoint}/api/sync`;

		this.addRibbonIcon("rocket", "Publish to Jade", async (evt: MouseEvent) => {
			if (!this.settings.endpoint) {
				new Notice('Please setup your Jade endpoint');
			}

			const checkHealthResp = await checkHealth(baseUrl)
			if (!checkHealthResp.data) {
				new Notice('Jade service is not available');
				return;
			}

			const responses: Promise<{
				path: string;
				md5: string;
				extension: string;
				lastModified: string
			}>[] = [];
			for (const key of Object.keys(this.settings.modifiedFiles)) {
				const behavior = this.settings.modifiedFiles[key];

				const formData = new FormData();
				formData.append('path', key);

				let resp: Promise<{
					path: string;
					md5: string;
					extension: string;
					lastModified: string
				}> | null = null;

				if (behavior === Behaviors.CREATED) {
					formData.append('behavior', Behaviors.CREATED);

					const createdFile = this.app.vault.getFileByPath(key);
					if (!createdFile) {
						continue;
					}

					resp = this.app.vault.readBinary(createdFile).then(async (data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						return checkFileExists(baseUrl, md5).then(async ({data: {exists}}) => {
							formData.append('md5', md5);
							formData.append('extension', createdFile.extension)
							formData.append('exists', `${exists}`);
							const lastModified = moment(createdFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss');
							formData.append('lastModified', lastModified);
							if (!exists) {
								formData.append('file', new Blob([data]));
							}
							return sync(baseUrl, formData).then(() => ({
								path: createdFile.path,
								md5,
								lastModified,
								extension: createdFile.extension,
							}));
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

					resp = this.app.vault.readBinary(renamedFile).then(async (data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						return checkFileExists(baseUrl, md5).then(async ({data: {exists}}) => {
							formData.append('md5', md5);
							formData.append('extension', renamedFile.extension)
							formData.append('exists', `${exists}`);
							const lastModified = moment(renamedFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss');
							formData.append('lastModified', lastModified);
							if (!exists) {
								formData.append('file', new Blob([data]));
							}
							return sync(baseUrl, formData).then(() => ({
								path: renamedFile.path,
								md5,
								extension: renamedFile.extension,
								lastModified,
							}));
						});
					});
				} else if (behavior === Behaviors.MODIFIED) {
					formData.append('behavior', Behaviors.MODIFIED);
					const modifiedFile = this.app.vault.getFileByPath(key);
					if (!modifiedFile) {
						continue;
					}

					resp = this.app.vault.readBinary(modifiedFile).then(async (data) => {
						const md5 = SparkMD5.ArrayBuffer.hash(data);
						formData.append('md5', md5);
						formData.append('extension', modifiedFile.extension)
						const lastModified = moment(modifiedFile.stat.mtime).format('YYYY-MM-DD HH:mm:ss');
						formData.append('lastModified', lastModified);
						formData.append('file', new Blob([data]));
						return sync(baseUrl, formData).then(() => ({
							path: modifiedFile.path,
							md5,
							lastModified,
							extension: modifiedFile.extension,
						}));
					});
				} else {
					// do nothing
				}

				if (resp !== null) {
					responses.push(resp);
				}
			}

			Promise.all(responses).then((details) => {
				rebuild(baseUrl, {files: details, clearOthers: false});
			});
			this.settings.modifiedFiles = {};
			await this.saveSettings();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new Ob2JadeSettingTab(this.app, this));

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

class Ob2JadeSettingTab extends PluginSettingTab {
	plugin: Obsidian2JadePlugin;

	constructor(app: App, plugin: Obsidian2JadePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
		.setName("Jade Endpoint")
		.setDesc("Jade Endpoint")
		.addText((text) =>
			text
			.setPlaceholder("Enter your Jade endpoint")
			.setValue(this.plugin.settings.endpoint)
			.onChange(async (value) => {
				this.plugin.settings.endpoint = value;
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
		.setName("Sync Vault")
		.setDesc("Click to sync the entire vault")
		.addButton(button => {
			button.setIcon('folder-sync').onClick(async () => {
				if (!this.plugin.settings.endpoint) {
					new Notice('Please setup your Jade endpoint');
					return;
				}
				const baseUrl = `${this.plugin.settings.endpoint}/api/sync`;

				const checkHealthResp = await checkHealth(baseUrl)
				if (!checkHealthResp.data) {
					new Notice('Jade service is not available');
					return;
				}

				const files = this.app.vault.getFiles();
				const responses: Promise<{
					path: string;
					md5: string;
					extension: string;
					lastModified: string
				}>[] = [];

				for (const file of files) {
					const formData = new FormData();
					formData.append('path', file.path);
					formData.append('behavior', Behaviors.CREATED);
					const resp = this.app.vault.readBinary(file).then(async buff => {
						const md5 = SparkMD5.ArrayBuffer.hash(buff);
						return checkFileExists(baseUrl, md5).then(async ({data: {exists}}) => {
							formData.append('md5', md5);
							formData.append('extension', file.extension);
							formData.append('exists', `${exists}`);
							const lastModified = moment(file.stat.mtime).format('YYYY-MM-DD HH:mm:ss');
							formData.append('lastModified', lastModified);
							if (!exists) {
								formData.append('file', new Blob([buff]));
							}
							return sync(baseUrl, formData).then(() => ({
								path: file.path,
								md5,
								lastModified,
								extension: file.extension,
							}));
						})
					});
					responses.push(resp);
				}

				Promise.all(responses).then((details) => {
					rebuild(baseUrl, {files: details, clearOthers: true});
				});
			});
		});
	}
}
