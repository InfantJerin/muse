# Deal Space

A local origination UX prototype with synthetic data. Built with native JavaScript modules and CSS, with no build step or package dependencies. Node.js 20+ is recommended.

## Run

```sh
npm run dev
```

Open http://127.0.0.1:5173. Run `npm test` for workflow transition tests.

## Explore

- Overview: deal journey, activity states, owners, recent events.
- Deal structure: compare three alternatives, select a preferred structure, confirm source evidence.
- Credit memo: edit, save, refresh the recommendation from local facts, approve and export text.
- Covenants: extracted clauses, evidence and a threshold schedule.
- KYC: draft a request, record a request and simulate evidence receipt. Receipt is distinct from verification.
- Committee: approval-gated simulated handoff; external review stays pending.
- Product setup, credit agreement, closing, servicing: views that follow the live structure, each with a named owner.
- Assistant: activity-scoped conversations and deterministic demonstration responses.

Chat is the default home, with an always-visible composer and independently scrolling messages. Deal progress opens on demand. Selecting an activity opens its scoped conversation with an inline preview. Open full draft / comparison is a separate action; on wide screens the working surface sits beside the chat. Free-text activity directions are retained as working notes, not applied automatically to facts or documents. Use the source inspector for quick evidence checks. Browser localStorage preserves changes; clear `deal-space-v1` to reset the demo.

## Collaboration walkthrough

Open **Deal structure**. You are Priya, the deal lead, returning to a long shared conversation.

1. The thread opens at the unread divider with a **Since your last visit** summary. The bar under the header shows what is true now and stays put while you scroll.
2. **Load older messages** keeps your place. **Jump to latest** returns you to the end.
3. Click a **Structure B** label to see only that discussion.
4. **Compare & review** Arjun’s 325 → 300 bps proposal. Use *Simulate a teammate edit*: the review turns stale and shows what changed before you can decide.
5. Accept. The proposal card stays as it was written and is marked accepted; a decision receipt follows; the memo, credit agreement and booking are flagged.
6. Open **Credit memo**: status is *Needs update* and approval is blocked until you refresh the recommendation (the agent does this on request) and review it.
7. **Scenarios** (top right) plays a teammate, an external team or a new document: a message arriving while you read, term sheet v4, a committee decision, a new draft from counsel.
8. Open a second window and pick another person under **Viewing as**. Messages, decisions and presence sync between windows. Arjun can compare a proposal but not accept it; a message with *@Priya* lands in her **Needs attention**.

9. The left rail lists projects with the most recently active first. Under a project, **Conversations** are free-form threads: start one with **+**. It is private to you and the agent until you turn on **Share with deal team**. A change proposed or decided in a conversation is also recorded in the activity it belongs to. **Activities** collapse to the ones with updates.

Ask the agent in any thread (“Compare A and B”, “What is still open before closing?”, “Propose 310 bps for Structure A”). It answers with a registered component for that stage: deal structure, memo, committee, product setup, credit agreement, closing or servicing. Switch the composer to **Team only** to message people without an agent reply.

## Module contract

| File | Role |
|---|---|
| `src/model.js` | Activities, statuses, guarded transitions, and the derived views of downstream stages |
| `src/collaboration.js` | Versioned live terms, proposals, decisions, permissions, read cursors, thread assembly |
| `src/registry.js`, `src/views.js` | The fixed set of components an agent skill may ask for; one card and one working surface per stage |
| `src/agent/` | Protocol, transport and the scripted demo agent. See **INTEGRATION.md** to connect a real agent session |
| `src/app.js` | Session shell: navigation, persistent summary, conversation, composer, surfaces |

## Prototype boundaries

No authentication, real AI, document extraction, email sending, ledger or credit-system connection. Agent replies are scripted. Deal state lives in this browser’s localStorage and is shared between its windows; that demonstrates two people on one deal but is not multi-user infrastructure. File selection creates a demo receipt and does not read the file. All data, sources and external parties are synthetic. Use **Scenarios → Reset the demo** to start over.
