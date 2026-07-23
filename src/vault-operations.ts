import type { TFile, Vault } from "obsidian";
import type { ApiClient } from "./api";

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export type SyncProgress = (done: number, total: number) => void;

export interface SyncResult {
  notesUploaded: number;
  attachmentsUploaded: number;
  deletedCount: number;
}

export class VaultSyncService {
  constructor(
    private apiClient: ApiClient,
    private vault: Vault
  ) {}

  async syncAll(onProgress?: SyncProgress, readFile?: (file: TFile) => Promise<ArrayBuffer>): Promise<SyncResult> {
    const files = this.vault.getFiles();
    const read = readFile ?? ((file: TFile) => this.vault.readBinary(file));

    const startResult = await this.apiClient.startSyncTask();
    const taskId = startResult.data?.taskId as string;
    if (!taskId) {
      throw new Error("Failed to create sync task");
    }

    let notesUploaded = 0;
    let attachmentsUploaded = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await read(file);
      const mimeType = file.extension === "md" ? "text/markdown" : getMimeType(file.extension);

      await this.apiClient.uploadSyncFile(taskId, file.path, content, mimeType);

      if (file.extension === "md") {
        notesUploaded++;
      } else {
        attachmentsUploaded++;
      }

      onProgress?.(i + 1, files.length);
    }

    const completeResult = await this.apiClient.completeSyncTask(taskId);
    const deletedCount = (completeResult.data?.deletedCount as number) ?? 0;

    return { notesUploaded, attachmentsUploaded, deletedCount };
  }
}

export type PullProgress = (done: number, total: number) => void;

export interface PullResult {
  notesPulled: number;
  attachmentsPulled: number;
}

export class VaultPullService {
  constructor(
    private apiClient: ApiClient,
    private vault: Vault
  ) {}

  async pullAll(overwrite: boolean, onProgress?: PullProgress): Promise<PullResult> {
    const notesResult = await this.apiClient.listNotesForVault();
    const notes: Array<{ vault: string; path: string }> = notesResult?.data?.notes ?? [];
    let total = notes.length;

    let storageResult: { data?: { objects?: Array<{ name: string; path: string }> } } = {
      data: { objects: [] },
    };
    try {
      storageResult = await this.apiClient.listStorageObjects();
    } catch (err) {
      console.warn("Failed to list storage objects:", err);
    }
    const objects = storageResult?.data?.objects ?? [];
    total += objects.length;

    let notesPulled = 0;
    let attachmentsPulled = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const filePath = note.path;
      const existingFile = this.vault.getAbstractFileByPath(filePath);

      if (!overwrite && existingFile) {
        continue;
      }

      const textResult = await this.apiClient.getNoteText(filePath);
      const text = (textResult?.data?.text as string) ?? "";

      await this.ensureParentFolder(filePath);

      if (existingFile) {
        await this.vault.modify(existingFile as TFile, text);
      } else {
        await this.vault.create(filePath, text);
      }
      notesPulled++;

      onProgress?.(notesPulled + attachmentsPulled, total);
    }

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const filePath = obj.path;
      const existingFile = this.vault.getAbstractFileByPath(filePath);

      if (!overwrite && existingFile) {
        continue;
      }

      const buffer = await this.apiClient.downloadStorageObject(filePath);

      await this.ensureParentFolder(filePath);

      if (existingFile) {
        await this.vault.modifyBinary(existingFile as TFile, buffer);
      } else {
        await this.vault.createBinary(filePath, buffer);
      }
      attachmentsPulled++;

      onProgress?.(notesPulled + attachmentsPulled, total);
    }

    return { notesPulled, attachmentsPulled };
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop();
    if (parts.length === 0) return;

    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const exists = this.vault.getAbstractFileByPath(currentPath);
      if (!exists) {
        await this.vault.createFolder(currentPath);
      }
    }
  }
}
