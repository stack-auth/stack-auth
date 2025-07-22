import { applyMigrations } from "@/auto-migrations";
import { MIGRATION_FILES_DIR, getMigrationFiles } from "@/auto-migrations/utils";
import { globalPrismaClient, globalPrismaSchema } from "@/prisma-client";
import { execSync } from "child_process";
import * as readline from 'readline';

const dropSchema = async () => {
  await globalPrismaClient.$executeRaw`DROP SCHEMA ${globalPrismaSchema} CASCADE`;
  await globalPrismaClient.$executeRaw`CREATE SCHEMA ${globalPrismaSchema}`;
  await globalPrismaClient.$executeRaw`GRANT ALL ON SCHEMA ${globalPrismaSchema} TO postgres`;
  await globalPrismaClient.$executeRaw`GRANT ALL ON SCHEMA ${globalPrismaSchema} TO public`;
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
    schema: globalPrismaSchema,
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
      await dropSchema();
      await migrate();
      await seed();
      break;
    }
    case 'generate-migration-file': {
      execSync('pnpm prisma migrate dev --skip-seed', { stdio: 'inherit' });
      await dropSchema();
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
