import { writeFileSyncIfChanged } from '@stackframe/stack-shared/dist/utils/fs';
import path from 'path';
import { MIGRATION_FILES_DIR, getMigrationFiles } from '../src/auto-migrations/utils';

const migrationFiles = getMigrationFiles(MIGRATION_FILES_DIR);

writeFileSyncIfChanged(
  path.join(process.cwd(),  'src', 'auto-migrations', 'migration-files.tsx'),
  `export const MIGRATION_FILES = ${JSON.stringify(migrationFiles, null, 2)};`
);
