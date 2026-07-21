// src/types.ts
export interface JadePublisherSettings {
  endpoint: string;
  accessToken: string;
}

export interface ContentWriter {
  get isWriting(): boolean;
  writeContent(filePath: string, content: string): void;
}
