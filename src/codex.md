how codex streaming works - what is the underlying architecture? can you explain me with design diagram?

Worked for 1m 12s
How Codex streaming works — underlying architecture
Codex streaming is more sophisticated than a typical ChatGPT-style text stream.

Codex uses an event-driven agent architecture that streams model output, tool execution, file changes, and execution status to the client as they happen.

There are two important layers:

Model streaming: The model generates output incrementally, using the OpenAI Responses API.

Agent event streaming: The Codex runtime translates model output and local tool execution into structured events that the UI can render.

The important distinction is that Codex doesn't simply stream tokens to the frontend. It streams the lifecycle of an entire coding task.

OpenAI has publicly documented the Codex App Server architecture and its event protocol. 

OpenAI
+1

1. High-level architecture

Conceptual architecture for Codex App Server integrations. Different Codex clients and deployments can have different transport and process arrangements.
The key responsibilities:

Component

Responsibility

Codex UI

Displays messages, tool progress, diffs and approvals

App Server

Manages client communication and publishes structured events

Codex Core

Runs the agent loop, maintains task state and coordinates tools

Model API

Generates text and tool-call instructions

Tool executor

Runs commands, edits files and interacts with external tools

The App Server is an open-source Rust implementation. Its job is to translate internal Codex events into a stable protocol that different user interfaces can consume. 

OpenAI
+1

2. End-to-end streaming sequence
Imagine you ask Codex:

Fix the failing unit tests in my Spring Boot application.

The following sequence shows how Codex can execute that request.


mermaid
sequenceDiagram
    autonumber
    participant U as Codex UI
    participant S as App Server
    participant C as Codex Core
    participant M as Responses API
    participant T as Tool Executor

    U->>S: turn/start
    S->>C: Submit user input
    S-->>U: turn/started

    C->>M: Request model inference
    loop Stream model output
        M-->>C: Model events (SSE)
        C-->>S: Internal events
        S-->>U: item/* notifications
    end

    M-->>C: Tool call: run tests
    C->>T: Execute tests
    T-->>C: Stdout / stderr chunks
    C-->>S: Tool output events
    S-->>U: commandExecution/outputDelta

    T-->>C: Exit code + result
    C->>M: Continue with tool result
    M-->>C: Proposed fix
    C->>T: Apply file changes
    T-->>C: Updated files
    C-->>S: File change events
    S-->>U: item/completed + diff update

    C->>M: Continue inference
    M-->>C: Final answer
    S-->>U: agentMessage/delta
    S-->>U: turn/completed
Notice the important point: the model doesn't execute shell commands directly.

It generates a structured tool-call request. Codex Core interprets that request, checks applicable policies, executes the tool, collects its results and makes another model request.

A single user turn may therefore involve multiple model requests and multiple streams. 

OpenAI
+1

3. What exactly is being streamed?
Codex exposes three core primitives:

Thread

A persistent conversation/session

Turn 1

Fix the API

Turn 2

Add tests

Message

Item

Command

Item

File change

Item

Items shown are examples of units of work within turns.
Each item follows a lifecycle:

1. Started

2. Delta(s)

3. Completed

Creation → incremental updates → authoritative final state

For example, the client might receive the following simplified JSON-RPC notifications:


json

{"method":"turn/started","params":{"turn":{"id":"turn-1","status":"inProgress"}}}

{"method":"item/started","params":{"item":{"id":"msg-1","type":"agentMessage"}}}

{"method":"item/agentMessage/delta","params":{"itemId":"msg-1","delta":"I found "}}

{"method":"item/agentMessage/delta","params":{"itemId":"msg-1","delta":"the failing test."}}

{"method":"item/completed","params":{"item":{"id":"msg-1","type":"agentMessage","text":"I found the failing test."}}}

{"method":"turn/completed","params":{"turn":{"id":"turn-1","status":"completed"}}}
Illustrative abbreviated payloads; actual notifications include additional fields.
The frontend doesn't need to wait for turn/completed. It can start rendering on item/started, append incoming deltas, and reconcile the final item when item/completed arrives. 

ChatGPT Learn
+1

4. How is this transported? SSE vs WebSocket vs JSON-RPC
This is where the architecture gets interesting.

Connection

Technology

Purpose

Model API → Codex Core

HTTP + SSE streaming

Incremental model output

Codex Core → App Server

Internal events / queues

Agent state and tool updates

App Server → Client

JSON-RPC notifications

Structured UI events

Client ↔ App Server

stdio JSONL by default; WebSocket and Unix socket options

Bidirectional commands, streaming and approvals

The distinction is that SSE and JSON-RPC are not competitors. SSE is a transport for server-to-client events; JSON-RPC defines how requests, responses and notifications are structured. The App Server can carry JSON-RPC messages over different transports.

The publicly documented app-server WebSocket listener is experimental, so it should not be treated as the default or as proof that every Codex UI uses WebSockets. 

ChatGPT Learn
+1

5. Why Codex uses this design instead of plain SSE
Suppose an agent performs these activities:

Generates a plan.

Runs mvn test.

Streams 200 lines of command output.

Modifies three Java files.

Requests user approval for a command.

Generates its final response.

A plain text stream cannot adequately represent these independently evolving activities.

With structured events, the frontend can route each update to the appropriate UI component.

Event

Frontend action

item/agentMessage/delta

Append message text

item/commandExecution/outputDelta

Append terminal output

item/reasoning/summaryTextDelta

Update reasoning summary

turn/diff/updated

Refresh the code diff

item/commandExecution/requestApproval

Display approval prompt

turn/completed

Mark the task finished

This also separates execution state from presentation state. For example, the terminal might display thousands of characters, while the main chat screen only shows that tests are running.

6. How I would implement a Codex-like streaming architecture
For a custom coding agent using React and a backend runtime, I would use this design:


mermaid
flowchart TB
    UI["React UI"]
    API["API Gateway"]
    AG["Agent Orchestrator"]
    EVT["Event Publisher"]
    MODEL["LLM Streaming API"]
    TOOLS["Tool Runner"]
    DB[("Session & Event Store")]

    UI -->|"POST /turns"| API
    API --> AG
    AG <-->|"Streaming inference"| MODEL
    AG <-->|"Tool calls / results"| TOOLS
    AG --> EVT
    EVT --> DB
    EVT -->|"SSE: structured events"| UI
    UI -->|"Approve / Cancel"| API

    classDef client fill:#e3efff,stroke:#668bb5,color:#23476e
    classDef core fill:#e1f2e6,stroke:#64a17c,color:#245b38
    classDef store fill:#fff0d5,stroke:#be9646,color:#815b20
    class UI client
    class AG,EVT,TOOLS core
    class DB store
I would introduce an event envelope such as:


json
{
  "eventId": "evt-109",
  "threadId": "thread-123",
  "turnId": "turn-456",
  "itemId": "command-789",
  "sequence": 109,
  "type": "command.output.delta",
  "payload": {
    "text": "Tests run: 42, Failures: 0"
  }
}
The sequence and eventId fields are my proposed design, not claimed Codex wire-format fields.

For a production implementation, the important engineering considerations are:

Ordering: Maintain an ordered stream per turn or session.

Backpressure: Buffer or throttle large command-output streams.

Reconnect: Persist events and reconstruct state after disconnection.

Cancellation: Propagate interrupts to model requests and running processes.

Approval: Pause the relevant execution until a decision arrives.

Consistency: Treat terminal item events as authoritative, rather than blindly concatenating all deltas.

The key architectural insight
Codex's architecture can be understood as:

Model token stream → Agent execution events → Structured client event stream → Incremental UI rendering.

The model stream is only one input into the agent runtime. The runtime is responsible for combining inference, tools, state changes, and user interactions into one coherent experience.

For further technical details, the best primary references are Unrolling the Codex agent loop  and How OpenAI built Codex App Server .

One particularly interesting next topic is how Codex handles multiple simultaneous streams—model tokens, command output, and file diffs—without blocking the agent loop. That leads into Rust async tasks, channels, event multiplexing, and backpressure, which are the most useful concepts for building a similar system.


I heard it used Temporal for thread management - in that case, how the durable events are passed on to event store and as delta to UI?

Worked for 34s
The key is to separate Temporal's durable workflow history from the stream of events displayed in the UI. They serve different purposes.

One correction first: I couldn't verify that Codex uses Temporal for thread management. OpenAI's published Codex App Server architecture describes a Rust thread manager that creates and manages core sessions, but doesn't identify Temporal as the underlying orchestration engine. 

OpenAI
+1

However, if we design a Codex-like agent using Temporal, the architecture becomes particularly interesting.

1. Temporal-based architecture

mermaid
flowchart TB
    UI["React UI"]
    API["Agent API / SSE Gateway"]
    WF["Temporal Workflow<br/>Thread / Turn state"]
    ACT["LLM Activity Worker"]
    LLM["LLM Streaming API"]
    ES[("Application Event Store<br/>PostgreSQL / Redis Streams")]
    TH[("Temporal History Store")]
    BUS["Live Event Publisher"]

    UI -->|"Start turn"| API
    API -->|"Start / Signal / Update"| WF
    WF -->|"Schedule activity"| ACT
    ACT <-->|"Token stream"| LLM

    ACT -->|"Append deltas / tool events"| ES
    ACT -->|"Completion result"| WF
    WF -.->|"History persisted automatically"| TH

    ES -->|"New events"| BUS
    BUS -->|"SSE deltas"| API
    API -->|"SSE"| UI
    UI -->|"Resume from last event ID"| API
    API -.->|"Read missed events"| ES

    classDef state fill:#e2f1ff,stroke:#6797c5,color:#234c73
    classDef execution fill:#e4f3e8,stroke:#6a9d78,color:#245d39
    classDef storage fill:#fff0d8,stroke:#c49a50,color:#80591f
    class UI,API state
    class WF,ACT,BUS,LLM execution
    class ES,TH storage
There are two independent persistence mechanisms.

Temporal history store

Application event store

Purpose

Recover and resume workflow execution

Reconstruct streamed UI state

Contains

Workflow starts, activities, signals, results

Token deltas, logs, tool progress, diffs

Managed by

Temporal Server

Your application

Granularity

Workflow operations

UI events

Used for

Durable execution and retries

Streaming, reconnect and replay

Temporal automatically persists its workflow history. It does not automatically write your model token stream into a separate application event store. That requires an explicit streaming mechanism. 

GitHub
+1

2. How a delta travels from the LLM to the UI
Suppose the LLM generates:

"Found 3 failing tests."

Temporal starts the LLM Activity

The workflow schedules an activity. A worker receives the task and initiates an LLM request with streaming enabled.

The Activity consumes the model stream

The activity receives chunks such as "Found ", "3 failing ", "tests." without waiting for the full response.

The Activity writes UI events

Each delta, or preferably a small batch of deltas, is appended to the application event store with a turn ID, item ID and sequence number.

The event publisher sends new events

The gateway subscribes to new records and forwards them over SSE to the browser.

The Activity finishes

Once the model call completes, the activity returns its result to the Temporal workflow, which can schedule another activity or complete the turn.

For example:


text
LLM token
   ↓
Activity Worker
   ↓
Append event #101 to event store
   ↓
Publish event #101
   ↓
SSE Gateway
   ↓
React UI appends text
The critical design choice is that streaming happens outside the workflow's deterministic execution code.

That avoids forcing the Temporal workflow to process a new Signal or Activity completion for every token.

3. There's another option: Temporal Workflow Streams
Temporal's documentation now describes Workflow Streams, a mechanism specifically intended for exposing progress events from workflows and activities to external subscribers, including AI agent UIs. 

GitHub

This changes the architecture: you may not need a separate Redis Streams or PostgreSQL event store for the live stream.


mermaid
flowchart TB
    LLM["LLM"]
    ACT["Streaming Activity"]
    WF["Temporal Workflow"]
    STREAM["Workflow Stream<br/>Offset-addressed event log"]
    HIST[("Temporal History")]
    GATE["SSE Gateway"]
    UI["React UI"]

    LLM -->|"Token chunks"| ACT
    ACT -->|"Batched Signals"| STREAM
    STREAM --- WF
    WF -->|"Persist Signals"| HIST
    GATE -->|"Long-poll via Updates"| STREAM
    GATE -->|"SSE events"| UI

    classDef green fill:#e4f3e8,stroke:#6a9d78,color:#245d39
    classDef blue fill:#e2f1ff,stroke:#6797c5,color:#234c73
    class STREAM,WF green
    class GATE,UI blue
Here's how it works:

The activity buffers incoming LLM deltas.

The publisher periodically flushes a batch into the workflow using a Temporal Signal.

The workflow maintains an offset-addressed event log in its state.

The SSE gateway long-polls the stream through Temporal Updates.

The gateway forwards returned events to the browser and maintains the subscriber's offset.

The documentation suggests a 200 ms batch interval as a starting point for LLM streaming. Each batched publish still adds workflow history, so throughput and history growth matter. 

GitHub

4. What happens if the worker or UI crashes?
Consider the external event-store design:

Failure

Recovery

Browser disconnects

Reconnect with last received event ID; replay missing events

SSE gateway crashes

Another gateway reads from the event store

Temporal worker crashes

Temporal replays workflow history and resumes eligible work

LLM Activity fails midstream

Temporal may retry; partial deltas from the failed attempt must be handled explicitly

Event publisher fails

Replay persisted records using an outbox or durable-stream cursor

The hardest problem is the partial stream from a retried Activity.

For example:


text
Attempt 1: "The issue is in Auth..."
              ↓
           Worker crashes

Attempt 2: "I found a problem in Token..."
If both attempts append to the same message, the user sees corrupted output.

I would assign an attemptId to streamed messages and emit a reset or replacement event when retrying. The UI should only treat the successful attempt's final result as authoritative. A restarted model call is not guaranteed to produce the same tokens.

Also, for the external-store approach, the persistence-to-publish boundary needs care: persist first, publish second, using a transactional outbox, change-data-capture feed, or durable stream cursor. Otherwise, the process could crash after committing an event but before notifying the UI.

5. Which design would I choose?
Requirement

My choice

Small number of users, simple agent progress

Temporal Workflow Streams

Long-running agents with frequent deltas

External event store

Many concurrent UI subscribers

External event store + event broker

Durable approvals, retries and orchestration

Temporal workflows

Permanent searchable conversation history

Dedicated conversation database

For a production Codex-like system, my default would be Temporal for durable orchestration, PostgreSQL for canonical conversation state, and Redis Streams for short-lived UI deltas.

I'd persist important item lifecycle events and finalized messages durably, while batching or compacting transient token deltas.

The central principle is:

Temporal should own the execution state. Your streaming infrastructure should own the presentation events.

Temporal Workflow Streams offers a useful integrated alternative when you want fewer infrastructure components and can accept its history and throughput trade-offs.

Sources: Temporal Workflow Streams  and OpenAI Codex App Server architecture .


ChatGPT is AI and can make mistakes.

