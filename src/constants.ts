// src/constants.ts
import { diff_match_patch } from "diff-match-patch";

export const WEBSOCKET_PATH = "/hocuspocus";

export const DEFAULT_SETTINGS = {
  endpoint: "",
  accessToken: "",
  lastVaultName: "",
} as const;

export const dmp = new diff_match_patch();
