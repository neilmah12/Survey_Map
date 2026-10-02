// Fails the build if the client viewer contains editor, Excel or storage code.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dist-client/client.html';
const html = readFileSync(file, 'utf8');
const forbidden = [
  'Update from Excel', 'Export Excel', 'Add building', 'Start over', 'Mark as subject', 'Save file', 'Export client file',
  'survey-map:draft', 'localStorage', 'exceljs', 'JSZip', 'xmldom',
];
const found = forbidden.filter((s) => html.includes(s));
if (found.length) {
  console.error(`Client bundle contains editor code: ${found.join(', ')}`);
  process.exit(1);
}
if (!html.includes('__SNAPSHOT_JSON__')) {
  console.error('Client bundle lost its snapshot slot');
  process.exit(1);
}
console.log(`client bundle ok (${(html.length / 1e6).toFixed(2)} MB, no editor code)`);
