import fs from 'fs';
import path from 'path';

export const findPackageRootFromSource = (sourcePath: string): string => {
  let currentPath = path.dirname(path.resolve(sourcePath));
  while (true) {
    if (fs.existsSync(path.join(currentPath, 'package.json'))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  throw new Error(`Could not find a package.json for source path ${sourcePath}`);
};
