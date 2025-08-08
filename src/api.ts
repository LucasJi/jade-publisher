import type { SyncOperation } from "./utils/file-tracker";

export const checkHealth = async (baseUrl: string, accessToken: string): Promise<number> => {
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), 500);

  return fetch(`${baseUrl}/health`, {
    method: "GET",
    signal,
    headers: {
      authentication: accessToken,
    },
  })
    .then((resp) => resp.status)
    .catch(() => 500)
    .finally(() => clearTimeout(timeoutId));
};

export const sync = async (baseUrl: string, accessToken: string, formData: FormData) => {
  return fetch(`${baseUrl}`, {
    method: "POST",
    headers: {
      authentication: accessToken,
    },
    body: formData,
  }).then((resp) => resp.json());
};

export const flush = async (baseUrl: string, accessToken: string) => {
  return fetch(`${baseUrl}/flush`, {
    method: "GET",
    headers: {
      authentication: accessToken,
    },
  }).then((resp) => resp.json());
};

export const rebuild = async (
  baseUrl: string,
  accessToken: string,
  body: {
    files: {
      path: string;
      md5: string;
      extension: string;
      lastModified: string;
      isDeleted?: string;
    }[];
  }
) => {
  return fetch(`${baseUrl}/rebuild`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authentication: accessToken,
    },
    body: JSON.stringify(body),
  }).then((resp) => resp.json());
};

export const syncDoc = async ({
  path,
  content,
  lastPatchId,
  operation,
}: {
  path: string;
  content: string;
  lastPatchId?: number;
  operation: SyncOperation;
}) => {
  return fetch("http://localhost:3000/api/markdown/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path,
      content,
      lastPatchId,
      operation,
    }),
  }).then((resp) => resp.json());
};
