let cachedToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiry: number = 0;
let userEmail: string | null = null;
let baseUrl = "";
let pluginSave: (() => Promise<void>) | null = null;

export const setOnAuthChange = (save: () => Promise<void>) => {
  pluginSave = save;
};

export const loadAuthState = (data: Record<string, unknown> | null) => {
  const auth = (data?.auth as Record<string, unknown>) ?? {};
  cachedToken = (auth.token as string) ?? null;
  refreshToken = (auth.refreshToken as string) ?? null;
  tokenExpiry = (auth.tokenExpiry as number) ?? 0;
  userEmail = (auth.userEmail as string) ?? null;
};

export const getAuthState = () => ({
  token: cachedToken,
  refreshToken,
  tokenExpiry,
  userEmail,
});

export const setEndpoint = (endpoint: string) => {
  baseUrl = `${endpoint}/api`;
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedToken && tokenExpiry && Date.now() > tokenExpiry - 60_000) {
    if (refreshToken) {
      try {
        await doRefresh();
      } catch {
        cachedToken = null;
        refreshToken = null;
        tokenExpiry = 0;
        userEmail = null;
        await pluginSave?.();
      }
    } else {
      cachedToken = null;
      tokenExpiry = 0;
    }
  }
  return cachedToken;
};

export const isAuthenticated = async (staticToken?: string): Promise<boolean> => {
  if (staticToken) return true;
  const token = await getAccessToken();
  return token !== null;
};

export const signIn = async (email: string, password: string) => {
  const resp = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const json = await resp.json();

  if (json.code !== 0) {
    throw new Error(json.msg ?? "Login failed");
  }

  cachedToken = json.data.access_token;
  refreshToken = json.data.refresh_token;
  tokenExpiry = (json.data.expires_at as number) * 1000;
  userEmail = email;

  await pluginSave?.();

  return json;
};

export const signOut = async () => {
  if (cachedToken) {
    fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cachedToken}`,
      },
    }).catch((err) => {
      console.error("Failed to revoke token:", err);
    });
  }

  cachedToken = null;
  refreshToken = null;
  tokenExpiry = 0;
  userEmail = null;

  await pluginSave?.();
};

export const getUserEmail = (): string | null => {
  return userEmail;
};

async function doRefresh() {
  const resp = await fetch(`${baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const json = await resp.json();

  if (json.code !== 0) {
    throw new Error(json.msg ?? "Token refresh failed");
  }

  cachedToken = json.data.access_token;
  refreshToken = json.data.refresh_token;
  tokenExpiry = (json.data.expires_at as number) * 1000;

  await pluginSave?.();
}
