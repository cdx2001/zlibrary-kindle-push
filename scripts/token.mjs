import { randomBytes } from 'node:crypto';
console.log(randomBytes(32).toString('hex'));
console.error('Save privately as API_TOKEN. Do not commit or post this value. It is not a Cloudflare account API token.');
