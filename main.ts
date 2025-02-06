import {
	moment,
	Notice,
	Plugin,
	type TAbstractFile,
	type TFile,
} from "obsidian";
import * as SparkMD5 from "spark-md5";
import { checkHealth, rebuild, sync } from "./api";
import Ob2JadeSettingTab from "./setting-tab";

interface Obsidian2JadeSettings {
	endpoint: string;
	modifiedFiles: Record<string, string>;
}

const DEFAULT_SETTINGS: Obsidian2JadeSettings = {
	endpoint: "",
	modifiedFiles: {},
};

export enum Behaviors {
	CREATED = "created",
	MODIFIED = "modified",
	DELETED = "deleted",
	RENAMED = "renamed",
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
					if (
						this.settings.modifiedFiles[file.path] ===
						Behaviors.CREATED
					) {
						this.settings.modifiedFiles = {
							...this.settings.modifiedFiles,
							[file.path]: Behaviors.CREATED,
						};
					} else if (
						this.settings.modifiedFiles[file.path] ===
						Behaviors.RENAMED
					) {
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
					if (
						this.settings.modifiedFiles[oldPath] ===
						Behaviors.CREATED
					) {
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
				if (
					this.settings.modifiedFiles[file.path] !== Behaviors.CREATED
				) {
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

		this.addRibbonIcon(
			"rocket",
			"Publish your changes to Jade",
			async (evt: MouseEvent) => {
				if (!this.settings.endpoint) {
					new Notice("Please setup your Jade endpoint");
				}

				const checkHealthResp = await checkHealth(baseUrl);
				if (!checkHealthResp.data) {
					new Notice("Jade service is not available");
					return;
				}

				const responses: Promise<{
					path: string;
					md5: string;
					extension: string;
					lastModified: string;
				}>[] = [];
				for (const key of Object.keys(this.settings.modifiedFiles)) {
					const behavior = this.settings.modifiedFiles[key];

					const formData = new FormData();
					formData.append("path", key);

					let resp: Promise<{
						path: string;
						md5: string;
						extension: string;
						lastModified: string;
					}> | null = null;

					if (behavior === Behaviors.CREATED) {
						formData.append("behavior", Behaviors.CREATED);

						const createdFile = this.app.vault.getFileByPath(key);
						if (!createdFile) {
							continue;
						}

						resp = this.app.vault
							.readBinary(createdFile)
							.then(async (data) => {
								const md5 = SparkMD5.ArrayBuffer.hash(data);
								formData.append("md5", md5);
								formData.append(
									"extension",
									createdFile.extension
								);
								const lastModified = moment(
									createdFile.stat.mtime
								).format("YYYY-MM-DD HH:mm:ss");
								formData.append("lastModified", lastModified);
								formData.append("file", new Blob([data]));
								return sync(baseUrl, formData)
									.then(() => {
										new Notice(`${key} is synced`);
									})
									.then(() => ({
										path: createdFile.path,
										md5,
										lastModified,
										extension: createdFile.extension,
									}));
							});
					} else if (behavior === Behaviors.DELETED) {
						formData.append("behavior", Behaviors.DELETED);

						await sync(baseUrl, formData);
						new Notice(`${key} is synced`);
					} else if (behavior.includes(Behaviors.RENAMED)) {
						const oldPath = behavior.split(":")[1];

						formData.append("behavior", Behaviors.RENAMED);
						formData.append("oldPath", oldPath);

						const renamedFile = this.app.vault.getFileByPath(key);
						if (!renamedFile) {
							continue;
						}

						resp = this.app.vault
							.readBinary(renamedFile)
							.then(async (data) => {
								const md5 = SparkMD5.ArrayBuffer.hash(data);
								formData.append("md5", md5);
								formData.append(
									"extension",
									renamedFile.extension
								);
								const lastModified = moment(
									renamedFile.stat.mtime
								).format("YYYY-MM-DD HH:mm:ss");
								formData.append("lastModified", lastModified);
								formData.append("file", new Blob([data]));
								return sync(baseUrl, formData)
									.then(() => {
										new Notice(`${key} is synced`);
									})
									.then(() => ({
										path: renamedFile.path,
										md5,
										extension: renamedFile.extension,
										lastModified,
									}));
							});
					} else if (behavior === Behaviors.MODIFIED) {
						formData.append("behavior", Behaviors.MODIFIED);
						const modifiedFile = this.app.vault.getFileByPath(key);
						if (!modifiedFile) {
							continue;
						}

						resp = this.app.vault
							.readBinary(modifiedFile)
							.then(async (data) => {
								const md5 = SparkMD5.ArrayBuffer.hash(data);
								formData.append("md5", md5);
								formData.append(
									"extension",
									modifiedFile.extension
								);
								const lastModified = moment(
									modifiedFile.stat.mtime
								).format("YYYY-MM-DD HH:mm:ss");
								formData.append("lastModified", lastModified);
								formData.append("file", new Blob([data]));
								return sync(baseUrl, formData)
									.then(() => {
										new Notice(`${key} is synced`);
									})
									.then(() => ({
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
					rebuild(baseUrl, {
						files: details,
						clearOthers: false,
					}).then(() => {
						new Notice("Your vault is synced");
					});
				});
				this.settings.modifiedFiles = {};
				await this.saveSettings();
			}
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new Ob2JadeSettingTab(this.app, this));
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
