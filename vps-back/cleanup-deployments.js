const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupStuckDeployments() {
  console.log('🧹 Cleaning up stuck deployments...\n');

  // Find deployments that are stuck in progress states
  const stuckDeployments = await prisma.deployment.findMany({
    where: {
      status: {
        in: ['QUEUED', 'CLONING', 'ANALYZING', 'BUILDING', 'DEPLOYING']
      },
      createdAt: {
        lt: new Date(Date.now() - 5 * 60 * 1000) // Older than 5 minutes
      }
    }
  });

  console.log(`Found ${stuckDeployments.length} stuck deployments:\n`);

  for (const deployment of stuckDeployments) {
    console.log(`  - ${deployment.id} (${deployment.status}) - ${deployment.branch}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'ERROR',
        errorMessage: 'Deployment timed out or was interrupted',
        buildFinished: new Date()
      }
    });
  }

  console.log('\n✅ Cleanup complete!');
  await prisma.$disconnect();
}

cleanupStuckDeployments().catch(console.error);
