const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.script.findMany({ take: 5, orderBy: { createdAt: 'desc' } }).then(r => {
  for (const s of r) {
    const first200 = (s.content || '').substring(0, 200);
    const hasBrackets = /\[.*?\]/.test(s.content);
    const hasSections = /---/.test(s.content);
    console.log(`Script ${s.id}: project=${s.projectId}, hasBrackets=${hasBrackets}, hasSections=${hasSections}`);
    console.log(`  Content starts: ${JSON.stringify(first200)}`);
    console.log('');
  }
  p.$disconnect();
}).catch(e => { console.error(e); p.$disconnect(); });
