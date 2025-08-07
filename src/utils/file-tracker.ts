export type FileState = "created" | "modified" | "deleted" | "renamed";

export interface FileHistoryEntry {
  type: FileState;
  timestamp: number;
}

export interface FileRecord {
  initPath: string;
  currentPath: string;
  history: FileHistoryEntry[];
}

export interface StateData {
  files: Record<string, FileRecord>;
  lastSyncTime: number;
}

export class FileTracker {
  private state: StateData;

  constructor(state: StateData) {
    this.state = state;
  }

  trackCreated(filePath: string) {
    const fileRecord = this.state.files[filePath];
    if (!fileRecord) {
      this.state.files[filePath] = {
        initPath: filePath,
        currentPath: filePath,
        history: [
          {
            type: "created",
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        type: "created",
        timestamp: Date.now(),
      });
    }
  }

  trackModified(filePath: string) {
    const fileRecord = this.state.files[filePath];
    if (!fileRecord) {
      this.state.files[filePath] = {
        initPath: filePath,
        currentPath: filePath,
        history: [
          {
            type: "modified",
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        type: "modified",
        timestamp: Date.now(),
      });
    }
  }

  trackDeleted(filePath: string) {
    const fileRecord = this.state.files[filePath];
    if (!fileRecord) {
      this.state.files[filePath] = {
        initPath: filePath,
        currentPath: filePath,
        history: [
          {
            type: "deleted",
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        type: "deleted",
        timestamp: Date.now(),
      });
    }
  }

  trackRenamed(oldPath: string, newPath: string) {
    const oldFileRecord = this.state.files[oldPath];
    if (oldFileRecord) {
      this.state.files[oldPath].history.push({
        type: "deleted",
        timestamp: Date.now(),
      });
    }

    const newFileRecord = this.state.files[newPath];
    if (newFileRecord) {
      this.state.files[newPath].history.push({
        type: "created",
        timestamp: Date.now(),
      });
    } else {
      this.state.files[newPath] = {
        initPath: newPath,
        currentPath: newPath,
        history: [
          {
            type: "created",
            timestamp: Date.now(),
          },
        ],
      };
    }
  }
}
