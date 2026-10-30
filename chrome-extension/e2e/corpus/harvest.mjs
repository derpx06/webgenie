// Harvests, from saved runs, the tool-call arguments real models actually produced — and the ones
// that were rejected. Run by hand when a new run lands:
//
//   node e2e/corpus/harvest.mjs            # all of e2e/results
//   node e2e/corpus/harvest.mjs mind2web-r4-2953c78
//
// Writes e2e/corpus/tool-calls.json, which actions/__tests__/tool-corpus.test.ts gates on. Every
// argument in tools.test.ts was written by a human, which is why 11 malformed `extract` schemas
// reached production and killed runs: nobody imagined a CSS selector carrying \' inside a JSON
// string. The models imagined it 136 times.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', 'results');
const OUT = path.join(import.meta.dirname, 'tool-calls.json');
const only = process.argv[2];

/** One case per (tool, argument key set, coarse value shape): ~900k records collapse to a few hundred. */
const fingerprint = (name, args) => {
  const keys = Object.keys(args ?? {}).sort();
  const shape = keys.map(key => {
    const value = args[key];
    if (typeof value === 'string') return `${key}:s${value.length > 60 ? 'long' : 'short'}`;
    if (Array.isArray(value)) return `${key}:a${value.length ? typeof value[0] : 'empty'}`;
    return `${key}:${value === null ? 'null' : typeof value}`;
  });
  return createHash('sha1').update(`${name}|${shape.join(',')}`).digest('hex').slice(0, 12);
};

const walk = dir => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'trace.jsonl' || entry.name.endsWith('.trace.jsonl')) out.push(full);
  }
  return out;
};

const shapes = new Map();
/** Schema strings the model sent to `extract` that JSON.parse refused. These killed whole runs. */
const malformed = new Map();
const files = walk(ROOT).filter(file => !only || file.includes(only));
let records = 0;
let planRefusals = 0;

for (const file of files) {
  const run = path.relative(ROOT, file).split(path.sep)[0];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    records++;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a run killed mid-write leaves one torn line
    }

    const refused = record.msg === 'tool call validation failed';
    // "not allowed by the current plan" is a policy refusal of a well-formed call, not a contract
    // failure. Counting it as one would pin thousands of valid shapes as broken.
    const issues = JSON.stringify(record.data?.issues ?? '');
    const schemaRefused = refused && /invalid arguments|unknown tool|not valid JSON/i.test(issues);
    if (refused && !schemaRefused) planRefusals++;
    if (!refused && record.kind !== 'session') continue;

    for (const call of record.data?.calls ?? []) {
      if (!call?.name) continue;
      const args = call.args ?? {};
      const key = fingerprint(call.name, args);
      const row = shapes.get(key);
      if (!row) shapes.set(key, { key, name: call.name, args, refused: schemaRefused, run, seen: 1 });
      else {
        row.seen++;
        if (schemaRefused) Object.assign(row, { refused: true, args, run });
      }
      if (call.name === 'extract' && typeof args.schema === 'string') {
        try {
          JSON.parse(args.schema);
        } catch (error) {
          const existing = malformed.get(args.schema);
          if (existing) existing.seen++;
          else malformed.set(args.schema, { schema: args.schema, reason: String(error.message), run, seen: 1 });
        }
      }
    }
  }
}

const rows = [...shapes.values()].sort((a, b) => a.name.localeCompare(b.name) || b.seen - a.seen);
const bad = [...malformed.values()].sort((a, b) => b.seen - a.seen);
fs.writeFileSync(OUT, `${JSON.stringify({ calls: rows, malformedExtractSchemas: bad }, null, 1)}\n`);

console.log(`${files.length} trace files, ${records} records`);
console.log(`${rows.length} distinct call shapes (${rows.filter(r => r.refused).length} schema-refused, ${planRefusals} plan refusals ignored)`);
console.log(`${bad.length} malformed extract schemas, ${bad.reduce((n, r) => n + r.seen, 0)} occurrences`);
console.log(`-> ${path.relative(process.cwd(), OUT)}`);
