import { type App, moment, Notice, PluginSettingTab, Setting } from "obsidian";
import { checkHealth, rebuild, sync } from "./api";
import * as SparkMD5 from "spark-md5";
import type Obsidian2JadePlugin from "./main";
import { Behaviors } from "./main";

export default class Ob2JadeSettingTab extends PluginSettingTab {
	plugin: Obsidian2JadePlugin;

	constructor(app: App, plugin: Obsidian2JadePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Jade Endpoint")
			.setDesc(
				"The endpoint of your Jade service. For example: http://localhost:3000"
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.endpoint)
					.onChange(async (value) => {
						this.plugin.settings.endpoint = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sync Vault")
			.setDesc(
				"Click to sync the entire vault to your Jade service. This may take some time"
			)
			.addButton((button) => {
				button.setIcon("folder-sync").onClick(async () => {
					if (!this.plugin.settings.endpoint) {
						new Notice("Please setup your Jade endpoint");
						return;
					}
					const baseUrl = `${this.plugin.settings.endpoint}/api/sync`;

					const checkHealthResp = await checkHealth(baseUrl);
					if (!checkHealthResp.data) {
						new Notice("Jade service is not available");
						return;
					}

					const files = this.app.vault.getFiles();
					const responses: Promise<{
						path: string;
						md5: string;
						extension: string;
						lastModified: string;
					}>[] = [];

					for (const file of files) {
						const formData = new FormData();
						formData.append("path", file.path);
						formData.append("behavior", Behaviors.CREATED);
						const resp = this.app.vault
							.readBinary(file)
							.then(async (buff) => {
								const md5 = SparkMD5.ArrayBuffer.hash(buff);
								formData.append("md5", md5);
								formData.append("extension", file.extension);
								const lastModified = moment(
									file.stat.mtime
								).format("YYYY-MM-DD HH:mm:ss");
								formData.append("lastModified", lastModified);
								formData.append("file", new Blob([buff]));
								return sync(baseUrl, formData)
									.then(() => {
										new Notice(`${file.path} is synced`);
									})
									.then(() => ({
										path: file.path,
										md5,
										lastModified,
										extension: file.extension,
									}));
							});
						responses.push(resp);
					}

					Promise.all(responses).then((details) => {
						rebuild(baseUrl, { files: details, clearOthers: true });
					});
				});
			});
	}
}
