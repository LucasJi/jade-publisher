export class AuthClient {
  private cachedToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry = 0;
  private userEmail: string | null = null;
  private baseUrl: string;
  private staticToken: string | null = null;
  private saveFn: (() => Promise<void>) | null = null;

  constructor(baseUrl: string, saveFn?: () => Promise<void>) {
    this.baseUrl = `${baseUrl}/api`;
    this.saveFn = saveFn ?? null;
  }

  setStaticToken(token: string | null): void {
    this.staticToken = token;
  }

  setSaveFn(fn: () => Promise<void>): void {
    this.saveFn = fn;
  }

  loadState(data: Record<string, unknown> | null): void {
    const auth = (data?.auth as Record<string, unknown>) ?? {};
    this.cachedToken = (auth.token as string) ?? null;
    this.refreshToken = (auth.refreshToken as string) ?? null;
    this.tokenExpiry = (auth.tokenExpiry as number) ?? 0;
    this.userEmail = (auth.userEmail as string) ?? null;
  }

  getState(): {
    token: string | null;
    refreshToken: string | null;
    tokenExpiry: number;
    userEmail: string | null;
  } {
    return {
      token: this.cachedToken,
      refreshToken: this.refreshToken,
      tokenExpiry: this.tokenExpiry,
      userEmail: this.userEmail,
    };
  }

  async getToken(): Promise<string | null> {
    if (this.staticToken) return this.staticToken;

    if (this.cachedToken && this.tokenExpiry && Date.now() > this.tokenExpiry - 60_000) {
      if (this.refreshToken) {
        try {
          await this.doRefresh();
        } catch {
          this.cachedToken = null;
          this.refreshToken = null;
          this.tokenExpiry = 0;
          this.userEmail = null;
          await this.saveFn?.();
        }
      } else {
        this.cachedToken = null;
        this.tokenExpiry = 0;
      }
    }
    return this.cachedToken;
  }

  async isAuthenticated(): Promise<boolean> {
    if (this.staticToken) return true;
    const token = await this.getToken();
    return token !== null;
  }

  async signIn(email: string, password: string) {
    const resp = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const json = await resp.json();

    if (json.code !== 0) {
      throw new Error(json.msg ?? "Login failed");
    }

    this.cachedToken = json.data.access_token;
    this.refreshToken = json.data.refresh_token;
    this.tokenExpiry = (json.data.expires_at as number) * 1000;
    this.userEmail = email;

    await this.saveFn?.();

    return json;
  }

  async signOut(): Promise<void> {
    if (this.cachedToken) {
      fetch(`${this.baseUrl}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cachedToken}`,
        },
      }).catch((err) => {
        console.error("Failed to revoke token:", err);
      });
    }

    this.cachedToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.userEmail = null;

    await this.saveFn?.();
  }

  getUserEmail(): string | null {
    return this.userEmail;
  }

  private async doRefresh() {
    const resp = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });

    const json = await resp.json();

    if (json.code !== 0) {
      throw new Error(json.msg ?? "Token refresh failed");
    }

    this.cachedToken = json.data.access_token;
    this.refreshToken = json.data.refresh_token;
    this.tokenExpiry = (json.data.expires_at as number) * 1000;

    await this.saveFn?.();
  }
}
