import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Log all available models in the Prisma client
console.log('Available models in Prisma client:');
console.log(Object.keys(prisma));

// Disconnect from the database
prisma.$disconnect();
