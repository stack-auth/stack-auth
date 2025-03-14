import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "fs";
import path from "path";

export const MIGRATION_FILES_DIR = path.join(process.cwd(),  'prisma', 'migrations');

export function getMigrationFiles(migrationDir: string): Array<{ name: string, sql: string }> {
  const folders = fs.readdirSync(migrationDir).filter(folder =>
    fs.statSync(path.join(migrationDir, folder)).isDirectory()
  );

  const result: Array<{ name: string, sql: string }> = [];

  for (const folder of folders) {
    const folderPath = path.join(migrationDir, folder);
    const sqlFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.sql'));

    for (const sqlFile of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(folderPath, sqlFile), 'utf8');
      result.push({
        name: folder,
        sql: sqlContent
      });
    }
  }

  result.sort((a, b) => stringCompare(a.name, b.name));

  return result;
}

