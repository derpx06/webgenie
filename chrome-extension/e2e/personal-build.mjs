// A copy of ./dist whose manifest grants the browser-data access up front, for the `personal` suite.
//
// The store build asks for bookmarks, history and the rest at the point of use (`chrome.permissions.request`, a native
// prompt that needs a person's click). A script cannot click it, so those tools could never be tested end to end. This
// copy moves the optional permissions into the required ones and nothing else; the tools, the code and the settings gate
// are the shipped ones. Never publish it.
//
//   [SRC=<build to copy>] node e2e/personal-build.mjs [out]      then      E2E_DIST=<out> E2E_SUITE=personal node e2e/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'chrome-extension/e2e/builds/personal'));
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.resolve(process.env.SRC ?? path.join(root, 'dist')), out, { recursive: true });
const file = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.permissions = [...new Set([...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])])];
delete manifest.optional_permissions;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${out}: ${manifest.permissions.length} permissions, none optional`);
