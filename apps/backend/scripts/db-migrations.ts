import { applyMigrations } from "@/auto-migrations";
import { MIGRATION_FILES_DIR, getMigrationFiles } from "@/auto-migrations/utils";
import { globalPrismaClient } from "@/prisma-client";
import { execSync } from "child_process";
import * as readline from 'readline';

const dropPublicSchema = async () => {
  await globalPrismaClient.$executeRaw`DROP SCHEMA public CASCADE`;
  await globalPrismaClient.$executeRaw`CREATE SCHEMA public`;
  await globalPrismaClient.$executeRaw`GRANT ALL ON SCHEMA public TO postgres`;
  await globalPrismaClient.$executeRaw`GRANT ALL ON SCHEMA public TO public`;
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
    prismaClient: globalPrismaClient,
    migrationFiles: getMigrationFiles(MIGRATION_FILES_DIR),
    logging: true,
  });
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
      await dropPublicSchema();
      await migrate();
      await seed();
      break;
    }
    case 'generate-migration-file': {
      execSync('pnpm prisma migrate dev --skip-seed', { stdio: 'inherit' });
      await dropPublicSchema();
      await migrate();
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
