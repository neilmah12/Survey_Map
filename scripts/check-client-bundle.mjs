// Fails the build if the client viewer contains editor, Excel, storage or sign-in code.
// Usage: node scripts/check-client-bundle.mjs [file-or-folder]
// A single HTML file (the exported client file) is checked as before; a folder (the Hosting build) has every
// .html, .js and .css file in it checked.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2] ?? 'dist-client/client.html';

function collect(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((n) => collect(join(path, n)));
}

const isFolder = statSync(target).isDirectory();
const files = collect(target).filter((f) => /\.(html|js|mjs|css)$/.test(f));
if (files.length === 0) {
  console.error(`No files to check in ${target}`);
  process.exit(1);
}
const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const forbidden = [
  'Update from Excel', 'Export Excel', 'Add building', 'Start over', 'Mark as subject', 'Save file', 'Export client file',
  'survey-map:draft', 'localStorage', 'exceljs', 'JSZip', 'xmldom',
  // sign-in, saved surveys and publishing belong to the editor only
  'signInWithPopup', 'GoogleAuthProvider', 'allowedUsers', 'identitytoolkit', 'Unpublish', 'Saved surveys',
];
const found = forbidden.filter((s) => text.includes(s));
if (found.length) {
  console.error(`Client bundle contains editor code: ${found.join(', ')}`);
  process.exit(1);
}
if (!isFolder && !text.includes('__SNAPSHOT_JSON__')) {
  console.error('Client bundle lost its snapshot slot');
  process.exit(1);
}
console.log(`client bundle ok (${files.length} file${files.length === 1 ? '' : 's'}, ${(text.length / 1e6).toFixed(2)} MB, no editor code)`);
