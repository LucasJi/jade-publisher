# Jade Publisher

This is a simple plugin to help publish your Obsidian vault to a public website(build
with [Jade](https://github.com/LucasJi/Jade)).

## Download and Install

- Option #1(**recommended**): Manually download assets (`main.js`, `manifest.json`, `styles.css`) from the latest [release](https://github.com/LucasJi/jade-publisher/releases).
- Option #2(**Not yet released**): Search "Jade Publisher" in the official "[community plugin list](https://obsidian.md/plugins)", then
install the plugin.

## Usage

### First-Time Usage

1. Download and install this plugin
2. Make sure your Jade service is running
3. In setting page![setting-page](setting-page.png)
	- Config the endpoint(`NEXT_PUBLIC_BASE_URL` in `.env`) of your Jade service
	- Config the access token(`ACCESS_TOKEN` in `.env`)
4. Click `Sync Vault` button(![Folder Sync Icon](folder-sync.svg)) to synchronize the whole vault for the first time

### Subsequent Usage

Once you perform any changes to your vault, you can click `Sync your changes to Jade`
button(![Cloud Upload Icon](cloud-upload.svg)) in the left sidebar of Obsidian to immediately synchronize your
changes to your Jade service.
