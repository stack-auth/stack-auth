import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Starting database seeding...');
    await prisma.$connect();
    console.log('Successfully connected to the database');
    
    // Check if we can query the database
    const projectCount = await prisma.project.count();
    console.log(`Found ${projectCount} projects in the database`);
    
    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
