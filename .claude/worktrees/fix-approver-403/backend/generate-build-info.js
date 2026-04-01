/**
 * Generate build-info.json with git commit hash and build timestamp.
 * Called by `npm run build-info` (part of the deploy pipeline).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const buildTime = new Date().toISOString();

const buildInfo = { commit, buildTime };

fs.writeFileSync(
  path.join(__dirname, 'build-info.json'),
  JSON.stringify(buildInfo, null, 2)
);

console.log('Generated build-info.json:', buildInfo);
