const { execFileSync } = require('child_process');
async function main() {
  const tokenResult = JSON.parse(execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', 'az account get-access-token --resource api://c2187009-796d-4fea-b58c-f83f7a89589e --output json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const base = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api';
  const response = await fetch(`${base}/events/evt-request-1787067397075-uoi48kedt/audit-history`, {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` }, signal: AbortSignal.timeout(20000)
  });
  const body = await response.json();
  console.log(JSON.stringify({ status: response.status, total: body.pagination?.total,
    entries: body.auditHistory?.map(e => ({ action: e.action || e.changeType, timestamp: e.timestamp })), error: body.error }, null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(error => {
  console.error('Live verification could not authenticate or connect. ' + error.name);
  if (error.stderr) console.error(String(error.stderr).replace(/eyJ[A-Za-z0-9_.-]+/g, '[token redacted]'));
  process.exitCode = 1;
});
