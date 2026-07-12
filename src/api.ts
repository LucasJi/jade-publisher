const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

let getToken: () => Promise<string | null> = async () => null;

export const setTokenProvider = (provider: () => Promise<string | null>) => {
  getToken = provider;
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const getUploadAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

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

export const publish = async (baseUrl: string, vault: string) => {
  const headers = await getAuthHeaders();
  const response = await fetchWithRetry(`${baseUrl}/vaults/${vault}/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Publish failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const deleteNote = async (baseUrl: string, vault: string, filePath: string) => {
  const headers = await getAuthHeaders();
  const response = await fetchWithRetry(`${baseUrl}/vaults/${vault}/notes/${encodeURIComponent(filePath)}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const renameNote = async (baseUrl: string, vault: string, oldPath: string, newPath: string) => {
  const headers = await getAuthHeaders();
  const response = await fetchWithRetry(`${baseUrl}/vaults/${vault}/notes/${encodeURIComponent(oldPath)}/rename`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ newPath }),
  });

  if (!response.ok) {
    throw new Error(`Rename failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const startSyncTask = async (baseUrl: string, vault: string) => {
  const headers = await getAuthHeaders();
  const response = await fetchWithRetry(`${baseUrl}/vaults/${encodeURIComponent(vault)}/sync`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Start sync task failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const uploadSyncFile = async (
  baseUrl: string,
  vault: string,
  taskId: string,
  filePath: string,
  content: ArrayBuffer,
  mimeType: string
) => {
  const formData = new FormData();
  const blob = new Blob([content], { type: mimeType });
  formData.append("file", blob, encodeURIComponent(filePath));

  const headers = await getUploadAuthHeaders();
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${encodeURIComponent(vault)}/sync/${encodeURIComponent(taskId)}`,
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
};

export const completeSyncTask = async (baseUrl: string, vault: string, taskId: string) => {
  const headers = await getAuthHeaders();
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${encodeURIComponent(vault)}/sync/${encodeURIComponent(taskId)}/complete`,
    {
      method: "POST",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Complete sync task failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const listNotesForVault = async (baseUrl: string, vault: string) => {
  const response = await fetchWithRetry(`${baseUrl}/vaults/${encodeURIComponent(vault)}/notes`, {});

  if (!response.ok) {
    throw new Error(`List notes failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const getNoteText = async (baseUrl: string, vault: string, path: string) => {
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${encodeURIComponent(vault)}/note?path=${encodeURIComponent(path)}`,
    {}
  );

  if (!response.ok) {
    throw new Error(`Get note text failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const listStorageObjects = async (baseUrl: string, vault: string, prefix = "") => {
  const url = prefix
    ? `${baseUrl}/vaults/${encodeURIComponent(vault)}/storage/objects?prefix=${encodeURIComponent(prefix)}`
    : `${baseUrl}/vaults/${encodeURIComponent(vault)}/storage/objects`;

  const response = await fetchWithRetry(url, {});

  if (!response.ok) {
    throw new Error(`List storage objects failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const downloadStorageObject = async (baseUrl: string, vault: string, path: string) => {
  const response = await fetchWithRetry(
    `${baseUrl}/vaults/${encodeURIComponent(vault)}/storage/object?path=${encodeURIComponent(path)}`,
    {}
  );

  if (!response.ok) {
    throw new Error(`Download storage object failed: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
};
