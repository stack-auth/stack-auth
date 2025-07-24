import { writeFileSyncIfChanged } from '@stackframe/stack-shared/dist/utils/fs';
import fs from 'fs';
import path from 'path';
import { MIGRATION_FILES_DIR, getMigrationFiles } from '../src/auto-migrations/utils';

const migrationFiles = getMigrationFiles(MIGRATION_FILES_DIR);

fs.mkdirSync(path.join(process.cwd(), 'src', 'generated'), { recursive: true });

writeFileSyncIfChanged(
  path.join(process.cwd(), 'src', 'generated', 'migration-files.tsx'),
  `export const MIGRATION_FILES = ${JSON.stringify(migrationFiles, null, 2)};\n`
);
