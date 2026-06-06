export const publish = async (baseUrl: string, vault: string) => {
  return fetch(`${baseUrl}/vaults/${vault}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }).then((resp) => resp.json());
};
