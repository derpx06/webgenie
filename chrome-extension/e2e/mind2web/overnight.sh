#!/usr/bin/env bash
# Unattended Online-Mind2Web run: all 300 tasks with full session logs, judged as they finish, then a failure ledger.
# Keeps the machine awake, resumes after crashes, outages and expired access tokens, and never rebuilds while it runs.
#
#   chrome-extension/e2e/mind2web/overnight.sh [runDir]      (a new run folder when omitted)
#
# Logs: <runDir>/run.log, judge.log, analyze.log. E2E_HEADLESS defaults to 1 here.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1 # chrome-extension

RUN_DIR="${1:-e2e/results/mind2web-$(date -u +%Y-%m-%dT%H-%M-%SZ)}"
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"

# Hold off sleep and idle suspend for the whole run.
if [ -z "${WEBGENIE_INHIBITED:-}" ] && command -v systemd-inhibit >/dev/null; then
  WEBGENIE_INHIBITED=1 exec systemd-inhibit --what=sleep:idle --who=webgenie --why="Online-Mind2Web run" "$0" "$RUN_DIR"
fi

export E2E_HEADLESS="${E2E_HEADLESS:-1}"
FLAG="$RUN_DIR/.run-finished"
rm -f "$FLAG"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$RUN_DIR/overnight.log"; }

# Tasks without a final result: no result.json yet, or a harness error or provider outage to try again.
remaining() {
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, file] = process.argv.slice(1);
    let left = 0;
    for (const task of JSON.parse(fs.readFileSync(file, "utf8"))) {
      try {
        const result = JSON.parse(fs.readFileSync(path.join(dir, task.task_id, "result.json"), "utf8"));
        if (["harness_error", "provider_down"].includes(result.outcome)) left++;
      } catch {
        left++;
      }
    }
    console.log(left);' "$RUN_DIR" e2e/mind2web/Online_Mind2Web.json
}

wait_for_vertex() {
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://aiplatform.googleapis.com/)" != "000" ] && return 0
    sleep 20
  done
  return 1
}

# Judge finished tasks every 30 minutes; judge.mjs resumes and only judges what is new or errored. After the run ends
# it makes one more pass and stops.
judge_loop() {
  while true; do
    node e2e/mind2web/judge.mjs "$RUN_DIR" --concurrency 6 >>"$RUN_DIR/judge.log" 2>&1
    [ -f "$FLAG" ] && break
    for _ in $(seq 1 30); do
      [ -f "$FLAG" ] && break
      sleep 60
    done
  done
}

log "run folder $RUN_DIR (headless=$E2E_HEADLESS)"
judge_loop &
JUDGE_PID=$!

for pass in 1 2 3 4 5 6; do
  left="$(remaining)"
  log "pass $pass: $left tasks without a final result"
  [ "$left" = "0" ] && break
  wait_for_vertex || { log "Vertex unreachable for 30 minutes; trying the pass anyway"; }
  # Force-stopped browsers leave profiles in /tmp (a small tmpfs); clear them when no benchmark browser is running.
  if [ "$(ps -eo pid=,args= | awk '$2 ~ /chromium$/ && /webgenie-e2e-/' | wc -l)" = "0" ]; then rm -rf /tmp/webgenie-e2e-*; fi
  node e2e/mind2web/run.mjs --all --resume "$RUN_DIR" >>"$RUN_DIR/run.log" 2>&1
  log "pass $pass ended with exit $?"
done

touch "$FLAG"
log "run finished ($(remaining) tasks still without a final result); waiting for the last judge pass"
wait "$JUDGE_PID"
# One more pass picks up judge errors from the last one.
node e2e/mind2web/judge.mjs "$RUN_DIR" --concurrency 6 >>"$RUN_DIR/judge.log" 2>&1
node e2e/mind2web/analyze.mjs "$RUN_DIR" >"$RUN_DIR/analyze.log" 2>&1
log "judged and analyzed: $RUN_DIR/judgments.json, $RUN_DIR/analysis.md"
