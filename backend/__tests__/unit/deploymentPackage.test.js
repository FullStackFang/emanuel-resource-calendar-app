const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.resolve(__dirname, '../../package-deployment.ps1');
const requiredFiles = ['api-server.js', 'package.json', 'package-lock.json', 'build-info.json', '.deployment'];
let workspace;
let source;
let archive;

function writeFile(relative, contents = 'fixture') {
  const file = path.join(source, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function packageBackend() {
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', script,
    '-SourceDirectory', source, '-DestinationPath', archive,
  ], { encoding: 'utf8', stdio: 'pipe' });
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-package-test-'));
  source = path.join(workspace, 'backend with spaces');
  archive = path.join(workspace, 'backend.zip');
  requiredFiles.forEach(file => writeFile(file));
});

afterEach(() => {
  // mkdtemp supplies an isolated directory under the OS temp directory.
  const resolved = path.resolve(workspace);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('backend-package-test-')) {
    throw new Error('Unexpected fixture cleanup path');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe('backend deployment package', () => {
  it('packages runtime files at the ZIP root and excludes local credentials and dependencies', () => {
    writeFile('services/nested/service.js');
    writeFile('templates/email template.html');
    writeFile('.env', 'secret');
    writeFile('.env.production', 'secret');
    writeFile('.azure/config', 'local CLI defaults');
    writeFile('node_modules/package/index.js');
    writeFile('__tests__/test.js');
    writeFile('logs/server.log');
    writeFile('.tmp/scratch.js');
    writeFile('old-deployment.zip');
    // Existing build output is replaced, not appended to.
    fs.writeFileSync(archive, 'old package');
    expect(packageBackend()).toContain('Packaged');
    const inspectScript = path.join(workspace, 'inspect.ps1');
    fs.writeFileSync(inspectScript, `param([string]$ArchivePath)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
try { ConvertTo-Json -InputObject @($zip.Entries | ForEach-Object { $_.FullName }) }
finally { $zip.Dispose() }
`);
    const entries = JSON.parse(execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', inspectScript, '-ArchivePath', archive,
    ], { encoding: 'utf8' }));
    expect(entries.sort()).toEqual([
      ...requiredFiles, 'services/nested/service.js', 'templates/email template.html',
    ].sort());
  });

  it('fails before creating an archive when a required runtime file is missing', () => {
    fs.unlinkSync(path.join(source, 'api-server.js'));
    expect(packageBackend).toThrow(/Missing required deployment file: api-server.js/);
    expect(fs.existsSync(archive)).toBe(false);
  });
});
