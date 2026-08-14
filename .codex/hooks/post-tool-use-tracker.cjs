#!/usr/bin/env node
'use strict';

/**
 * Post-Tool-Use Tracker
 *
 * Categorizes each edited file into an area (frontend, backend, tests, root)
 * and logs it to a session-scoped cache directory. This enables downstream
 * hooks and agents to know which areas of the codebase were touched.
 *
 * Cache location: .claude/.cache/<session_id>/
 *   - edited-files.log   : timestamp|area|file_path (append-only)
 *   - affected-areas.txt : deduplicated list of areas touched
 */

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input || {};

    // Extract file path from Edit or Write tool input
    const filePath = toolInput.file_path
      || (toolInput.edits && toolInput.edits[0] && toolInput.edits[0].file_path)
      || '';

    if (!filePath) process.exit(0);

    // Skip non-code files
    const ext = path.extname(filePath);
    if (['.md', '.log', '.txt', '.lock'].includes(ext)) process.exit(0);

    // Categorize by area
    let area = 'root';
    if (filePath.includes('/backend/') || filePath.includes('\\backend\\')) {
      area = filePath.includes('__tests__') || filePath.includes('.test.') ? 'backend-tests' : 'backend';
    } else if (filePath.includes('/src/') || filePath.includes('\\src\\')) {
      area = filePath.includes('__tests__') || filePath.includes('.test.') ? 'frontend-tests' : 'frontend';
    }

    // Create session cache directory
    const sessionId = data.session_id || 'unknown';
    const cacheDir = path.join(__dirname, '..', '.cache', sessionId);
    fs.mkdirSync(cacheDir, { recursive: true });

    // Append to edit log
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp}|${area}|${filePath}\n`;
    fs.appendFileSync(path.join(cacheDir, 'edited-files.log'), logLine);

    // Update deduplicated areas list
    const areasFile = path.join(cacheDir, 'affected-areas.txt');
    const existingAreas = fs.existsSync(areasFile)
      ? new Set(fs.readFileSync(areasFile, 'utf8').split('\n').filter(Boolean))
      : new Set();
    existingAreas.add(area);
    fs.writeFileSync(areasFile, [...existingAreas].sort().join('\n') + '\n');

  } catch (e) {
    // Silent failure - hooks must never break the workflow
    process.exit(0);
  }
});
