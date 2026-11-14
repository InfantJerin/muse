# Implementing "Effort" in a Native Agent Core (OpenClaw-style Architecture)

> Design note. Covers how to add a first-class **effort** dial (`low | medium | high | xhigh | max`) to an agent core modelled on OpenClaw's Gateway → Agent Runtime → Tools/Skills split, running against Claude models (Haiku / Sonnet / Opus) through an enterprise LLM gateway.

---

## 1. First principles

Effort is **not** one mechanism. It is a *compute-allocation policy* that acts at three levels:

| Level | What it controls | Who implements it |
|---|---|---|
| **L1 – Native (in-model)** | Thinking depth, tool-call eagerness and output length *within one call* | The model provider. You only pass the parameter. |
| **L2 – Loop (runtime)** | How many turns, tool calls, files read and retries the agent loop allows | Your agent runtime |
| **L3 – Orchestration (system)** | Model routing, verify/critique passes, best-of-N sampling, sub-agents | Your agent runtime + gateway |

L1 is trained into the model; you **cannot rebuild it**, only switch it on. L2 and L3 are yours to build. A good effort implementation is a single user-facing dial that maps onto all three.

---

## 2. Where effort lives in the OpenClaw architecture

```
Channels (Slack / Web / API)
        │  message (+ optional "/effort high" directive)
        ▼
┌──────────────────────────────────────────────┐
│ GATEWAY (control plane, owns session state)  │
│  • parse directives                          │
│  • resolve EffortLevel  ◄── session override │
│                          ◄── agent default   │
│                          ◄── auto-classifier │
│  • enforce budget caps / quotas per user     │
└───────────────┬──────────────────────────────┘
                │ Turn{ input, session, effort: EffortProfile }
                ▼
┌──────────────────────────────────────────────┐
│ AGENT RUNTIME (the loop)                     │
│  • ProviderAdapter: effort → API params (L1) │
│  • LoopController: budgets & stop rules (L2) │
│  • Orchestrator: route/verify/best-of-N (L3) │
└───────────────┬──────────────────────────────┘
                ▼
       Tools / Skills / Sub-agents
                ▼
     Enterprise LLM gateway → Claude API
```

Rules:
- The **Gateway resolves** effort (it owns sessions and policy). The **Runtime executes** it. Tools never see effort directly; they see budgets.
- Effort is stored on the session (like OpenClaw's per-session thinking level) and can be overridden per turn.

---

## 3. The core abstraction: `EffortProfile`

A level is just a name. A **profile** is the concrete bundle of knobs. Keep profiles in config (hot-reloadable), not in code.

```ts
type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

interface EffortProfile {
  level: EffortLevel;

  // L1 — native, passed straight to the provider
  model: string;                 // e.g. haiku / sonnet / opus id
  nativeEffort?: EffortLevel;    // provider effort param, if supported
  thinkingBudgetTokens?: number; // 0 = thinking off
  maxOutputTokens: number;

  // L2 — loop budgets
  maxTurns: number;              // model↔tool round-trips
  maxToolCalls: number;
  maxContextReads: number;       // files/docs/pages fetched
  maxWallClockMs: number;
  maxCostUsd: number;

  // L3 — orchestration
  planFirst: boolean;            // explicit plan step before acting
  verify: "none" | "self" | "independent"; // critique pass
  samples: number;               // best-of-N (1 = off)
  judge?: "llm" | "deterministic";
  allowSubAgents: boolean;
  escalateOnFailure: boolean;    // bump one level if verify fails
}
```

Example config (`effort-profiles.json5`):

```json5
{
  low:    { model: "haiku",  thinkingBudgetTokens: 0,     maxTurns: 4,  maxToolCalls: 6,
            verify: "none", samples: 1, planFirst: false },
  medium: { model: "sonnet", nativeEffort: "medium", thinkingBudgetTokens: 4000,
            maxTurns: 12, maxToolCalls: 25, verify: "self", samples: 1, planFirst: false },
  high:   { model: "opus",   nativeEffort: "high",   thinkingBudgetTokens: 16000,
            maxTurns: 30, maxToolCalls: 80, verify: "self", samples: 1, planFirst: true },
  xhigh:  { model: "opus",   nativeEffort: "high",   thinkingBudgetTokens: 32000,
            maxTurns: 60, maxToolCalls: 150, verify: "independent", samples: 1,
            planFirst: true, allowSubAgents: true },
  max:    { model: "opus",   nativeEffort: "max",    thinkingBudgetTokens: 64000,
            maxTurns: 100, maxToolCalls: 300, verify: "independent", samples: 3,
            judge: "llm", planFirst: true, allowSubAgents: true }
}
```

---

## 4. Gateway: resolving effort

Precedence, highest first:

1. **Turn directive**: `/effort high` in the message, or an API field.
2. **Session override**: set earlier in the session and persisted in session state.
3. **Agent default**: per-agent config (an extraction agent may default to `high`).
4. **Auto-classifier**: optional. A cheap Haiku call (or heuristics) scores task difficulty.
5. **Global default**: `medium`.

Then apply **caps**: the user's or tenant's maximum allowed level, the remaining daily budget, and the gateway rate limits.

```ts
function resolveEffort(turn, session, agentCfg, policy): EffortProfile {
  const requested =
    turn.directive?.effort ??
    session.overrides.effort ??
    agentCfg.defaultEffort ??
    (policy.autoClassify ? classifyDifficulty(turn.input) : "medium");

  const capped = minLevel(requested, policy.maxLevelFor(session.user));
  return profiles[capped];
}
```

Auto-classifier signals (cheap first):
- Task type, e.g. Q&A vs. extraction vs. code change.
- Input size, such as the number of attached documents and pages.
- Whether a previous attempt in this session failed verification.
- If unsure, use a Haiku call that returns `{level, reason}`.

---

## 5. Runtime, L1: the ProviderAdapter

This is the only place that knows provider-specific parameter names.

```ts
interface ProviderAdapter {
  buildRequest(msgs, tools, p: EffortProfile): ProviderRequest;
  supports: { nativeEffort: boolean; thinking: boolean };
}

class ClaudeAdapter implements ProviderAdapter {
  buildRequest(msgs, tools, p) {
    const req: any = { model: p.model, messages: msgs, tools, max_tokens: p.maxOutputTokens };
    if (this.supports.thinking && p.thinkingBudgetTokens)
      req.thinking = { type: "enabled", budget_tokens: p.thinkingBudgetTokens };
    if (this.supports.nativeEffort && p.nativeEffort)
      req.output_config = { effort: p.nativeEffort }; // verify exact field + beta header for your model version
    return req;
  }
}
```

**Enterprise gateway checklist** (when calls go through an internal LLM gateway):
- [ ] Does the gateway forward `thinking`, the effort field and beta headers, or does it strip unknown fields?
- [ ] **Test:** send the same hard prompt at low and at max, then compare `usage` (thinking/output tokens). Identical numbers mean the parameter is being dropped.
- [ ] Is the underlying route Anthropic API, Bedrock or Vertex? Field names and support differ.
- [ ] Detect capabilities at startup and set `supports.*`. If native effort is unavailable, **degrade gracefully** to the thinking budget plus L2/L3 only.

---

## 6. Runtime, L2: the LoopController

Wrap the standard agent loop (assemble context → call LLM → run tools → repeat) with a budget meter.

```ts
class LoopController {
  constructor(private p: EffortProfile) {}
  used = { turns: 0, toolCalls: 0, reads: 0, costUsd: 0, startMs: Date.now() };

  canContinue(): StopReason | null {
    if (this.used.turns      >= this.p.maxTurns)      return "turn_budget";
    if (this.used.toolCalls  >= this.p.maxToolCalls)  return "tool_budget";
    if (this.used.costUsd    >= this.p.maxCostUsd)    return "cost_budget";
    if (Date.now() - this.used.startMs >= this.p.maxWallClockMs) return "time_budget";
    return null;
  }
}
```

Behaviour on hitting a budget:
- **Don't hard-kill.** Inject a system note: *"Budget reached. Summarise what you've done, what's unverified and what's left."* Then make one final call with no tools.
- **Surface the budget to the model** in the system prompt, e.g. "You have ~N tool calls; prioritise." Models plan better when they know the budget.
- Log the `StopReason` and feed it to the eval (section 9).

---

## 7. Runtime, L3: the Orchestrator

Composable strategies, switched on by the profile:

| Strategy | Profile flag | What it does | Best for |
|---|---|---|---|
| **Routing** | `model` | Haiku / Sonnet / Opus by level | Everything |
| **Plan-first** | `planFirst` | One call writes a plan; the loop executes it step by step | Multi-step tasks |
| **Self-verify** | `verify: "self"` | The same agent re-reads its output against the source and fixes issues | Extraction, code |
| **Independent verify** | `verify: "independent"` | A fresh-context agent (no access to the first agent's reasoning) checks the output | High-stakes output |
| **Best-of-N** | `samples > 1` | N parallel runs; a judge picks or merges the best | Verifiable output |
| **Sub-agents** | `allowSubAgents` | Fan out per section or per covenant family, then merge | Large documents |
| **Escalation** | `escalateOnFailure` | If verification fails, rerun at the next level up | Cost-efficient default |

```ts
async function runTurn(turn, p: EffortProfile) {
  const plan   = p.planFirst ? await makePlan(turn, p) : null;
  const runs   = await Promise.all(range(p.samples).map(() => agentLoop(turn, plan, p)));
  let result   = p.samples > 1 ? await judge(runs, p.judge) : runs[0];

  if (p.verify !== "none") {
    const v = await verify(result, turn.sources, p.verify);
    if (!v.ok && p.escalateOnFailure && nextLevel(p.level))
      return runTurn(turn, profiles[nextLevel(p.level)]);  // bounded by caps
    if (!v.ok) result = await revise(result, v.issues, p);
  }
  return result;
}
```

**Preferring escalation over a static `high` level** is usually the best cost/quality trade-off. Start at medium and pay for high only when verification says it's needed.

---

## 8. Session and UX

- Commands: `/effort <level>` (session), `/effort` (show current), plus a per-turn API field.
- Stream progress lines such as plan, step i/N and verifying, so higher effort doesn't feel like a hang.
- At the end of a turn, report: level used, model, tokens, cost, stop reason, and whether it escalated.
- Persist the effort level in the session transcript metadata (OpenClaw keeps per-session config overrides alongside the JSONL transcript).

---

## 9. Telemetry and eval: tuning the profiles

Profiles are hypotheses, so tune them with data.

Log on every turn:
```
session_id, agent_id, task_type, effort_requested, effort_resolved, escalated,
model, thinking_tokens, output_tokens, tool_calls, turns, cost_usd, latency_ms,
stop_reason, verify_result
```

Eval loop (connects to the hill-climbing setup):
1. Build a fixed eval set per task type, e.g. golden credit agreements, and a separate **held-out** set.
2. Score each level: precision, recall and F1 (or a rubric score) against cost and latency.
3. Plot the **cost–quality curve** per task type. Each level should sit on the curve's frontier. If `xhigh` doesn't beat `high` by more than the run-to-run noise, merge the two.
4. Use the data to calibrate the auto-classifier: which task features predict that a higher level helps?
5. Gate profile changes in CI: a change must not regress F1 on held-out data and must stay within the cost ceiling.

---

## 10. Rollout plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Capability probe against the LLM gateway (native effort / thinking pass-through) | Token usage differs between low and max |
| 1 | `EffortProfile` config + ProviderAdapter (L1) + manual `/effort` | Levels selectable; telemetry logged |
| 2 | LoopController budgets (L2) with graceful wrap-up | No runaway loops; stop reasons logged |
| 3 | Orchestrator: routing + self-verify + escalation (L3) | Measured F1 gain at medium/high on eval set |
| 4 | Independent verify, best-of-N, sub-agents for xhigh/max | Gains exceed noise on held-out data |
| 5 | Auto-classifier + per-user caps | Average cost down at equal quality |

---

## 11. Pitfalls

- **Effort ≠ quality.** On easy tasks, higher effort adds cost and sometimes causes over-thinking. Measure it per task type.
- **Silent parameter drops** by the enterprise gateway make the levels a placebo. Probe at startup.
- **Optimizer exploitation:** tuning profiles against a tiny golden set overfits. Keep a held-out set.
- **Unbounded escalation:** cap escalations per turn (e.g. at most 1) and respect the cost cap.
- **Verifier sharing context with the generator** produces self-confirmation. "Independent" must mean a fresh context.
- **Version drift:** provider effort field names and supported levels change between model versions. Keep them inside the adapter.

---

## Appendix: mapping to other providers

| Provider | L1 native knob | Adapter note |
|---|---|---|
| Claude | effort param + extended thinking budget | Effort covers thinking, tools and output |
| OpenAI | `reasoning_effort` | Mainly reasoning tokens |
| Gemini | `thinking_budget` / `thinking_level` | Caps the thinking phase |

L2 and L3 are provider-agnostic. That's the main reason to keep them in your own runtime.
