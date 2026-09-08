import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = resolve('.tmp/history-layout');
await mkdir(output, { recursive: true });
await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import EventAuditHistory from './src/components/EventAuditHistory.jsx';
    import './src/styles/design-tokens.css';
    window.fetch = async () => ({ ok: true, json: async () => ({ auditHistory: [{
      _id: 'layout-fixture', action: 'edit-request-submitted', timestamp: '2026-08-24T15:04:32Z',
      performedByEmail: 'requester@example.com', changes: [], metadata: { proposedChanges: {
        setupTimeMinutes: 120, teardownTimeMinutes: 120,
        reservationStartMinutes: 120, reservationEndMinutes: 120,
        reservationStartTime: '16:00', reservationEndTime: '17:00',
        doorOpenTime: null, doorCloseTime: null, isOnBehalfOf: false,
        contactName: '', contactEmail: ''
      }}
    }] }) });
    createRoot(document.getElementById('root')).render(
      <QueryClientProvider client={new QueryClient()}>
        <EventAuditHistory eventId="layout-fixture" apiToken="local-fixture" />
      </QueryClientProvider>
    );
  `, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, jsx: 'automatic', outfile: resolve(output, 'preview.js'),
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
});
await writeFile(resolve(output, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="preview.css"><style>body { margin: 20px; font-family: Arial, sans-serif; } #root { max-width: 1060px; margin: auto; }</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(resolve(output, 'index.html')).href);
  await page.getByTitle('Show details').click({ timeout: 5000 });
  for (const [width, expectedColumns] of [[1100, 5], [700, 3], [390, 1]]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator('.ah-requested-changes').evaluate(grid => ({
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      overflow: grid.scrollWidth > grid.clientWidth,
      fields: grid.querySelectorAll('dt').length,
    }));
    assert.equal(layout.columns, expectedColumns);
    assert.equal(layout.overflow, false);
    assert.equal(layout.fields, 11);
    await page.screenshot({ path: resolve(output, `history-${width}.png`) });
    console.log(JSON.stringify({ width, ...layout }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
