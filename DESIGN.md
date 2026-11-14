# Deal Space — Agent-Native Origination Workspace (Prototype Spec)

> Build brief for an AI coding agent (Claude Code / Codex). Read the whole file before writing code. Build milestone by milestone; each milestone has acceptance criteria. Use **synthetic data only** — no real client, deal, or firm data.

---

## 1. What we are building

A chat-first workspace where an AI agent assembles a loan deal from incoming signals (calls, emails, documents), and the banker **supervises** instead of typing. The UI looks like a modern AI chat app (chat in the center, a side panel that slides open like an "artifact"), but the side panel is not a chat output — it is the **live, shared state of the deal**.

### Core principle (do not violate)
**The deal is the primary object. Conversations attach to it.**
- Deal state lives in an append-only event store and is projected into the UI.
- A deal has many chat threads (one per activity, plus a deal-level thread).
- The agent works asynchronously (when new signals arrive), not only when a user types.
- Nothing is committed to the downstream ledger without explicit human confirmation.

### What it replaces
Forms. Users never fill fields. The agent extracts facts from sources; users **accept / edit / reject** facts, resolve conflicts, and answer gaps.

### Non-goals (prototype)
- Not a relationship CRM (no contact management, marketing, coverage maps).
- No real Outlook/Graph, Zoom, or ledger integration — all simulated via local adapters with the same interfaces.
- No auth beyond a user switcher (2–3 fake users) to demonstrate multi-user threads and entitlements.

---

## 2. Domain model

### Hierarchy
`Client → Project → Activities → Facts`
- **Client**: borrower/company (e.g., "Acme Logistics").
- **Project**: a tracked deal for that client (e.g., "Project Falcon — $250M Term Loan B refinancing"). A client can have multiple projects.
- **Activity**: a unit of deal work, rendered as a node. Fixed set for the prototype:

| Activity | Output artifact type | Depends on |
|---|---|---|
| KYC | Checklist with evidence | — |
| Deal Setup | Structured card (parties, roles, dates) | KYC |
| Deal Structure | Term card / table (facilities, amounts, pricing, fees, maturity) | Deal Setup |
| Covenants | Table of covenant definitions + thresholds | Deal Structure |
| Credit Memo | Rich document (generated from confirmed facts) | Deal Structure, Covenants |
| Product Setup / Booking | Booking preview (the event payload that would go to the ledger) | Deal Structure, Memo approved |

Each activity has: `status` (not_started | in_progress | blocked | needs_review | complete), `completion %` (= confirmed or proposed required facts / required facts), `autonomy` (draft_only | act_with_approval | autonomous), `blocked_by` (list of activity ids or gap ids).

### Fact (the central object)
```
Fact {
  id, project_id, activity_id,
  key            // e.g. "facility.A.margin_bps"
  label          // "Facility A margin"
  value          // typed: string | number | date | money | percent | enum
  status         // proposed | confirmed | rejected | conflict
  confidence     // 0..1, from extractor
  source_ref     // { source_id, locator: page/para/timestamp/line, snippet }
  source_tier    // 1 executed_doc | 2 term_sheet | 3 email | 4 call_transcript | 5 system
  actor          // agent | user:<id>
  confirmed_by, confirmed_at
  supersedes     // previous fact id (for history/diff)
}
```

### Source precedence (enforced by the merge logic)
1. Executed document → 2. Term sheet / draft agreement → 3. Email → 4. Call transcript → 5. System activity.
- A lower-tier source may **propose** a value or **raise a conflict**, but must never overwrite a fact from a higher tier.
- Same-tier disagreement → `conflict` status, shown to user.
- A user-confirmed fact can only change via a new conflict that the user resolves.

### Gap / Ask
```
Gap { id, project_id, activity_id, fact_key, reason,
      likely_owner: client | coverage | legal | kyc_ops,
      likely_source: "Fee letter", draft_request: {channel: email, to, subject, body},
      status: open | requested | resolved }
```

### Signals (inputs)
```
Signal { id, type: email | transcript | document | system_event,
         received_at, raw_ref, suggested_client_id, suggested_project_id,
         routing_status: pending_confirmation | routed | ignored }
```

### Events (append-only; the source of truth)
Every change is an event: `SignalReceived, SignalRouted, ProjectCandidateCreated, ProjectCreated, FactProposed, FactConfirmed, FactEdited, FactRejected, ConflictRaised, ConflictResolved, GapOpened, GapRequested, GapResolved, ActivityStatusChanged, ArtifactGenerated, BookingSubmitted, MessagePosted`.
UI state is a projection of events. Provide a per-project timeline view built directly from events.

### Threads & messages
- One `deal` thread per project (shared with the deal team) + one thread per activity.
- Thread visibility: `shared` (deal team) or `private` (one user + agent).
- Message kinds: `user`, `agent_reply`, `agent_update` (proactive, triggered by a signal), `receipt` (routing result after an upload), `system`.

---

## 3. Architecture

```
            ┌──────────── Signal adapters (simulated) ────────────┐
 fixtures → │ EmailAdapter(.eml)  TranscriptAdapter(.vtt/.txt)     │
            │ DocumentAdapter(PDF upload)  SystemEventAdapter(json)│
            └──────────────────────────┬──────────────────────────┘
                                       ▼
                         Intake workflow (classify → route → extract)
                                       ▼
                 Fact merge engine (precedence, conflicts, gaps)
                                       ▼
                    Event store (append-only)  ──► Projections
                                       ▼                    ▼
                       Activity workflows          API (REST + SSE)
                    (one per activity, durable)             ▼
                                       ▼              Web UI
                        Ledger adapter (mock: writes booking events to a file/table)
```

### Suggested stack (change only with a stated reason)
- **Backend**: Python 3.12, FastAPI, Pydantic v2.
- **Workflows**: Temporal (local dev server via `temporal server start-dev` or docker compose). One workflow per project intake; one per activity. If Temporal is too heavy for M1, start with an in-process queue behind a `WorkflowRunner` interface and swap in Temporal at M4.
- **Store**: Postgres (docker) with an `events` table (append-only) and projection tables. SQLite acceptable for M1.
- **Extraction**: LLM via provider-agnostic interface `Extractor.extract(source, schema) -> [FactCandidate]` with structured output (JSON schema per activity). PDF → text with PyMuPDF; keep page numbers for locators.
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Live updates via Server-Sent Events.
- **Tests**: pytest for merge engine & projections (pure functions, heavily tested); Playwright for the demo flow + screenshots.

### Key interfaces (keep these stable — real integrations plug in later)
```
SignalAdapter.poll() -> list[Signal]
Router.suggest(signal) -> RoutingSuggestion{client_id?, project_id?, is_new_project, confidence, rationale}
Extractor.extract(source_text, activity_schema) -> list[FactCandidate]
MergeEngine.apply(project_state, candidates, source_tier) -> list[Event]
GapPlanner.plan(project_state) -> list[Gap]
ArtifactGenerator.generate(activity, confirmed_facts) -> Artifact
LedgerAdapter.submit(booking_payload) -> LedgerReceipt
```
`MergeEngine` and `GapPlanner` must be deterministic and LLM-free.

---

## 4. UX specification

### 4.1 Layout (desktop, ≥1440px wide; must remain usable at 1280px)

```
┌────────────┬──────────────────────────────┬─────────────────────────────────┐
│ LEFT RAIL  │        CHAT (center)         │   DEAL PANEL (right, slide-in)  │
│ 264px      │        flex, min 480px       │   45% width, min 560px          │
│            │                              │                                 │
│ ▸ Inbox (7)│ Thread header: Project Falcon│ Header: Project Falcon  [×]     │
│            │  › Deal Structure  [shared ▾]│  Tabs: Overview | Activity |    │
│ Clients    │                              │        Timeline                 │
│ ▾ Acme     │  messages…                   │                                 │
│   • Falcon │  agent_update cards          │  Overview = activity graph +    │
│   • Osprey │  receipt cards               │   gaps + conflicts summary      │
│   + New    │                              │  Activity = artifact for the    │
│ ▸ Beta Co  │                              │   selected activity             │
│ ▸ Gamma    │ ┌──────────────────────────┐ │  Timeline = event log           │
│            │ │ Ask or drop a document 📎│ │                                 │
│ [user ▾]   │ └──────────────────────────┘ │                                 │
└────────────┴──────────────────────────────┴─────────────────────────────────┘
```
- When the panel is closed, chat expands to full width (max content width 760px, centered) — mirrors the "artifact" pattern of modern AI chat apps.
- Panel opens when: user clicks a project/activity, clicks a fact/source chip in chat, or an agent message references a deal object. Panel close = `×` or `Esc`. Panel state is URL-addressable: `/p/{projectId}?panel=activity&a={activityId}`.

### 4.2 Left rail
- **Inbox** (default landing view): cross-project list of items needing the current user: pending routings, conflicts, facts awaiting confirmation, open gaps past N days, approvals. Each row: icon by kind, one-line summary, project chip, age. Clicking opens the relevant thread + panel focused on the item.
- **Clients tree**: client → projects. Project row shows a 16px progress ring (overall completion) and a red dot if there are conflicts. "+ New project" under each client.
- Bottom: user switcher (fake users: `Priya – Banker`, `Arjun – Analyst`, `Meera – KYC Ops`).

### 4.3 Chat (center)
- Thread header: breadcrumb `Project › Activity`, visibility toggle (`Shared with deal team` / `Private`), participants avatars.
- Composer: text input, attach button, drag-and-drop anywhere on the chat area (show a full-area drop overlay "Drop to add to Project Falcon").
- **Message types & visual treatment:**
  - `user`: right-aligned bubble, neutral fill.
  - `agent_reply`: left-aligned, no bubble, plain text, inline **fact chips** (`Margin: S+325 ⓘ`) that open the panel to that fact.
  - `agent_update` (proactive): left-aligned card with a thin accent left border, header `Update · from email "Re: Falcon pricing" · 2m ago`, a 1–3 line summary, and action buttons (`Review changes`, `Dismiss`). These are the key differentiator — make them visually distinct but calm.
  - `receipt` (after upload/routing): compact card: file icon + name, classification (`Term sheet · 92%`), routing (`→ Deal Structure`), counts (`6 facts proposed · 2 conflicts`), button `Review`. If routing confidence < 0.8 or new project suggested, show `Confirm routing` with client/project pickers inline.
  - `system`: small centered grey text.
- Streaming agent text; show "Agent is reading Term_Sheet_v3.pdf (page 4/11)…" progress line for long operations.

### 4.4 Deal panel — Overview tab
1. **Header strip**: project name, client, deal size, target close date, overall completion ring with %, counts: `3 conflicts · 5 gaps · 12 to review`.
2. **Activity graph**: nodes laid out left→right by dependency (DAG), edges as thin lines. Each node:
   - 56px circle with a progress ring (completion %), activity name below, status badge.
   - Ring colors: grey (not started), blue (in progress), amber (needs review), red outline (blocked/conflict), green (complete).
   - Hover: tooltip `Deal Structure — 60% · 4 facts missing · blocked by: Fee letter`.
   - Click: opens the Activity tab for that node **and** switches the chat to that activity's thread.
   - Autonomy shown as a small icon on the node (pencil = draft only, check-shield = act with approval, bolt = autonomous).
3. **What's missing** (gap list): each row = missing fact label, likely owner chip, likely source, and action `Draft request` → expands an editable email draft with `Copy` / `Mark as requested` (no real sending).
4. **Conflicts**: each row opens the conflict resolver (see 4.6).

### 4.5 Deal panel — Activity tab (artifact view)
Renders the activity's artifact type:
- **Structured card / table** (Deal Setup, Deal Structure, Covenants): rows of **fact cards**.
- **Checklist with evidence** (KYC): items with status + evidence source chips.
- **Document** (Credit Memo): rendered rich text generated only from confirmed facts; every number in the memo is a fact chip linked to its fact; unconfirmed inputs render as highlighted placeholders `[margin – unconfirmed]`. Buttons: `Regenerate`, `Approve memo`.
- **Booking preview** (Product Setup): JSON-like readable view of the payload + `Submit to ledger` (disabled until all dependencies complete; requires a confirm dialog listing what will be committed).

**Fact card anatomy** (the replacement for form fields):
```
┌───────────────────────────────────────────────────────────┐
│ Facility A margin                              ● Proposed │
│ SOFR + 325 bps                                            │
│ 📄 Term_Sheet_v3.pdf · p.4      conf 0.91   by Agent      │
│                                   [Accept] [Edit] [Reject]│
└───────────────────────────────────────────────────────────┘
```
- Status dot: grey proposed, green confirmed, red conflict, strike-through rejected.
- Source chip click → source viewer drawer inside the panel (PDF page with highlighted snippet / email with highlighted sentence / transcript with timestamp highlighted).
- Confidence shown as a number; below 0.7 show amber text "Low confidence — check source".
- `Edit` = inline edit; saving creates a user-sourced confirmed fact and records the original.
- Keyboard: `j/k` move between fact cards, `a` accept, `e` edit, `r` reject. Bulk: `Accept all high-confidence (≥0.9)` button at top of the list, with count.
- History: small `2 versions` link → shows previous values with sources and timestamps.

### 4.6 Conflict resolver
Side-by-side comparison inside the panel:
```
Upfront fee
  Term sheet v3 (tier 2) · p.6     1.50%
  Email from client (tier 3)       1.25%   "we agreed 125 on the call"
  [Use 1.50%] [Use 1.25%] [Enter other] [Ask client →]
```
Resolution posts a `ConflictResolved` event and a `system` message in the activity thread.

### 4.7 Timeline tab
Reverse-chronological event list grouped by day, filterable by activity / actor (agent vs user) / event type. "Since you last looked" divider for the current user.

### 4.8 Visual style
- Professional, dense, calm. Think institutional finance tool, not consumer app.
- Neutral greys, white panels, one accent color (deep blue). Status colors used only for status.
- Font: Inter (or system UI). Base 14px; panel tables 13px; numbers in tabular figures.
- 8px spacing grid, 6px radius, 1px borders, minimal shadows (panel only).
- No emoji in product UI (icons from lucide). Light mode only for the prototype.
- Empty states: one line of guidance + primary action (e.g., "No documents yet. Drop a term sheet to start Deal Structure.").

### 4.9 Accessibility & behaviour
- All actions reachable by keyboard; visible focus rings.
- Color is never the only status signal (badge text + icon).
- Optimistic UI for accept/reject with rollback on error.
- Live updates via SSE: when another user confirms a fact, the card updates with a subtle highlight for 2s.

---

## 5. Agent behaviour

1. **On signal**: classify (email / transcript / doc type) → suggest client/project with rationale → if confidence ≥ 0.8 and project exists, route automatically and post a `receipt`; otherwise post a `receipt` with `Confirm routing`.
2. **On transcript**: extract intent signals (e.g., "considering refinancing in Q2") and indicative terms (tier 4). If no matching project, create a `ProjectCandidate` and put it in the Inbox: "New project suggested from call with Acme CFO".
3. **On routed source**: extract facts for the relevant activities via schema; send candidates to MergeEngine; post an `agent_update` summarising changes in the affected activity threads.
4. **On chat question**: answer from confirmed + proposed facts, always citing fact chips; say clearly when a value is unconfirmed or missing.
5. **On chat command** ("set upfront fee to 1.5%", "draft request for the fee letter"): perform as user action, respecting autonomy level.
6. **Never** submit to ledger, send external messages, or confirm facts on its own unless the activity autonomy is `autonomous` (default for all activities in the prototype: `act_with_approval`; KYC: `draft_only`).

---

## 6. Synthetic fixtures (create under `/fixtures`)

- Clients: Acme Logistics, Beta Healthcare, Gamma Energy.
- Project Falcon (Acme, $250M TLB refinancing) — the demo project.
- `call_acme_cfo.vtt` — transcript mentioning refinancing intent, indicative size $250M, margin "around 325 over SOFR", upfront fee "1.25".
- `email_falcon_pricing.eml` — email from client confirming agent bank role and asking about timing.
- `Term_Sheet_v3.pdf` — synthetic term sheet (generate it): borrower, facilities, amount $250M, margin S+325, upfront fee **1.50%** (conflicts with the call), maturity 7 years, leverage covenant 5.0x stepping to 4.5x, agent, governing law.
- `kyc_pack.json` — partial KYC (missing beneficial owner document → gap).
- Seed other projects with varied completion so the rail and inbox look realistic.

---

## 7. Demo script (the acceptance test for the whole prototype)

Target: ≤ 5 minutes, scripted in Playwright with screenshots at each step (`/screenshots/step-N.png`).

1. **Call → candidate project.** Ingest `call_acme_cfo.vtt`. Inbox shows "New project suggested: Acme refinancing". Banker confirms → Project Falcon created; Deal Structure shows tier-4 indicative facts (margin, size, fee 1.25%).
2. **Email → routed.** Ingest the email; routing suggestion auto-attaches it to Falcon; receipt in deal thread; Deal Setup gains agent bank role.
3. **Term sheet upload.** Banker drops the PDF in chat. Receipt: `Term sheet · 6 facts proposed · 1 conflict`. Panel opens on Deal Structure: tier-2 facts supersede tier-4 proposals; upfront fee shows conflict (1.50% vs 1.25%).
4. **Supervise.** Banker uses `Accept all high-confidence`, resolves fee conflict to 1.50% via resolver, opens the gap list, drafts a request for the missing beneficial owner doc.
5. **Memo.** Credit Memo node becomes unblocked; agent posts update "Draft memo ready"; memo shows fact chips; banker approves.
6. **Booking.** Product Setup shows booking preview; banker submits; mock ledger receipt; timeline shows the full event trail from call to booking.

---

## 8. Milestones

**M0 — Skeleton.** Repo layout (`/api`, `/web`, `/fixtures`, `/infra`), docker compose (Postgres, optional Temporal), seed script, empty three-region layout.
*Accept:* `make dev` brings everything up; layout renders at 1440 and 1280 with panel open/closed.

**M1 — Event store & projections.** Events table, projection builder, REST read APIs, SSE stream. Seeded projects visible in rail; Timeline tab works.
*Accept:* replaying events from scratch reproduces identical projections (test).

**M2 — Fact cards & merge engine.** Fact model, precedence rules, conflicts, accept/edit/reject, history, conflict resolver UI.
*Accept:* unit tests cover: lower tier cannot overwrite higher; same-tier disagreement → conflict; user-confirmed fact only changes via resolved conflict.

**M3 — Intake & extraction.** Adapters for transcript/email/PDF, router, extractor with JSON schemas per activity, receipts and agent_update messages, drop-to-upload.
*Accept:* demo steps 1–3 work end to end; every proposed fact has a working source chip that highlights the snippet.

**M4 — Activities, gaps, artifacts.** Activity DAG, completion %, blocked logic, gap planner + draft requests, memo generation from confirmed facts only, booking preview + mock ledger. Move workflows onto Temporal if not already.
*Accept:* demo steps 4–6 work; memo contains no unconfirmed values except highlighted placeholders.

**M5 — Inbox, multi-user, polish.** Inbox aggregation, user switcher, shared vs private threads, keyboard shortcuts, live updates across two browser windows, empty states.
*Accept:* full Playwright demo passes and produces screenshots; visual checklist (section 9) passes.

---

## 9. Visual QA checklist (for screenshot review by a second agent)

- [ ] Three regions visible; chat centered at max 760px when panel closed.
- [ ] Panel slides in from right; chat remains usable alongside it.
- [ ] Activity graph laid out by dependency, not as a vertical list; progress rings readable; blocked nodes visibly distinct.
- [ ] Every fact card shows value, status, source chip, confidence, actor.
- [ ] Conflicts are visible in three places: node outline, Overview conflicts list, fact card status.
- [ ] Agent updates are visually distinct from replies, with actions.
- [ ] Upload receipt shows classification, destination, counts.
- [ ] Memo numbers are chips; unconfirmed values are highlighted placeholders.
- [ ] Status never conveyed by color alone.
- [ ] No layout overflow at 1280px; tables use tabular numbers.
- [ ] Inbox is the default landing view and lists items across projects.

---

## 10. Instructions to the coding agent

- Work milestone by milestone; after each, run tests, take screenshots, and summarise what changed and what's next.
- Keep `MergeEngine`, `GapPlanner`, and projections pure and fully unit-tested — these are the product's correctness core.
- Put all LLM prompts and JSON schemas in `/api/agent/prompts` and `/api/agent/schemas`, versioned.
- Record extraction accuracy on fixtures (`make eval`): per-field precision against a hand-written expected-facts file. Print a table.
- Do not add features outside this spec without listing them as proposals first.
- Prefer boring, readable code over clever abstractions; this is a demo that must not break live.