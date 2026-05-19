import { PrismaClient } from '@prisma/client';
async function main() {
  const p = new PrismaClient();
  try {
    const accounts = await (p as any).youTubeAccount.findMany();
    console.log('YouTube accounts:', JSON.stringify(accounts, null, 2));
    const users = await (p as any).user.findMany({ take: 5, select: { id: true, email: true } });
    console.log('Users:', JSON.stringify(users, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  await (p as any).$disconnect();
}
main();
