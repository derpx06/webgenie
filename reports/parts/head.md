# Trace review — what four benchmark rounds cost and where they went wrong

**Scope.** Every task of four live Online-Mind2Web rounds, read from the traces rather than
from memory: `mind2web-r1-a920989` (300 tasks), `mind2web-r2-base-a920989` and
`mind2web-r2-cand-6347e1c` (the same 60 tasks on the old and new builds), and
`mind2web-r3-3fdf2fa` (300 tasks on the newest build, still running when this was written;
read at 95 results). Sources: `result.json`, `trace.jsonl` (`kind:"llm"` records with
per-call token usage and latency, `kind:"span"` records for page reads, actions and
validation), `timeline.txt`, `events.jsonl`, `session.md` (the exact text sent to the
model), the trajectory screenshots, and the 247 per-task reviews written earlier.

**Method.** Token attribution is a least-squares fit of measured input tokens on the
measured character counts of each prompt block, per role, R² = 0.94, reproducing 100% of
each run's input total; the fit and its scripts are in `reports/parts/scripts/`. Prompt and
schema sizes are counted with `cl100k_base` over the real rendered prompts and the real
emitted tool JSON. Decision grades come from reading timelines step by step over a stated
sample. Estimates are marked as estimates.

**Headline.** The agent is at **55% judged success** on the 60-task gate set, up from 45%.
It pays about **247,000 input tokens per task** for that, of which **49.5% is the element
list** — a block whose characters the model acts on **0.38%** of the time — and **41.2% is
the system prompt and tool schemas re-sent on all 22.8 model calls**. Of the steps it
takes, the reviews judge **57.8% wasted**, and **36.7% of all actions are an exact repeat
of an earlier one**. Two of every nine tasks died at a token cap that was counting the
provider's own cache re-reads at full price. The model is not the main problem.

---

