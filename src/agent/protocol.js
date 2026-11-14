// The contract between this UI and an agent session.
//
// The UI never calls the agent's tools and the agent never ships markup. They exchange the
// messages below over a transport (see transport.js). The mock agent in mock-agent.js
// speaks this protocol in the browser; a real agent session replaces it by emitting the
// same events. INTEGRATION.md has the narrative version.
//
// Envelope, both directions:  { v, id, type, payload, ts }

export const PROTOCOL_VERSION=1;

// ---- UI → agent ----
export const COMMANDS={
  'session.open':'{ dealId, userId }  — start or resume a session for this user and deal',
  'message.send':'{ threadId, messageId, userId, text, objectRef? }  — a user message addressed to the agent',
  'action.request':'{ action, threadId, userId, args }  — ask the agent to do work, e.g. memo.refresh',
  'ui.action':'{ action, userId, targetId, result }  — tell the agent what a user just decided in the UI',
  'ui.context':'{ userId, threadId, surface, objectRef }  — what the user is looking at',
};

// ---- agent → UI ----
export const EVENTS={
  'session.ready':'{ capabilities: { views, actions } }',
  'agent.status':'{ threadId, label | null }  — transient progress line',
  'message.started':'{ threadId, messageId }  — a reply began streaming',
  'message.delta':'{ threadId, messageId, text }  — append to the streaming reply',
  'message.completed':'{ threadId, message: { id, text, parts, trigger?, object? } }  — final reply; parts are view specs',
  'proposal.created':'{ proposal: { id, title, object, changes:[{field,to}], author, authorId, source, quote, affects } }',
  'object.updated':'{ objectId, patch, reason }  — agent-authored content for an object it owns, e.g. the memo draft',
  'external.updated':'{ activityId, status, source, detail? }  — last known status of a step owned by another team',
  'ui.command':'{ forUserId, command, ...args }  — steer the UI: see UI_COMMANDS',
  'error':'{ message, code? }',
};

export const UI_COMMANDS={
  open_surface:'{ activityId }  — open the activity’s working surface beside the chat',
  open_review:'{ proposalId }  — open the review inspector for a proposal',
  focus_object:'{ object }  — filter the conversation to one deal object',
};

// ---- View specs: how an agent skill asks for a registered component ----
//
//   { view:'structure_comparison', activityId:'structure', objectIds:['a','b'],
//     presentation:'chat_card', stateMode:'live' }
//   { view:'term_change', proposalId:'pricing-17', presentation:'chat_card', stateMode:'snapshot' }
//
// `live` cards bind to current deal state and change with it. `snapshot` cards are history:
// they keep what was proposed or decided and link to the current object instead of changing.
export const PRESENTATIONS=['chat_card','workspace'];
export const STATE_MODES=['live','snapshot'];

export function validateViewSpec(spec,knownViews){
  if(!spec||typeof spec!=='object')return 'View spec must be an object.';
  if(!knownViews.includes(spec.view))return `Unknown view “${spec.view}”.`;
  if(spec.presentation&&!PRESENTATIONS.includes(spec.presentation))return `Unknown presentation “${spec.presentation}”.`;
  if(spec.stateMode&&!STATE_MODES.includes(spec.stateMode))return `Unknown stateMode “${spec.stateMode}”.`;
  if(spec.objectIds&&!Array.isArray(spec.objectIds))return 'objectIds must be an array.';
  return null;
}

let counter=0;
export const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
export const envelope=(type,payload={})=>({v:PROTOCOL_VERSION,id:uid('e'),type,payload,ts:Date.now()});
