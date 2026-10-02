// Writes the client viewer HTML into the editor as a base64 module.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('src/generated', { recursive: true });
const b64 = readFileSync('dist-client/client.html').toString('base64');
writeFileSync('src/generated/client-template.ts', `export default '${b64}';\n`);
