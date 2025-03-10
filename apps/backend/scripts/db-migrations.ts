import { prismaClient } from "@/prisma-client";
import { applyMigrations, refreshMigrationFiles } from "@/utils/auto-migration";
import { execSync } from "child_process";

const dropPublicSchema = async () => {
  await prismaClient.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
  await prismaClient.$executeRawUnsafe(`CREATE SCHEMA public`);
  await prismaClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO postgres`);
  await prismaClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO public`);
};

const seed = async () => {
  execSync('pnpm run db-seed-script', { stdio: 'inherit' });
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'reset': {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question('Are you sure you want to drop everything in the database? This action cannot be undone. (Y/n): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer !== '') {
        console.log('Operation cancelled');
        process.exit(0);
      }

      await dropPublicSchema();
      refreshMigrationFiles();
      await applyMigrations({ appliedMigrationsIfNoMigrationTable: [] });
      await seed();
      break;
    }
    case 'migration-file': {
      execSync('pnpm prisma migrate dev --skip-seed', { stdio: 'inherit' });
      await dropPublicSchema();
      refreshMigrationFiles();
      await applyMigrations({ appliedMigrationsIfNoMigrationTable: [] });
      await seed();
      break;
    }
    default: {
      console.error('Unknown command. Use "migration-file" or "reset"');
      process.exit(1);
    }
  }
};

main().catch(console.error);
