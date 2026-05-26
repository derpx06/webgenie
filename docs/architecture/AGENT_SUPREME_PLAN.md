# Agent Supreme Improvement Plan

## Purpose
This document defines a complete, implementation-oriented plan to upgrade the WebGenie agent stack (Planner + Navigator + Executor) for:
- Higher task completion quality
- Faster execution
- Better planning efficiency
- Stronger state management
- More reliable recovery from stalls/failures

The current architecture already has strong foundations. This plan focuses on turning it into a deterministic, quality-gated, production-grade orchestration system.

---

## Current Problems Observed

### 1. Planning is often broad and inefficient
- Planner can generate generic, low-signal steps.
- Research tasks can detour into listicle pages instead of authoritative sources.

### 2. Plan acceptance is too permissive
- Planner output is accepted when structurally valid, even if weak strategically.

### 3. Replanning triggers are still limited
- Cadence-based replanning helps, but nuanced stalls still slip through.

### 4. Completion criteria are too planner-centric
- `done=true` relies heavily on planner judgment instead of evidence checks.

### 5. State and memory are mostly transcript-based
- Long tasks become harder because no strict structured working memory model exists.

### 6. Progress visibility is limited
- We have events and logs, but limited explicit “why this decision” telemetry.

---

## Design Principles For The Upgrade

1. **Quality before execution**
- Never execute weak plans when we can automatically improve them first.

2. **Shortest high-confidence path**
- Prioritize direct, authoritative paths over broad exploratory behavior.

3. **Evidence-driven completion**
- Task completion must be verified by objective signals, not just model intent.

4. **Deterministic safeguards around LLM behavior**
- Keep LLM flexible, but enforce strong code-level constraints.

5. **Measurable improvements**
- Every change should tie to explicit KPI movement.

---

## Target Outcomes (Acceptance Criteria)

- 25-40% reduction in median steps for research-heavy tasks
- Significant reduction in repeated/looping planner outputs
- Higher completion rate for long tasks
- Lower human intervention rate
- Better source quality and recency correctness for "latest" tasks

---

## Implementation Plan

## Phase 1: Planner Output Contract Hardening

### Scope
- File: `chrome-extension/src/background/agent/agents/planner.ts`
- File: `chrome-extension/src/background/agent/prompts/templates/planner.ts`

### Changes
1. Extend planner output schema with stronger structure:
- `strategy_type`
- `primary_sources` (ordered list)
- `stop_conditions`
- `fallback_conditions`
- `confidence` (0-100)

2. Add normalization layer post-parse:
- Deduplicate near-identical steps
- Force 1-3 immediate steps
- Remove low-information verbs ("find info", "look around")

3. Add strict contract checks:
- Reject plans without actionable first step
- Reject contradictory step sequences
- Reject broad listicle-first paths for research tasks unless requested

### Why this improves
- Reduces planner vagueness
- Creates execution-ready plans
- Improves path specificity and speed

---

## Phase 2: Plan Quality Gate Before Navigator

### Scope
- File: `chrome-extension/src/background/agent/executor.ts`
- New file: `chrome-extension/src/background/agent/agents/planner/quality.ts`

### Changes
1. Add plan scoring dimensions:
- Specificity
- Source quality
- Recency awareness
- Redundancy risk
- Directness/shortest-path score

2. Add execution gate:
- If score below threshold, auto-replan with critique context
- Limit retries (`maxPlanRevisions`)
- Fallback to best known valid plan if retries exhausted

3. Emit new events for observability:
- `plan.generated`
- `plan.rejected`
- `plan.revised`
- `plan.accepted`

### Why this improves
- Prevents weak plans from reaching navigator
- Converts "valid JSON" into "high-quality strategy"

---

## Phase 3: Executor State Machine (FSM) Upgrade

### Scope
- File: `chrome-extension/src/background/agent/executor.ts`

### Changes
Replace linear cadence loop with explicit states:
- `PLAN`
- `VALIDATE_PLAN`
- `EXECUTE`
- `EVALUATE_PROGRESS`
- `REPLAN`
- `FINALIZE`

State transitions should be deterministic with hard conditions and per-state budgets.

### Why this improves
- Prevents drift
- Makes recovery and replanning intentional
- Simplifies reasoning/debugging of agent lifecycle

---

## Phase 4: Deep Stall and Progress Intelligence

### Scope
- File: `chrome-extension/src/background/agent/executor.ts`
- File: `chrome-extension/src/background/agent/agents/navigator.ts`

### Changes
1. Upgrade stall detector to multi-signal:
- Repeated model outputs
- Repeated action signatures
- Repeated domains with no new evidence
- No progress in extracted facts/subgoals

2. Add progress delta model:
- `new_facts_count`
- `subgoals_completed`
- `blockers_open`
- `source_diversity`

3. Trigger explicit interventions:
- Soft replan
- Hard source pivot
- Partial summarize (if nearing limits)

### Why this improves
- Faster escape from loops
- Better long-horizon reliability

---

## Phase 5: Navigator Efficiency Policy

### Scope
- File: `chrome-extension/src/background/agent/agents/navigator.ts`
- File: `chrome-extension/src/background/agent/actions/schemas.ts`

### Changes
1. Add anti-pattern execution guards:
- Block redundant scroll ping-pong without explicit reason
- Block repeated search queries unless query refined
- Block repeated same-element interaction without state change

2. Add action chain optimizer:
- Merge compatible actions
- Stop chain when DOM invalidation risk exceeds threshold

3. Improve source-routing constraints for research tasks

### Why this improves
- Less wasted motion
- More actions per meaningful step
- Better wall-clock completion time

---

## Phase 6: Source Quality Engine For Research Tasks

### Scope
- File: `chrome-extension/src/background/agent/prompts/templates/planner.ts`
- File: `chrome-extension/src/background/agent/agents/planner/quality.ts`

### Changes
1. Introduce source tiers:
- Tier A: official docs/vendor posts/releases
- Tier B: major publications
- Tier C: aggregators/forums only if needed

2. Add recency requirements for "latest" tasks:
- Extract publication date
- Prefer newer pages
- Require multi-source confirmation

3. Penalize low-signal list pages in quality scoring

### Why this improves
- More factual and up-to-date outputs
- Better trust and citation quality

---

## Phase 7: Evidence-Based Completion Checker

### Scope
- File: `chrome-extension/src/background/agent/executor.ts`
- File: `chrome-extension/src/background/agent/agents/planner.ts`

### Changes
1. Add completion verifier before final `TASK_OK`:
- Validate user requirements are all answered
- Validate claims map to collected evidence

2. Require completion envelope:
- `final_answer`
- `evidence_summary`
- `source_urls`
- `confidence`

3. If verifier fails, force recovery pass instead of ending

### Why this improves
- Prevents false completion
- Improves answer correctness and accountability

---

## Phase 8: Structured Working Memory

### Scope
- File: `chrome-extension/src/background/agent/messages/service.ts`
- File: `chrome-extension/src/background/agent/types.ts`

### Changes
1. Add working memory object to context:
- Objective
- Subgoals
- Evidence ledger
- Active blockers
- Next commitment

2. Snapshot and compact memory every N steps:
- Keep facts/decisions
- Drop noise
- Preserve unresolved blockers

3. Feed planner with memory snapshot plus recent state

### Why this improves
- Better long-task consistency
- Lower token waste
- Cleaner planner decisions

---

## Phase 9: Telemetry and Debug Surfaces

### Scope
- File: `chrome-extension/src/background/agent/event/types.ts`
- File: `chrome-extension/src/background/core/activity-engine/engine.ts`
- Side-panel consumers

### Changes
1. Add debug-grade fields/events:
- Current FSM state
- Plan quality score
- Replan reason
- Stall reason
- Completion verifier result

2. Expose these in side panel developer view

### Why this improves
- Faster tuning and issue triage
- Better confidence in system behavior

---

## Phase 10: Testing and Rollout Strategy

### Scope
- Unit + integration tests across planner/navigator/executor

### Changes
1. Unit tests:
- Planner schema/validator
- Plan quality gate
- Stall detector
- Completion verifier

2. Integration benchmarks:
- Research task pack
- Form/transaction pack
- Multi-tab comparison pack

3. Controlled rollout flags:
- `strictPlanningMode`
- `qualityGateMode`
- `aggressiveStallRecovery`

### Why this improves
- Safe deployment
- Quantifiable regression protection

---

## KPI and Measurement Framework

Track before/after for each phase:
1. `completion_rate`
2. `median_steps_to_complete`
3. `median_time_to_complete`
4. `replan_count_per_task`
5. `stall_incidents_per_task`
6. `human_intervention_rate`
7. `avg_source_tier_score`

---

## Risks and Mitigations

### Risk 1: Over-constraining planner creativity
Mitigation:
- Keep soft thresholds for first rollout
- Use A/B test against baseline

### Risk 2: Extra latency from quality gates
Mitigation:
- Cap auto-replan attempts
- Use lightweight deterministic checks first

### Risk 3: More complex execution logic
Mitigation:
- Implement FSM incrementally
- Add state-level logs and test fixtures

### Risk 4: False negatives in completion checker
Mitigation:
- Introduce confidence bands
- Allow one recovery pass before fail

---

## Suggested Execution Order

1. Phase 1 (contract hardening)
2. Phase 2 (quality gate)
3. Phase 4 (stall intelligence)
4. Phase 3 (FSM refactor)
5. Phase 7 (completion verifier)
6. Phase 8 (working memory)
7. Phase 5 + 6 (navigator/source optimization)
8. Phase 9 + 10 (telemetry + tests + rollout)

This order gives high impact early while de-risking deeper architecture work.

---

## Definition of Done

The upgrade is considered complete when:
- KPIs show sustained improvement across benchmark tasks
- Planner detours and loops are materially reduced
- Completion answers are evidence-grounded
- Debug telemetry can explain every major replan/finalization decision
- Rollout flags allow safe fallback to baseline behavior

