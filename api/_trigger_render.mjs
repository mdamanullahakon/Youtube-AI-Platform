import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();
const c = new IORedis('redis://localhost:6380', { maxRetriesPerRequest: null });

const project = await prisma.videoProject.findFirst({
  where: { script: { isNot: null } },
  orderBy: { createdAt: 'desc' }
});
console.log('Project:', project.id, project.status);

const q = new Queue('video-render', { connection: c });
const job = await q.add('render-video', { projectId: project.id }, { attempts: 1 });
console.log('Render job enqueued:', job.id);

await q.close();
await c.quit();
await prisma.$disconnect();
