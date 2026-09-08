const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'backend/api-server.js');
const current = fs.readFileSync(apiPath);
try {
  fs.writeFileSync(apiPath, execFileSync('git', ['show', 'HEAD:backend/api-server.js'], { cwd: root, maxBuffer: 10 * 1024 * 1024 }));
  const result = spawnSync(process.execPath, [
    'node_modules/jest/bin/jest.js', '--runTestsByPath',
    '__tests__/integration/events/calendarLoad.test.js',
    '__tests__/integration/events/recurringCalendarLoad.test.js',
    '--runInBand', '--silent'
  ], { cwd: path.join(root, 'backend'), stdio: 'inherit' });
  process.exitCode = result.status || 0;
} finally { fs.writeFileSync(apiPath, current); }
