import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;
let cachedToken: string | null = null;

export const initSupabase = (url: string, anonKey: string): void => {
  if (!url || !anonKey) {
    supabaseClient = null;
    cachedToken = null;
    return;
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    cachedToken = session?.access_token ?? null;
  });

  supabaseClient.auth.getSession().then(({ data }) => {
    cachedToken = data.session?.access_token ?? null;
  });
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.access_token ?? null;
};

export const getCachedToken = (): string | null => {
  return cachedToken;
};

export const signIn = async (email: string, password: string) => {
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  return supabaseClient.auth.signInWithPassword({ email, password });
};

export const signOut = async () => {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
};

export const getUserEmail = async (): Promise<string | null> => {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.user?.email ?? null;
};
