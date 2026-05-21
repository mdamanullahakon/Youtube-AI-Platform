const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const p = new PrismaClient();

async function main() {
  const projectId = 'cmpd3whi4000bw80wvz0zvabs';

  // Delete stale videoRender record
  const vr = await p.videoRender.findFirst({ where: { projectId } });
  if (vr) {
    await p.videoRender.delete({ where: { id: vr.id } });
    console.log('Deleted stale videoRender');
  }

  // Reset project status
  await p.videoProject.update({
    where: { id: projectId },
    data: { status: 'voiceover_generated' }
  });
  console.log('Reset project status to voiceover_generated');

  // Clean up stale video files
  const videoDir = path.join(process.cwd(), 'uploads', 'videos');
  if (fs.existsSync(videoDir)) {
    const files = fs.readdirSync(videoDir).filter(f => f.startsWith(projectId));
    for (const f of files) {
      fs.unlinkSync(path.join(videoDir, f));
      console.log(`Deleted stale video: ${f}`);
    }
  }

  await p.$disconnect();
  console.log('\nReady for re-render. Run the force_render.cjs script.');
}
main().catch(e => { console.error(e); p.$disconnect(); });
