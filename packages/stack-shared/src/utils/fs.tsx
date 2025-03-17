import * as stackFs from "fs";
import * as path from "path";

export async function list(path: string) {
  return await stackFs.promises.readdir(path);
}

export async function listRecursively(p: string, options: { excludeDirectories?: boolean } = {}): Promise<string[]> {
  const files = await list(p);
  return [
    ...(await Promise.all(files.map(async (fileName) => {
      const filePath = path.join(p, fileName);
      if ((await stackFs.promises.stat(filePath)).isDirectory()) {
        return [
          ...(await listRecursively(filePath, options)),
          ...(options.excludeDirectories ? [] : [filePath]),
        ];
      } else {
        return [filePath];
      }
    }))).flat(),
  ];
}

export function writeFileSyncIfChanged(path: string, content: string): void {
  if (stackFs.existsSync(path)) {
    const existingContent = stackFs.readFileSync(path, "utf-8");
    if (existingContent === content) {
      return;
    }
  }
  stackFs.writeFileSync(path, content);
}
