// Load environment variables before anything else
import * as dotenv from 'dotenv';
const envPath = require('path').resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// Now import Prisma after environment variables are loaded
import { PrismaClient } from '@prisma/client';

console.log('Environment variables loaded from:', envPath);
console.log('Database URL:', process.env.STACK_DATABASE_CONNECTION_STRING || 'Not set');

async function testPrisma() {
  if (!process.env.STACK_DATABASE_CONNECTION_STRING) {
    console.error('Error: STACK_DATABASE_CONNECTION_STRING is not set in .env file');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
    datasources: {
      db: {
        url: process.env.STACK_DATABASE_CONNECTION_STRING
      }
    }
  });

  try {
    await prisma.$connect();
    console.log('Successfully connected to the database!');
    
    // Test a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('Test query result:', result);
    
    return result;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the test
testPrisma()
  .then(() => {
    console.log('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
