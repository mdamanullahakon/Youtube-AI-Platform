import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const proj = await p.videoProject.findFirst({orderBy:{createdAt:'desc'}, include:{script:true,videoRender:true,uploadHistory:true,voiceover:true,thumbnail:true}});
console.log(JSON.stringify({
  status: proj?.status,
  hasScript: !!proj?.script,
  scriptWords: proj?.script?.wordCount,
  scenes: proj?.script?.content ? (proj.script.content.match(/\[.*?\]/g)||[]).length : 0,
  hasVoiceover: !!proj?.voiceover,
  hasThumbnail: !!proj?.thumbnail,
  hasRender: !!proj?.videoRender,
  renderStatus: proj?.videoRender?.status,
  renderUrl: proj?.videoRender?.videoUrl?.substring(0,100),
  hasUpload: !!proj?.uploadHistory,
  uploadStatus: proj?.uploadHistory?.status,
  hook: proj?.script?.hook?.substring(0,80)
}, null, 2));
await p.$disconnect();
