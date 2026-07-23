// src/types.ts
export interface JadePublisherSettings {
  endpoint: string;
  lastVaultName?: string;
}

export interface ContentWriter {
  get isWriting(): boolean;
  writeContent(filePath: string, content: string): void;
  beginSuppress(): void;
  endSuppress(): void;
}
