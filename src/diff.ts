import type { Diff } from "diff-match-patch";
import type * as Y from "yjs";
import { dmp } from "./constants";

export function applyDiffToDoc(doc: Y.Doc, text: string): void {
  const content = doc.getText("content");
  const oldContent = content.toString();
  const diffs: Diff[] = dmp.diff_main(oldContent, text);

  dmp.diff_cleanupSemantic(diffs);

  let cursor = 0;

  doc.transact(() => {
    const currentContent = content.toString();
    if (currentContent !== oldContent) {
      return;
    }

    for (const [operation, diffText] of diffs) {
      switch (operation) {
        case 1:
          content.insert(cursor, diffText);
          cursor += diffText.length;
          break;
        case 0:
          cursor += diffText.length;
          break;
        case -1:
          content.delete(cursor, diffText.length);
          break;
      }
    }
  }, null);
}
