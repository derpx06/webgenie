import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const domFiles = [
  'dom/constants.js',
  'dom/cache.js',
  'dom/helpers.js',
  'dom/interactivity.js',
  'dom/highlighting.js',
  'dom/traversal.js',
  'buildDomTree.js',
];

const publicDir = path.join(__dirname, '../public');
let combined = '';

domFiles.forEach(file => {
  const content = fs.readFileSync(path.join(publicDir, file), 'utf-8');
  combined += content + '\n';
});

fs.writeFileSync(path.join(publicDir, 'dom-agent.min.js'), combined);
console.log('DOM scripts bundled into dom-agent.min.js!');
