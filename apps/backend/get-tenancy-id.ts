import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getTenancyId() {
  try {
    // Get the first tenancy from the database
    const tenancy = await prisma.tenancy.findFirst();
    
    if (!tenancy) {
      console.log('No tenancy found in the database');
      return null;
    }
    
    console.log('Found tenancy:', {
      id: tenancy.id,
      projectId: tenancy.projectId,
      branchId: tenancy.branchId,
    });
    
    return tenancy.id;
  } catch (error) {
    console.error('Error getting tenancy ID:', error);
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

getTenancyId();
