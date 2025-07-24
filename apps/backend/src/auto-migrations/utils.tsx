import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "fs";
import path from "path";

export const MIGRATION_FILES_DIR = path.join(process.cwd(),  'prisma', 'migrations');

export function getMigrationFiles(migrationDir: string): { migrationName: string, sql: string }[] {
  const folders = fs.readdirSync(migrationDir).filter(folder =>
    fs.statSync(path.join(migrationDir, folder)).isDirectory()
  );

  const result: { migrationName: string, sql: string }[] = [];

  for (const folder of folders) {
    const folderPath = path.join(migrationDir, folder);
    const sqlFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.sql'));

    for (const sqlFile of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(folderPath, sqlFile), 'utf8');
      result.push({
        migrationName: folder,
        sql: sqlContent
      });
    }
  }

  result.sort((a, b) => stringCompare(a.migrationName, b.migrationName));

  return result;
}

