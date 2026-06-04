import * as hexclaveFs from "fs";
import * as path from "path";

export async function list(path: string) {
  return await hexclaveFs.promises.readdir(path);
}

export async function listRecursively(p: string, options: { excludeDirectories?: boolean } = {}): Promise<string[]> {
  const files = await list(p);
  return [
    ...(await Promise.all(files.map(async (fileName) => {
      const filePath = path.join(p, fileName);
      if ((await hexclaveFs.promises.stat(filePath)).isDirectory()) {
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
  if (hexclaveFs.existsSync(path)) {
    const existingContent = hexclaveFs.readFileSync(path, "utf-8");
    if (existingContent === content) {
      return;
    }
  }
  hexclaveFs.writeFileSync(path, content);
}
