import { applyMigrations } from "@/auto-migrations";
import { MIGRATION_FILES_DIR, getMigrationFiles } from "@/auto-migrations/utils";
import { prismaClient } from "@/prisma-client";
import { execSync } from "child_process";
import * as readline from 'readline';

const dropPublicSchema = async () => {
  await prismaClient.$executeRaw`DROP SCHEMA public CASCADE`;
  await prismaClient.$executeRaw`CREATE SCHEMA public`;
  await prismaClient.$executeRaw`GRANT ALL ON SCHEMA public TO postgres`;
  await prismaClient.$executeRaw`GRANT ALL ON SCHEMA public TO public`;
};

const seed = async () => {
  execSync('pnpm run db-seed-script', { stdio: 'inherit' });
};

const promptDropDb = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>(resolve => {
    rl.question('Are you sure you want to drop everything in the database? This action cannot be undone. (y/N): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Operation cancelled');
    process.exit(0);
  }
};

const migrate = async () => {
  await applyMigrations({
    prismaClient,
    migrationFiles: getMigrationFiles(MIGRATION_FILES_DIR),
    logging: true,
  });
  await seed();
};

const showHelp = () => {
  console.log(`Database Migration Script

Usage: pnpm db-migrations <command>

Commands:
  reset                    Drop all data and recreate the database, then apply migrations and seed
  generate-migration-file  Generate a new migration file using Prisma, then reset and migrate
  seed                     [Advanced] Run database seeding only
  init                     Apply migrations and seed the database
  help                     Show this help message

Examples:
  pnpm db-migrations reset
  pnpm db-migrations generate-migration-file
  pnpm db-migrations seed
  pnpm db-migrations init
  pnpm db-migrations help
`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'reset': {
      await promptDropDb();
      await dropPublicSchema();
      await migrate();
      await seed();
      break;
    }
    case 'generate-migration-file': {
      execSync('pnpm prisma migrate dev --skip-seed', { stdio: 'inherit' });
      await dropPublicSchema();
      await migrate();
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
main().catch(console.error);
