// generateCert.js (ESM version)
import selfsigned from 'selfsigned';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const attrs = [{ name: 'commonName', value: 'localhost' }];
const options = { days: 365 };

const pems = selfsigned.generate(attrs, options);

// Ensure certs directory exists
const certDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir);
}

// Write the key and cert
fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);

console.log('✅ Self-signed certificate created in ./certs/');
