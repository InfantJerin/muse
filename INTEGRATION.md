# Connecting the agent service

The prototype is a UX shell with one seam. Everything agentic crosses it as protocol messages; the scripted demo agent sits on the far side today, and the agent-as-a-service session replaces it.

```
 UI (app.js) ──commands──▶ transport ──▶ agent session (Temporal, tools)
      ▲                                        │
      └────────────── events ◀─────────────────┘
```

## The seam

| File | Role |
|---|---|
| `src/agent/protocol.js` | Message types, the view-spec shape and its validator. The contract. |
| `src/agent/transport.js` | `send(command)` / `onEvent(handler)`. Mock by default; HTTP + SSE with `?agent=<base url>`. |
| `src/agent/mock-agent.js` | Scripted stand-in. Delete or keep for demos; nothing else imports its internals. |
| `onAgentEvent` in `src/app.js` | The single place agent output enters the app. |

To integrate, implement the events below in the agent service and open the page with `?agent=https://your-service`. `createHttpTransport` posts commands to `/deals/{dealId}/commands` and reads events from `/deals/{dealId}/events` (server-sent events). Those two paths are a proposal and have not been run against a real service; adapt that one function to your API.

## UI → agent

| Command | Payload | When |
|---|---|---|
| `session.open` | `dealId, userId` | Page load, and when the viewer changes |
| `message.send` | `threadId, messageId, userId, userName, text, objectRef?` | A message with “Agent replies” on |
| `action.request` | `action, threadId, userId, args` | The user asks the agent for work. Today: `memo.refresh` |
| `ui.action` | `action, userId, targetId, result` | The user decided something in the UI. Today: `proposal.accepted`, `proposal.rejected` |

`threadId` is an activity id (`structure`, `memo`, `credit`, `product`, `agreement`, `closing`, `servicing`, …) or `overview` for the deal-wide conversation. Ids starting with `s:` are free-form conversations about the project; they are private to their owner until shared, so the service must scope their events to the people allowed to see them.

## Agent → UI

| Event | Payload | Effect in the UI |
|---|---|---|
| `agent.status` | `threadId, label \| null` | Transient progress line in that thread |
| `message.started` | `threadId, messageId` | Streaming reply appears |
| `message.delta` | `threadId, messageId, text` | Text appended |
| `message.completed` | `threadId, message { id, text, parts, trigger?, object? }` | Reply stored in the shared thread. `parts` are view specs. `trigger` marks a proactive update and names its source |
| `proposal.created` | `proposal { id, title, object, changes[{field,to}], author, authorId, source, quote, affects }` | A reviewable change. The app records the base version, drops terms that already match, and assigns the review |
| `object.updated` | `objectId, patch, reason` | Agent-authored content. Today: the memo text |
| `external.updated` | `activityId, status, source, detail?` | Last known status of a step owned by another team, time-stamped on receipt |
| `ui.command` | `forUserId, command, …` | `open_surface {activityId}`, `open_review {proposalId}`, `focus_object {object}` |
| `error` | `message` | Toast |

Send `proposal.created` before the `message.completed` that shows its card.

## Skills and views

A skill returns data and names a registered view. It never returns markup.

```json
{ "view": "structure_comparison", "activityId": "structure",
  "objectIds": ["a", "b"], "presentation": "chat_card", "stateMode": "live" }
```

- `live` cards bind to current deal state and move with it.
- `snapshot` cards are history (a proposal, a decision receipt). They keep what was said and link to the current object.
- A spec naming an unregistered view renders a visible “can’t be shown” card.

Registered views (`src/views.js`), each with a chat card and, where listed, a full surface:

| View | Stage | Surface |
|---|---|---|
| `structure_comparison` | Deal structure | yes |
| `term_change`, `decision_receipt` | Proposals and decisions | review inspector |
| `memo_draft` | Credit memo | yes |
| `committee_pack` | Committee | yes |
| `product_setup` | Product setup | yes |
| `credit_agreement` | Credit agreement | yes |
| `closing_checklist` | Closing | yes |
| `servicing_schedule` | Servicing | yes |
| `kyc_checklist`, `covenant_schedule`, `deal_setup`, `deal_progress` | Supporting | yes, except progress |

To add one: `registerView(name, { card(ctx, spec), workspace?(ctx) })`, then give the skill that name.

## What stays in the application

The agent proposes; the application decides. These rules live in `src/collaboration.js` and `src/model.js` and are not delegated to agent text:

- **Permissions.** `can(user, action)`. Only the deal lead accepts term changes, approves the memo or submits a booking.
- **Version guard.** A decision carries the structure version the reviewer saw. If it moved, the decision is refused and the reviewer is shown what changed.
- **No silent rewrites.** Accepting a change flags the memo, agreement and booking. The memo text changes only through an explicit refresh.

## What the real backend must take over

The prototype keeps deal state in `localStorage`, shared between windows of one browser. That is enough to show two people on one deal; it is not multi-user infrastructure. Production needs:

1. Deal state, proposals, read cursors and messages held server-side, with the version check done transactionally.
2. Human-to-human messages and presence delivered over the same event stream (today they sync through the browser’s storage and a `BroadcastChannel`).
3. Paginated history from the service. The “load older” control and scroll anchoring are in place; the data comes from a local fixture.
4. Authentication. “Viewing as” is a demo switcher.
