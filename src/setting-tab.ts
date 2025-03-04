import {type App, moment, Notice, PluginSettingTab, Setting} from "obsidian";
import {checkHealth, flush, rebuild, sync} from "./api";
import * as SparkMD5 from "spark-md5";
import type JadePublisherPlugin from "./main";
import {NoteStatus} from "./main";

export default class Ob2JadeSettingTab extends PluginSettingTab {
	plugin: JadePublisherPlugin;

	constructor(app: App, plugin: JadePublisherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
		.setName("Jade endpoint")
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
		.setName("Access token")
		.setDesc(
			"The access token is used to protect your Jade sync apis. You can get it from your Jade service environment variables"
		)
		.addText((text) => {
			text.setValue(this.plugin.settings.accessToken).onChange(
				async (value) => {
					this.plugin.settings.accessToken = value;
					await this.plugin.saveSettings();
				}
			);
			return text;
		});

		new Setting(containerEl)
		.setName("Sync vault")
		.setDesc(
			"Click to sync the entire vault to your Jade service. This may take some time"
		)
		.addButton((button) => {
			button.setIcon("folder-sync").onClick(async () => {
				if (!this.plugin.settings.endpoint) {
					new Notice("Please setup your Jade endpoint");
					return;
				}
				if (!this.plugin.settings.accessToken) {
					new Notice("Please setup your access token");
					return;
				}

				const baseUrl = `${this.plugin.settings.endpoint}/api/sync`;
				const accessToken = this.plugin.settings.accessToken;

				const healthStatus = await checkHealth(
					baseUrl,
					accessToken
				);

				if (healthStatus === 500) {
					new Notice("Jade service is not available");
					return;
				}

				if (healthStatus === 401) {
					new Notice("Your access token is wrong");
					return;
				}

				await flush(baseUrl, accessToken);

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
					formData.append("status", NoteStatus.CREATED);
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
						return sync(baseUrl, accessToken, formData)
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
					const beginNotice = new Notice(
						"Rebuilding your Jade service, please wait...",
						0
					);
					rebuild(baseUrl, accessToken, {
						files: details,
					}).then(() => {
						beginNotice.hide();
						new Notice(
							"Your Jade service rebuilds successfully!"
						);
					});
				});
			});
		});
	}
}
