/**
 * update-coverage-badge.js
 *
 * Reads the merged LCOV report, computes combined coverage percentage,
 * and posts a shields.io-compatible JSON endpoint to a GitHub Gist.
 *
 * Required env vars (for Gist update):
 *   GIST_TOKEN  – GitHub personal access token with "gist" scope
 *   GIST_ID     – ID of the Gist to update
 *
 * The Gist must contain a file named "coverage.json" (created on first run).
 * The resulting badge URL:
 *   https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<user>/<gist-id>/raw/coverage.json
 *
 * Usage: node scripts/update-coverage-badge.js [lcov-path]
 *   Default lcov path: coverage/merged/combined.lcov.info
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const LCOV_PATH = process.argv[2] || 'coverage/merged/combined.lcov.info';

function getColor(pct) {
  if (pct >= 80) return 'brightgreen';
  if (pct >= 60) return 'yellowgreen';
  if (pct >= 40) return 'yellow';
  if (pct >= 20) return 'orange';
  return 'red';
}

function readLcov(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let totalFound = 0;
  let totalHit = 0;

  for (const line of lines) {
    if (line.startsWith('LF:')) {
      totalFound += parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('LH:')) {
      totalHit += parseInt(line.slice(3), 10) || 0;
    }
  }

  return { totalFound, totalHit };
}

async function main() {
  // Resolve lcov path relative to project root
  const lcovPath = path.resolve(__dirname, '..', LCOV_PATH);

  if (!fs.existsSync(lcovPath)) {
    console.log(`[coverage-badge] LCOV file not found: ${lcovPath}`);
    console.log('[coverage-badge] Skipping badge update.');
    process.exit(0);
  }

  const { totalFound, totalHit } = readLcov(lcovPath);

  if (!totalFound) {
    console.log('[coverage-badge] No coverage data found in LCOV file.');
    process.exit(0);
  }

  const pct = ((totalHit / totalFound) * 100).toFixed(1);
  const color = getColor(parseFloat(pct));

  const badgeJson = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${pct}%`,
    color,
  };

  console.log(`[coverage-badge] Coverage: ${pct}% (${totalHit}/${totalFound}) — ${color}`);

  // Output the badge JSON to a local file for artifact upload
  const outDir = path.resolve(__dirname, '..', 'coverage');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'badge.json'), JSON.stringify(badgeJson, null, 2));
  console.log(`[coverage-badge] Written to coverage/badge.json`);

  // Post to Gist if credentials are available
  const gistToken = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!gistToken || !gistId) {
    console.log('[coverage-badge] GIST_TOKEN or GIST_ID not set — badge file saved locally but not posted to Gist.');
    console.log('[coverage-badge] To enable live badge:');
    console.log('[coverage-badge]   1. Create a Gist with file "coverage.json" containing: ' + JSON.stringify(badgeJson));
    console.log('[coverage-badge]   2. Set GIST_ID and GIST_TOKEN as repo secrets in GitHub.');
    console.log('[coverage-badge]   3. Badge URL: https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<user>/<gist-id>/raw/coverage.json');
    return;
  }

  try {
    const gistPayload = JSON.stringify({
      files: {
        'coverage.json': {
          content: JSON.stringify(badgeJson, null, 2),
        },
      },
    });

    const url = new URL(`https://api.github.com/gists/${gistId}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'PATCH',
      headers: {
        Authorization: `token ${gistToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'coverage-badge-updater',
        'Content-Length': Buffer.byteLength(gistPayload),
      },
    };

    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[coverage-badge] ✅ Gist updated successfully.');
            console.log(`[coverage-badge] Badge: https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/<user>/${gistId}/raw/coverage.json`);
            resolve();
          } else {
            console.error(`[coverage-badge] ❌ Gist update failed (${res.statusCode}): ${body}`);
            reject(new Error(`Gist update failed: ${res.statusCode}`));
          }
        });
      });
      req.on('error', (err) => {
        console.error('[coverage-badge] ❌ Network error:', err.message);
        reject(err);
      });
      req.write(gistPayload);
      req.end();
    });
  } catch (err) {
    console.error(`[coverage-badge] ❌ Failed to update Gist: ${err.message}`);
    process.exit(1);
  }
}

main();
