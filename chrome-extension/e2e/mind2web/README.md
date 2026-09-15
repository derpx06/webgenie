# Online-Mind2Web slice

An outside benchmark for WebGenie: a stratified 60-task slice of Online-Mind2Web, run on the live e2e harness and scored
with a WebJudge re-implementation over Vertex AI Gemini.

## Attribution

The tasks come from **Online-Mind2Web** by the OSU NLP Group (<https://huggingface.co/datasets/osunlp/Online-Mind2Web>,
code and judge at <https://github.com/OSU-NLP-Group/Online-Mind2Web>), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Online-Mind2Web is derived from Mind2Web. Changes made
here: 60 of the 300 tasks are selected, and only `task_id`, `website`, `confirmed_task`, `level` and `reference_length`
are kept. `judge.mjs` re-implements the WebJudge prompts from the MIT-licensed repository in Node.

The dataset authors ask that both works be cited:

```bibtex
@inproceedings{xue2025an,
  title     = {An Illusion of Progress? Assessing the Current State of Web Agents},
  author    = {Tianci Xue and Weijian Qi and Tianneng Shi and Chan Hee Song and Boyu Gou and Dawn Song and Huan Sun and Yu Su},
  booktitle = {Second Conference on Language Modeling},
  year      = {2025},
  url       = {https://openreview.net/forum?id=6jZi4HSs6o}
}

@inproceedings{deng2023mind2web,
  author    = {Deng, Xiang and Gu, Yu and Zheng, Boyuan and Chen, Shijie and Stevens, Sam and Wang, Boshi and Sun, Huan and Su, Yu},
  booktitle = {Advances in Neural Information Processing Systems},
  title     = {Mind2Web: Towards a Generalist Agent for the Web},
  volume    = {36},
  pages     = {28091--28114},
  year      = {2023}
}
```

## Getting the data

The dataset file is gated on Hugging Face (accept the terms on the dataset page while logged in; access is granted
automatically). The GitHub repository does not ship the task list with websites and levels. Once access is granted
(commands from the repository root):

```bash
hf download osunlp/Online-Mind2Web Online_Mind2Web.json --repo-type dataset \
  --revision eacad896a84dc5b65e29b0b06e4699ab0544d701 --local-dir chrome-extension/e2e/mind2web
node chrome-extension/e2e/mind2web/make-slice.mjs     # writes slice.json; Online_Mind2Web.json stays gitignored
```

Revision `eacad896…` is the dataset's head as of 2026-07-18; a later revision may have replaced tasks, which changes the
draw. `slice.json` records the input file's sha256.

## How the slice is drawn

`make-slice.mjs`, seed **20260913**: sort all tasks by `task_id`, Fisher-Yates shuffle with a mulberry32 PRNG from the
seed, then walk the shuffled list per level in the order hard (14), easy (17), medium (29), taking a task only if its
website (hostname without `www.`) has not been taken yet. Result: 60 tasks on 60 different websites. Scarcest level
first, so hard tasks get first pick of websites.

## Running

```bash
pnpm build                                                   # the harness loads ./dist
node chrome-extension/e2e/mind2web/run.mjs --limit 3         # a smoke run
node chrome-extension/e2e/mind2web/run.mjs                   # all 60 of the slice
node chrome-extension/e2e/mind2web/run.mjs --all             # all 300 tasks in Online_Mind2Web.json
node chrome-extension/e2e/mind2web/run.mjs --all --resume chrome-extension/e2e/results/mind2web-<timestamp>
node chrome-extension/e2e/mind2web/run.mjs --level hard --only <task_id>,<task_id>
node chrome-extension/e2e/mind2web/run.mjs --self-check      # the question rules and action history, no browser
```

For an unattended run of all 300 tasks, `overnight.sh [runDir]` keeps the machine awake (systemd-inhibit), runs headless
by default, repeats `run.mjs --all --resume` until every task has a final result, judges finished tasks every 30 minutes
(`--concurrency 6`), then writes `analysis.md`. Logs: `<runDir>/run.log`, `judge.log`, `analyze.log`, `overnight.log`.
Every model call is recorded in full (`kind: session` traces: the page state sent and the tool calls with memory and
typed text; registered passwords redacted), because the harness turns on `captureSessions`.

`--resume` reuses a run folder: tasks that already have a result are skipped, except `harness_error` and
`provider_down`, which run again. The summary always covers every selected task with a result in the folder.

The same environment as `../run.mjs` applies (`E2E_MODEL`, `E2E_PLANNER_MODEL`, `E2E_PROJECT`, `E2E_LOCATION`,
`E2E_HEADLESS`, `CHROMIUM_PATH`); the agent's models are called through Vertex AI with your gcloud login.

Rules per task: the start page is the task's `website`; the firewall denies google.com, bing.com, duckduckgo.com and
search.yahoo.com (the benchmark requires starting from the website, not a search engine); an order or payment
confirmation is answered "No, stop here"; any other question is answered "Proceed with any reasonable choice." and
counted; caps are 25 steps, 600 s and 400k input tokens (a model call on a real site reads 7–12k tokens). A start page that fails with a network error or 5xx is
recorded as `site_down` and left out of the score; so is a task that ended because the model provider was
unreachable or the access token expired mid-task, recorded as `provider_down`.

Output, under `chrome-extension/e2e/results/mind2web-<timestamp>/` (gitignored):

- `<task_id>/result.json`: WebJudge v1 input (`task`, `final_result_response`, `action_history`, `screenshots`) plus
  `level`, `outcome`, `steps`, `seconds`, `questions`, `questionsOther`, `questionsDeclined` and the harness `metrics`
  (tokens, calls, cost).
- `<task_id>/trajectory/NN.png`: the newest web tab after navigator actions (act.ok / act.fail), at most 40.
- `<task_id>/events.jsonl`, `trace.jsonl`, `timeline.txt`, and `summary.json` for the run.

## Judging

```bash
node chrome-extension/e2e/mind2web/judge.mjs chrome-extension/e2e/results/mind2web-<timestamp>
node chrome-extension/e2e/mind2web/judge.mjs <runDir> --limit 5 --concurrency 2 --model gemini-2.5-flash
node chrome-extension/e2e/mind2web/judge.mjs <runDir> --dry-run   # payload sizes only, no credentials, no calls
```

Three stages as in WebJudge: key points from the task text; a 1-5 score per screenshot; an outcome call with the key
points, the action history and the screenshots scoring at least `--threshold` (3). Output is `<runDir>/judgments.json`
(per task: `success`, `keyPoints`, `reasoning`, screenshot scores) with a summary: success rate and Wilson 95% interval,
overall and per level. It is written after every task, and a re-run judges only what is missing or errored. The judge
defaults to `gemini-2.5-pro` and falls back to `gemini-2.5-flash` when the model returns 404. 429 and 5xx responses are
retried with backoff. The access token comes from `gcloud auth print-access-token` and is kept in memory only.

**The scores are indicative.** Online-Mind2Web validates WebJudge with o4-mini (about 86% agreement with humans).
A Gemini judge has not been validated against their human labels, so the numbers are not comparable to the leaderboard.
Differences from upstream:

- Screenshots are sent as PNG; upstream re-encodes them as JPEG.
- Gemini's thinking models get no output-token cap; upstream caps each answer at 512 tokens.
- The outcome call drops its lowest-scored screenshots if the request would exceed `--max-request-mb` (18).
- Screenshots are viewport captures taken after actions. They are not full-page, and fast consecutive actions can
  share one capture.
- The action history is WebGenie's own action descriptions, not the element-and-operation strings of the paper's agents.
