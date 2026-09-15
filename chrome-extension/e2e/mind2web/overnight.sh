#!/usr/bin/env bash
# Unattended Online-Mind2Web run: all 300 tasks with full session logs, split over parallel workers, judged as they
# finish, then a failure ledger. Keeps the machine awake, resumes after crashes, outages and expired access tokens, runs
# again every task the model provider held back, and never rebuilds while it runs.
#
#   WORKERS=5 chrome-extension/e2e/mind2web/overnight.sh [runDir]      (a new run folder when omitted)
#
# Each worker is its own run.mjs process (--shard i/WORKERS) with its own Chromium, temporary profile and virtual
# display, so workers share nothing but the run folder, where each task has its own directory.
# Logs in <runDir>: overnight.log (supervisor), run-<i>.log (worker i), status.log (every 5 minutes), attempts.jsonl
# (one line per task attempt), judge.log, analyze.log.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1 # chrome-extension

RUN_DIR="${1:-e2e/results/mind2web-$(date -u +%Y-%m-%dT%H-%M-%SZ)}"
WORKERS="${WORKERS:-5}"
PASSES="${PASSES:-12}"
# One Vertex location per worker, in turn. The global endpoint answered 429 to 6 of 6 small test calls while five
# workers used it (620 of 1015 calls rate-limited); regional endpoints answered 3-4 of 4.
LOCATIONS="${LOCATIONS:-europe-west1 europe-north1 us-east1 us-west1 us-south1}"
read -r -a LOCATION_LIST <<<"$LOCATIONS"
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"

# Hold off sleep and idle suspend for the whole run.
if [ -z "${WEBGENIE_INHIBITED:-}" ] && command -v systemd-inhibit >/dev/null; then
  WEBGENIE_INHIBITED=1 WORKERS="$WORKERS" PASSES="$PASSES" LOCATIONS="$LOCATIONS" exec systemd-inhibit --what=sleep:idle --who=webgenie --why="Online-Mind2Web run" "$0" "$RUN_DIR"
fi

# No windows on the screen: a normal, headed Chromium on a virtual display (Xvfb) when available. Real headless
# Chromium is refused by many sites' bot checks (smoke run: "access denied" on a store site, a Cloudflare check on another).
if [ -z "${E2E_HEADLESS:-}" ] && command -v xvfb-run >/dev/null; then
  RUNNER=(env -u WAYLAND_DISPLAY xvfb-run -a -s "-screen 0 1920x1080x24")
else
  export E2E_HEADLESS="${E2E_HEADLESS:-1}"
  RUNNER=()
fi
FLAG="$RUN_DIR/.run-finished"
rm -f "$FLAG"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$RUN_DIR/overnight.log"; }

# Tasks of shard i/n without a final result: no result.json yet, or a harness error or provider outage to run again.
remaining() {
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, file, index, count] = process.argv.slice(1);
    let left = 0;
    JSON.parse(fs.readFileSync(file, "utf8")).forEach((task, n) => {
      if (n % Number(count) !== Number(index)) return;
      try {
        const result = JSON.parse(fs.readFileSync(path.join(dir, task.task_id, "result.json"), "utf8"));
        if (["harness_error", "provider_down"].includes(result.outcome)) left++;
      } catch {
        left++;
      }
    });
    console.log(left);' "$RUN_DIR" e2e/mind2web/Online_Mind2Web.json "$1" "$2"
}

wait_for_vertex() {
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://aiplatform.googleapis.com/)" != "000" ] && return 0
    sleep 20
  done
  return 1
}

# Judge finished tasks every 30 minutes; judge.mjs resumes and only judges what is new or errored.
judge_loop() {
  while true; do
    node e2e/mind2web/judge.mjs "$RUN_DIR" --concurrency 4 >>"$RUN_DIR/judge.log" 2>&1
    [ -f "$FLAG" ] && break
    for _ in $(seq 1 30); do
      [ -f "$FLAG" ] && break
      sleep 60
    done
  done
}

status_loop() {
  until [ -f "$FLAG" ]; do
    node e2e/mind2web/status.mjs "$RUN_DIR" >>"$RUN_DIR/status.log" 2>&1
    echo >>"$RUN_DIR/status.log"
    for _ in $(seq 1 30); do
      [ -f "$FLAG" ] && break
      sleep 10
    done
  done
}

worker() {
  local i="$1" left
  local location="${LOCATION_LIST[$((i % ${#LOCATION_LIST[@]}))]}"
  for pass in $(seq 1 "$PASSES"); do
    left="$(remaining "$i" "$WORKERS")"
    log "worker $i ($location) pass $pass: $left tasks without a final result"
    [ "$left" = "0" ] && return 0
    # Tasks the provider held back: give its quota a few minutes before trying them again.
    [ "$pass" -gt 1 ] && sleep 180
    wait_for_vertex || log "worker $i: Vertex unreachable for 30 minutes; trying the pass anyway"
    E2E_LOCATION="$location" "${RUNNER[@]}" node e2e/mind2web/run.mjs --all --resume "$RUN_DIR" --shard "$i/$WORKERS" >>"$RUN_DIR/run-$i.log" 2>&1
    log "worker $i pass $pass ended with exit $?"
  done
  log "worker $i: $(remaining "$i" "$WORKERS") tasks still without a final result after $PASSES passes"
}

if [ -n "${E2E_HEADLESS:-}" ]; then browser=headless; else browser="headed on virtual displays"; fi
log "run folder $RUN_DIR ($WORKERS workers, browser: $browser)"
# Force-stopped browsers leave profiles in /tmp (a small tmpfs); clear them once, before any worker starts one.
if [ "$(ps -eo pid=,args= | awk '$2 ~ /chromium$/ && /webgenie-e2e-/' | wc -l)" = "0" ]; then rm -rf /tmp/webgenie-e2e-*; fi

judge_loop &
JUDGE_PID=$!
status_loop &
STATUS_PID=$!

WORKER_PIDS=()
for i in $(seq 0 $((WORKERS - 1))); do
  worker "$i" &
  WORKER_PIDS+=($!)
  sleep 20 # xvfb-run -a picks a free display by looking for lock files; starting all at once can pick the same one
done
wait "${WORKER_PIDS[@]}"

touch "$FLAG"
log "all workers finished; waiting for the last judge pass"
wait "$JUDGE_PID" "$STATUS_PID"
# One more pass picks up judge errors from the last one.
node e2e/mind2web/judge.mjs "$RUN_DIR" --concurrency 4 >>"$RUN_DIR/judge.log" 2>&1
node e2e/mind2web/analyze.mjs "$RUN_DIR" >"$RUN_DIR/analyze.log" 2>&1
node e2e/mind2web/status.mjs "$RUN_DIR" | tee -a "$RUN_DIR/status.log" >>"$RUN_DIR/overnight.log"
log "judged and analyzed: $RUN_DIR/judgments.json, $RUN_DIR/analysis.md"
