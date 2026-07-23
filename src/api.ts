import type { AuthClient } from "./auth";

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);

      if (attempt < maxRetries) {
        const delay = 2 ** attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Request failed after all retries");
}

export class ApiClient {
  private baseUrl: string;
  private vaultName: string;
  private authClient: AuthClient;

  constructor(baseUrl: string, vaultName: string, authClient: AuthClient) {
    this.baseUrl = `${baseUrl}/api`;
    this.vaultName = vaultName;
    this.authClient = authClient;
  }

  setEndpoint(baseUrl: string): void {
    this.baseUrl = `${baseUrl}/api`;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.authClient.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async getUploadAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.authClient.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  async publish() {
    const headers = await this.getAuthHeaders();
    const response = await fetchWithRetry(`${this.baseUrl}/vaults/${this.vaultName}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Publish failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async deleteNote(filePath: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${this.vaultName}/notes/${encodeURIComponent(filePath)}`,
      {
        method: "DELETE",
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async renameNote(oldPath: string, newPath: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${this.vaultName}/notes/${encodeURIComponent(oldPath)}/rename`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ newPath }),
      }
    );

    if (!response.ok) {
      throw new Error(`Rename failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async startSyncTask() {
    const headers = await this.getAuthHeaders();
    const response = await fetchWithRetry(`${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/sync`, {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Start sync task failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async uploadSyncFile(taskId: string, filePath: string, content: ArrayBuffer, mimeType: string) {
    const formData = new FormData();
    const blob = new Blob([content], { type: mimeType });
    formData.append("file", blob, encodeURIComponent(filePath));

    const headers = await this.getUploadAuthHeaders();
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/sync/${encodeURIComponent(taskId)}`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Upload sync file failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async completeSyncTask(taskId: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/sync/${encodeURIComponent(taskId)}/complete`,
      {
        method: "POST",
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Complete sync task failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async listNotesForVault() {
    const response = await fetchWithRetry(`${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/notes`, {});

    if (!response.ok) {
      throw new Error(`List notes failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getNoteText(path: string) {
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/note?path=${encodeURIComponent(path)}`,
      {}
    );

    if (!response.ok) {
      throw new Error(`Get note text failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async listStorageObjects(prefix = "") {
    const url = prefix
      ? `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/storage/objects?prefix=${encodeURIComponent(prefix)}`
      : `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/storage/objects`;

    const response = await fetchWithRetry(url, {});

    if (!response.ok) {
      throw new Error(`List storage objects failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async downloadStorageObject(path: string) {
    const response = await fetchWithRetry(
      `${this.baseUrl}/vaults/${encodeURIComponent(this.vaultName)}/storage/object?path=${encodeURIComponent(path)}`,
      {}
    );

    if (!response.ok) {
      throw new Error(`Download storage object failed: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }
}
