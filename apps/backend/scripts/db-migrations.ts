import { prismaClient } from "@/prisma-client";
import { applyMigrations, refreshMigrationFiles } from "@/utils/auto-migration";
import { execSync } from "child_process";

const main = async () => {
  // Run prisma migrate dev to create new migration
  execSync('pnpm prisma migrate dev --skip-seed', { stdio: 'inherit' });

  // Drop everything in the current db
  await prismaClient.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
  await prismaClient.$executeRawUnsafe(`CREATE SCHEMA public`);
  await prismaClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO postgres`);
  await prismaClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO public`);

  // Apply migration with auto-migration system
  refreshMigrationFiles();
  await applyMigrations({ appliedMigrationsIfNoMigrationTable: [] });

  execSync('pnpm run db-seed-script', { stdio: 'inherit' });
};

main().catch(console.error);
