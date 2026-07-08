// src/constants.ts
import { diff_match_patch } from "diff-match-patch";

export const WEBSOCKET_PATH = "/hocuspocus";

export enum NoteStatus {
  CREATED = "created",
  MODIFIED = "modified",
  DELETED = "deleted",
  RENAMED = "renamed",
}

export const DEFAULT_SETTINGS = {
  endpoint: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
  accessToken: "",
} as const;

export const dmp = new diff_match_patch();
