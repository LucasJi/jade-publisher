export enum FileState {
  Created = "created",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}

export enum SyncOperation {
  Create = "create",
  Update = "update",
  Delete = "delete",
  Ignore = "ignore",
}

export interface FileHistoryEntry {
  state: FileState;
  timestamp: number;
}

export interface FileRecord {
  history: FileHistoryEntry[];
  lastPatchId?: number;
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
        history: [
          {
            state: FileState.Created,
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        state: FileState.Created,
        timestamp: Date.now(),
      });
    }
  }

  trackModified(filePath: string) {
    const fileRecord = this.state.files[filePath];
    if (!fileRecord) {
      this.state.files[filePath] = {
        history: [
          {
            state: FileState.Modified,
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        state: FileState.Modified,
        timestamp: Date.now(),
      });
    }
  }

  trackDeleted(filePath: string) {
    const fileRecord = this.state.files[filePath];
    if (!fileRecord) {
      this.state.files[filePath] = {
        history: [
          {
            state: FileState.Deleted,
            timestamp: Date.now(),
          },
        ],
      };
    } else {
      this.state.files[filePath].history.push({
        state: FileState.Deleted,
        timestamp: Date.now(),
      });
    }
  }

  trackRenamed(oldPath: string, newPath: string) {
    const oldFileRecord = this.state.files[oldPath];
    if (oldFileRecord) {
      this.state.files[oldPath].history.push({
        state: FileState.Deleted,
        timestamp: Date.now(),
      });
    }

    const newFileRecord = this.state.files[newPath];
    if (newFileRecord) {
      this.state.files[newPath].history.push({
        state: FileState.Created,
        timestamp: Date.now(),
      });
    } else {
      this.state.files[newPath] = {
        history: [
          {
            state: FileState.Created,
            timestamp: Date.now(),
          },
        ],
      };
    }
  }

  markSynced() {
    this.state.lastSyncTime = Date.now();
    for (const filePath in this.state.files) {
      this.state.files[filePath].history = [];
    }
  }

  generateSyncOperations() {
    console.log("last sync time", this.state.lastSyncTime);

    const operations = [];

    for (const filePath in this.state.files) {
      const fileRecord = this.state.files[filePath];

      if (!fileRecord) {
        continue;
      }

      const history = fileRecord.history;

      if (!history || history.length === 0) {
        continue;
      }

      const firstHistory = history[0];
      const lastHistory = history[history.length - 1];

      if (firstHistory.state === FileState.Created && lastHistory.state === FileState.Deleted) {
        console.log(`${filePath}:ignore`);
      } else if (firstHistory.state === FileState.Created && lastHistory.state !== FileState.Deleted) {
        operations.push({
          path: filePath,
          operation: SyncOperation.Create,
          lastPatchId: fileRecord.lastPatchId,
        });
      } else if (firstHistory.state !== FileState.Created && lastHistory.state === FileState.Deleted) {
        operations.push({
          path: filePath,
          operation: SyncOperation.Delete,
          lastPatchId: fileRecord.lastPatchId,
        });
      } else {
        operations.push({
          path: filePath,
          operation: SyncOperation.Update,
          lastPatchId: fileRecord.lastPatchId,
        });
      }
    }

    return operations;
  }

  updateLastPatchId(filePath: string, lastPatchId: number) {
    const fileRecord = this.state.files[filePath];
    if (fileRecord) {
      fileRecord.lastPatchId = lastPatchId;
    }
  }
}
