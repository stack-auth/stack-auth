import { watch, type FSWatcher } from "fs";
import { basename, dirname } from "path";

/**
 * Watch the containing directory rather than the file itself. Config updates
 * are written with an atomic rename, which replaces the file's inode and can
 * leave a file-scoped fs.watch attached to the now-unlinked old inode.
 */
export function watchConfigFile(configFilePath: string, onChange: () => void): FSWatcher {
  const configFileName = basename(configFilePath);
  return watch(dirname(configFilePath), { persistent: false }, (_eventType, changedFileName) => {
    // Some platforms omit the filename. Treat those events as relevant so a
    // missing optional detail can delay a sync but can never hide an update.
    if (changedFileName == null || changedFileName === configFileName) {
      onChange();
    }
  });
}
