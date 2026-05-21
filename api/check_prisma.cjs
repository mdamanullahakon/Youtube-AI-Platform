const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const keys = Object.keys(p).filter(k => k.toLowerCase().includes('youtube'));
console.log('YouTube-related Prisma accessors:', keys);
p.$disconnect();
