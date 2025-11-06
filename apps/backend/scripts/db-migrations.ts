import { applyMigrations } from "@/auto-migrations";
import { MIGRATION_FILES_DIR, getMigrationFiles } from "@/auto-migrations/utils";
import { globalPrismaClient, globalPrismaSchema, sqlQuoteIdent } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import * as readline from "readline";
import { seed } from "../prisma/seed";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

const dropSchema = async () => {
  await globalPrismaClient.$executeRaw(Prisma.sql`DROP SCHEMA ${sqlQuoteIdent(globalPrismaSchema)} CASCADE`);
  await globalPrismaClient.$executeRaw(Prisma.sql`CREATE SCHEMA ${sqlQuoteIdent(globalPrismaSchema)}`);
  await globalPrismaClient.$executeRaw(Prisma.sql`GRANT ALL ON SCHEMA ${sqlQuoteIdent(globalPrismaSchema)} TO postgres`);
  await globalPrismaClient.$executeRaw(Prisma.sql`GRANT ALL ON SCHEMA ${sqlQuoteIdent(globalPrismaSchema)} TO public`);
};


const askQuestion = (question: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const promptDropDb = async () => {
  const answer = (await askQuestion(
    'Are you sure you want to drop everything in the database? This action cannot be undone. (y/N): ',
  )).trim();

  if (answer.toLowerCase() !== 'y') {
    console.log('Operation cancelled');
    process.exit(0);
  }
};

const formatMigrationName = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const promptMigrationName = async () => {
  while (true) {
    const rawName = (await askQuestion('Enter a migration name: ')).trim();
    const formattedName = formatMigrationName(rawName);

    if (!formattedName) {
      console.log('Migration name cannot be empty. Please try again.');
      continue;
    }

    if (formattedName !== rawName) {
      console.log(`Using sanitized migration name: ${formattedName}`);
    }

    return formattedName;
  }
};

const timestampPrefix = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

const generateMigrationFile = async () => {
  const migrationName = await promptMigrationName();
  const folderName = `${timestampPrefix()}_${migrationName}`;
  const migrationDir = path.join(MIGRATION_FILES_DIR, folderName);
  const migrationSqlPath = path.join(migrationDir, 'migration.sql');
  const diffUrl = getEnvVariable('STACK_DIRECT_DATABASE_CONNECTION_STRING');

  console.log(`Generating migration ${folderName}...`);
  const diffResult = spawnSync(
    'pnpm',
    [
      '-s',
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      diffUrl,
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  if (diffResult.error || diffResult.status !== 0) {
    console.error(diffResult.stdout);
    console.error(diffResult.stderr);
    throw diffResult.error ?? new Error(`Failed to generate migration (exit code ${diffResult.status})`);
  }

  const sql = diffResult.stdout;

  if (!sql.trim()) {
    console.log('No schema changes detected. Migration file was not created.');
  } else {
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(migrationSqlPath, sql, 'utf8');
    console.log(`Migration written to ${path.relative(process.cwd(), migrationSqlPath)}`);
    console.log('Applying migration...');
    await migrate([{ migrationName: folderName, sql }]);
  }
};

const migrate = async (selectedMigrationFiles?: { migrationName: string, sql: string }[]) => {
  const startTime = performance.now();
  const migrationFiles = selectedMigrationFiles ?? getMigrationFiles(MIGRATION_FILES_DIR);
  const totalMigrations = migrationFiles.length;

  const result = await applyMigrations({
    prismaClient: globalPrismaClient,
    migrationFiles,
    logging: true,
    schema: globalPrismaSchema,
  });

  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Migrations completed successfully`);
  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📁 Total migrations in folder: ${totalMigrations}`);
  console.log(`🆕 Newly applied migrations: ${result.newlyAppliedMigrationNames.length}`);
  console.log(`✓  Already applied migrations: ${totalMigrations - result.newlyAppliedMigrationNames.length}`);

  if (result.newlyAppliedMigrationNames.length > 0) {
    console.log('\n📝 Newly applied migrations:');
    result.newlyAppliedMigrationNames.forEach((name, index) => {
      console.log(`   ${index + 1}. ${name}`);
    });
  } else {
    console.log('\n✨ Database is already up to date!');
  }

  console.log('='.repeat(60) + '\n');

  return result;
};

const showHelp = () => {
  console.log(`Database Migration Script

Usage: pnpm db-migrations <command>

Commands:
  reset                    Drop all data and recreate the database, then apply migrations and seed
  generate-migration-file  Generate a new migration file using Prisma, then reset and migrate
  seed                     [Advanced] Run database seeding only
  init                     Apply migrations and seed the database
  migrate                  Apply migrations
  help                     Show this help message
`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'reset': {
      await promptDropDb();
      await dropSchema();
      await migrate();
      await seed();
      break;
    }
    case 'generate-migration-file': {
      await promptDropDb();
      await dropSchema();
      await migrate();
      await generateMigrationFile();
      await seed();
      break;
    }
    case 'seed': {
      await seed();
      break;
    }
    case 'init': {
      await migrate();
      await seed();
      break;
    }
    case 'migrate': {
      await migrate();
      break;
    }
    case 'help': {
      showHelp();
      break;
    }
    default: {
      console.error('Unknown command.');
      showHelp();
      process.exit(1);
    }
  }
};

// eslint-disable-next-line no-restricted-syntax
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
