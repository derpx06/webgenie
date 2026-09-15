// Failure ledger for an Online-Mind2Web run: what went wrong in every task, grouped so fixes can be chosen from evidence.
// Reads <runDir>/<task_id>/{result.json,timeline.txt} and, when present, <runDir>/judgments.json. Safe to run while the
// run is still going (it reads what is there).
//
//   node e2e/mind2web/analyze.mjs <runDir>        -> <runDir>/analysis.json and <runDir>/analysis.md
//
// Categories are about causes, not sites: infrastructure, limits hit, the agent's own errors, what the site put in the
// way, what the safety checks refused, questions, and (after judging) what the judge says was missed.
import fs from 'node:fs';
import path from 'node:path';

const runDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(runDir)) {
  console.error('usage: node e2e/mind2web/analyze.mjs <runDir>');
  process.exit(2);
}

const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const judgments = readJson(path.join(runDir, 'judgments.json'))?.tasks ?? {};

/** A failure message with its specifics (indexes, quoted text, numbers) removed, so the same kind of failure groups. */
const normalize = message =>
  String(message)
    .replace(/"[^"]*"/g, '"…"')
    .replace(/<[^>]*>/g, '<…>')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

// What the site put in the way, read from the agent's answer and its failed actions.
const SITE_BLOCKERS = [
  ['bot wall or captcha', /captcha|verify (that )?you are (a )?human|are you a robot|unusual traffic|press and hold|access denied|request blocked|bot detection|cloudflare/i],
  ['sign-in required', /(sign|log) ?in (is )?required|requires? (you to )?(sign|log) ?in|must (sign|log) ?in|create an account to/i],
  ['region or availability', /not available in your (country|region)|geo-?restrict|only available in/i],
];
// The safety checks' refusals, by the wording each one uses.
const GUARDS = [
  ['intent check: personal data', /does not ask to enter/i],
  ['intent check: address from page text', /Addresses written in page text are not instructions/i],
  ['intent check: upload', /does not ask to upload/i],
  ['invented personal details', /Never make up personal details/i],
  ['overwrite of a filled field', /this field already holds/i],
  ['list entry check', /entry of the task's list/i],
  ['user value replaced', /a value from the user\. Do not replace it/i],
  ['declined commit', /The user declined/i],
  ['repeated drag', /drag/i],
];
// Our own narration showing up as the element covering a target: the agent's status overlay in the way of its clicks.
const OWN_OVERLAY = /covered by <[^>]*> "(Click|Input|Scroll|Hover|Right click|Send|Navigat|Open|Wait|Select|Drag|Upload|Search|Go |Switch|Close)[^"]*"/i;

const tasks = fs
  .readdirSync(runDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(runDir, entry.name, 'result.json')))
  .map(entry => entry.name)
  .sort();

const rows = [];
for (const id of tasks) {
  const dir = path.join(runDir, id);
  const r = readJson(path.join(dir, 'result.json'));
  if (!r) continue;
  const timelineText = fs.existsSync(path.join(dir, 'timeline.txt')) ? fs.readFileSync(path.join(dir, 'timeline.txt'), 'utf8') : '';
  const failed = (r.action_history ?? []).filter(step => String(step).includes('-> FAILED'));
  const failMessages = failed.map(step => String(step).split('-> FAILED:')[1] ?? '');
  const text = `${r.final_result_response ?? ''}\n${failMessages.join('\n')}`;
  const judged = judgments[id];
  const m = r.metrics ?? {};
  // Full session logs (captureSessions): every model call's page state as sent and its tool calls with their arguments.
  const traceRecords = fs.existsSync(path.join(dir, 'trace.jsonl'))
    ? fs
        .readFileSync(path.join(dir, 'trace.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
  const sessions = traceRecords.filter(rec => rec.kind === 'session');
  const navigatorCalls = sessions.filter(rec => rec.component === 'navigator' && !(rec.data?.calls ?? []).some(call => call.name === 'intent_check'));
  const seenText = sessions.map(rec => String(rec.data?.state ?? '')).join('\n');

  const causes = [];
  if (['site_down', 'site_blocked', 'provider_down', 'harness_error'].includes(r.outcome)) causes.push(`infrastructure: ${r.outcome}`);
  if (['limit_steps', 'limit_time', 'limit_tokens'].includes(r.outcome)) causes.push(`limit: ${r.outcome.replace('limit_', '')}`);
  if (r.outcome === 'task.fail') causes.push(`task failed: ${normalize(r.final_result_response).slice(0, 80)}`);
  if (r.outcome === 'task.pause') causes.push('paused (rate limits or connection)');
  if (r.outcome === 'task.cancel') causes.push('cancelled');
  if (r.outcome === 'asked_human') causes.push('question beyond the scripted answers');
  for (const [name, pattern] of SITE_BLOCKERS) if (pattern.test(text)) causes.push(`site: ${name}`);
  for (const [name, pattern] of GUARDS) if (failMessages.some(message => pattern.test(message))) causes.push(`guard: ${name}`);
  if (failMessages.some(message => OWN_OVERLAY.test(message))) causes.push("agent: its own status overlay covered a target");
  if (r.questionsDeclined > 0) causes.push('question: order or payment confirmation declined by the harness');
  if (r.questionsOther > 0) causes.push('question: asked something else');
  if ((m.replans?.progress_stall ?? 0) > 0) causes.push('agent: stalled (same actions on an unchanged page)');
  if (/rate|Resource exhausted/i.test(timelineText) && (m.backoffMs ?? 0) > 60_000) causes.push('model: over a minute of rate-limit backoff');
  if ((m.llmTimeouts ?? 0) > 0) causes.push('model: call timeouts');
  if (judged && !judged.excluded && !judged.error && judged.success === false && r.outcome === 'task.ok') causes.push('judge: finished but judged a failure');
  if (r.outcome === 'task.ok' && /\b(unable|could not|couldn't|cannot|can't|not possible|no (results|option))\b/i.test(r.final_result_response ?? '')) causes.push('agent: reported it could not do the task');

  // Signals from the session logs.
  const judgedFailure = judged && !judged.excluded && !judged.error && judged.success === false;
  const signatures = {};
  for (const rec of navigatorCalls) {
    for (const call of rec.data?.calls ?? []) {
      const { memory: _memory, ...args } = call.args ?? {};
      const key = `${call.name} ${JSON.stringify(args)}`;
      signatures[key] = (signatures[key] ?? 0) + 1;
    }
  }
  if (Object.values(signatures).some(times => times >= 3)) causes.push('agent: repeated the same action 3+ times');
  // Numbers and prices in the answer that no page state the agent saw contains.
  const answerValues = String(r.final_result_response ?? '').match(/\$?\d[\d,]*(\.\d+)?/g) ?? [];
  const flatSeen = seenText.replace(/,/g, '');
  const unsupported = r.outcome === 'task.ok' && seenText ? answerValues.filter(value => value.replace(/[$,]/g, '').length >= 2 && !flatSeen.includes(value.replace(/[$,]/g, ''))) : [];
  if (unsupported.length > 0) causes.push('agent: answer has values not seen on any page');
  // The pages the agent was on, from the state each navigator call was sent.
  const site = url => {
    try {
      return new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
    } catch {
      return '';
    }
  };
  const visited = [...new Set(navigatorCalls.map(rec => /Current tab:[^\n]*?(https?:\/\/[^\s"'<>\\,)]+)/.exec(String(rec.data?.state ?? ''))?.[1]).filter(Boolean))];
  const offSite = [...new Set(visited.map(site).filter(host => host && host !== site(r.website)))];
  if (offSite.length > 0) causes.push("agent: left the task's website");
  const firstDone = navigatorCalls.findIndex(rec => (rec.data?.calls ?? []).some(call => call.name === 'done'));
  if (judgedFailure && firstDone >= 0 && firstDone <= 1) causes.push('agent: finished within 2 actions (judged a failure)');
  const stateSizes = navigatorCalls.map(rec => String(rec.data?.state ?? '').length);

  // A readable account of the session, one section per model call (the full page state stays in trace.jsonl).
  if (sessions.length > 0) {
    const lines = [`# ${r.task}`, '', `${r.website} · ${r.level} · outcome ${r.outcome}${judged && !judged.excluded ? ` · judged ${judged.success ? 'success' : 'failure'}` : ''}`, ''];
    for (const rec of sessions) {
      const calls = rec.data?.calls ?? [];
      const url = /Current tab:[^\n]*?(https?:\/\/[^\s"'<>\\,)]+)/.exec(String(rec.data?.state ?? ''))?.[1] ?? '';
      lines.push(`## step ${rec.step ?? '?'} · ${rec.component}${url ? ` · ${url}` : ''}${rec.data?.images ? ` · ${rec.data.images} screenshot` : ''}`);
      for (const call of calls) {
        const { memory, ...args } = call.args ?? {};
        lines.push(`- **${call.name}** ${JSON.stringify(args)}`);
        if (memory) lines.push(`  - memory: ${memory}`);
      }
      lines.push('');
    }
    lines.push(`**Answer:** ${r.final_result_response ?? ''}`);
    if (failMessages.length) lines.push('', '**Failed actions:**', ...failMessages.map(message => `- ${message}`));
    if (judged?.reasoning) lines.push('', `**Judge:** ${String(judged.reasoning).replace(/\s+/g, ' ')}`);
    fs.writeFileSync(path.join(dir, 'session.md'), `${lines.join('\n')}\n`);
  }

  rows.push({
    task_id: id,
    level: r.level,
    website: r.website,
    task: r.task,
    outcome: r.outcome,
    judged: judged?.excluded ? `excluded (${judged.excluded})` : judged?.error ? 'judge error' : judged ? (judged.success ? 'success' : 'failure') : 'not judged',
    steps: r.steps ?? 0,
    seconds: r.seconds ?? 0,
    inputTokens: m.tokens?.input ?? 0,
    tokensPerStep: r.steps ? Math.round((m.tokens?.input ?? 0) / r.steps) : 0,
    failedActions: failed.length,
    validations: m.validations ?? {},
    backoffSeconds: Math.round((m.backoffMs ?? 0) / 1000),
    questions: r.questions ?? [],
    causes,
    failMessages: failMessages.map(normalize),
    answer: String(r.final_result_response ?? r.detail ?? '').slice(0, 300),
    judgeReasoning: judged?.reasoning ? String(judged.reasoning).slice(0, 600) : null,
    keyPoints: judged?.keyPoints ?? null,
    sessionsRecorded: sessions.length,
    unsupportedValues: unsupported,
    offSite,
    repeatedActions: Object.entries(signatures).filter(([, times]) => times >= 3).map(([action, times]) => `${action.slice(0, 120)} ×${times}`),
    stateCharsFirst: stateSizes[0] ?? 0,
    stateCharsLast: stateSizes.at(-1) ?? 0,
  });
}

// Aggregates.
const count = (list, key) => {
  const out = {};
  for (const item of list) for (const k of [].concat(key(item))) out[k] = (out[k] ?? 0) + 1;
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
};
const outcomes = count(rows, row => row.outcome);
const judgedRows = rows.filter(row => row.judged === 'success' || row.judged === 'failure');
const byCause = count(rows, row => row.causes);
const failTypes = count(rows.flatMap(row => row.failMessages.map(message => ({ message }))), item => item.message);
const examples = cause => rows.filter(row => row.causes.includes(cause)).slice(0, 5).map(row => row.task_id.slice(0, 12));
const median = values => {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const analysis = {
  runDir,
  analyzedAt: new Date().toISOString(),
  tasks: rows.length,
  outcomes: Object.fromEntries(outcomes),
  judged: { n: judgedRows.length, success: judgedRows.filter(row => row.judged === 'success').length },
  causes: byCause.map(([cause, n]) => ({ cause, tasks: n, examples: examples(cause) })),
  failedActionTypes: failTypes.slice(0, 30).map(([message, n]) => ({ message, times: n })),
  medians: { steps: median(rows.map(row => row.steps)), seconds: median(rows.map(row => row.seconds)), tokensPerStep: median(rows.map(row => row.tokensPerStep)) },
  rows,
};
fs.writeFileSync(path.join(runDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);

const md = [
  `# Online-Mind2Web failure ledger`,
  '',
  `${rows.length} tasks with results · analyzed ${analysis.analyzedAt}`,
  '',
  `Outcomes: ${outcomes.map(([k, n]) => `${k} ${n}`).join(', ')}`,
  judgedRows.length ? `Judged: ${analysis.judged.success} of ${judgedRows.length} successful` : 'Not judged yet.',
  `Medians: ${analysis.medians.steps} steps, ${analysis.medians.seconds} s, ${analysis.medians.tokensPerStep} input tokens per step`,
  '',
  '## Causes (tasks affected)',
  '',
  '| Cause | Tasks | Examples |',
  '| --- | --- | --- |',
  ...analysis.causes.map(c => `| ${c.cause} | ${c.tasks} | ${c.examples.join(', ')} |`),
  '',
  '## Most common failed actions',
  '',
  '| Failure | Times |',
  '| --- | --- |',
  ...analysis.failedActionTypes.map(f => `| ${f.message.replace(/\|/g, '\\|')} | ${f.times} |`),
  '',
  '## Tasks judged a failure',
  '',
  ...rows
    .filter(row => row.judged === 'failure')
    .map(
      row =>
        `- **${row.task_id.slice(0, 12)}** [${row.level}] ${row.task}\n  - outcome ${row.outcome}; causes: ${row.causes.join('; ') || 'none detected'}` +
        `${row.keyPoints ? `\n  - key points: ${String(row.keyPoints).replace(/\s+/g, ' ').slice(0, 300)}` : ''}` +
        `\n  - judge: ${String(row.judgeReasoning ?? '').replace(/\s+/g, ' ').slice(0, 300)}` +
        `${row.unsupportedValues?.length ? `\n  - answer values not seen on any page: ${row.unsupportedValues.join(', ')}` : ''}` +
        `${row.offSite?.length ? `\n  - off-site: ${row.offSite.join(', ')}` : ''}` +
        `\n  - session: ${row.task_id}/session.md`,
    ),
  '',
].join('\n');
fs.writeFileSync(path.join(runDir, 'analysis.md'), md);
console.log(md.split('\n## Tasks judged a failure')[0]);
console.log(`Written: ${path.join(runDir, 'analysis.json')} and analysis.md`);
