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

export const publish = async (baseUrl: string, vault: string) => {
  return fetch(`${baseUrl}/vaults/${vault}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }).then((resp) => resp.json());
};
