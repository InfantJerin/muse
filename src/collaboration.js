// Shared object state and immutable conversation records have separate lifecycles.
// The live structure terms are versioned; proposals, decisions and messages are history
// and are never rewritten when the live values move on.

export const users={
  priya:{id:'priya',name:'Priya Shah',role:'lead',title:'Deal lead'},
  arjun:{id:'arjun',name:'Arjun Rao',role:'analyst',title:'Analyst'},
  meera:{id:'meera',name:'Meera Kapoor',role:'kyc',title:'KYC Ops'},
  agent:{id:'agent',name:'Deal agent',role:'agent',title:'Agent'},
};
export const TERM_LABELS={margin:'Margin',fee:'Upfront fee',leverage:'Leverage limit'};
export const formatTerm=(field,value)=>field==='margin'?`${value} bps`:field==='fee'?`${Number.isInteger(value*100)?value.toFixed(2):value}%`:field==='leverage'?`${Number(value).toFixed(2)}×`:String(value);

// The application, not the agent's text, decides who may do what.
const RULES={decide:['lead'],prefer:['lead'],approveMemo:['lead'],requestCredit:['lead'],submitBooking:['lead'],acceptDeviation:['lead'],signFeeLetter:['lead'],verifyKyc:['kyc'],edit:['lead','analyst']};
const ROLE_NAMES={lead:'deal lead',analyst:'analyst',kyc:'KYC Ops'};
export function can(user,action){const roles=RULES[action];if(!roles||roles.includes(user.role))return {ok:true};return {ok:false,reason:`Only the ${roles.map(r=>ROLE_NAMES[r]).join(' or ')} can do this.`};}

const MIN=60e3,DAY=86400e3;
export function createCollaboration(now=Date.now()){return {version:2,seedAt:now,margin:325,fee:1.5,leverage:5,objectVersion:4,updatedBy:'Arjun Rao',updatedAt:now-3*DAY,
  proposals:[{id:'pricing-17',title:'Pricing proposal',object:'Structure A',changes:[{field:'margin',label:'Margin',from:325,to:300}],baseVersion:4,status:'pending',author:'Arjun Rao',authorId:'arjun',source:'Client pricing email · 14 Nov, 10:32',quote:'Please reflect a margin of SOFR + 300 basis points in the next draft.',affects:['memo','agreement','product'],time:now-44*MIN}],
  reviews:[{id:'review-1',assignee:'priya',requestedBy:'arjun',proposalId:'pricing-17',thread:'structure',status:'open',time:now-46*MIN}],
  changes:[],decisions:[],memoStale:false,sessions:seedSessions(now),
  read:{priya:{structure:now-50*MIN,'s:pricing':now-20*MIN},arjun:{},meera:{}},
  // Last known status of steps owned outside the deal team, with when and how we learned it.
  external:{credit:{status:'Pack not yet submitted',at:now-2*DAY,source:'Deal team'},product:{status:'Loan Ops waiting for committee outcome',at:now-5*DAY,source:'Loan Ops queue'},agreement:{status:'Draft 1 circulated by counsel',at:now-3*DAY,source:'Email from Harlow & Reed (synthetic)'},servicing:{status:'Onboarding starts after close',at:now-6*DAY,source:'Loan Ops queue'}}};}

// Conversations are free-form threads about the project. Private to their owner and the agent until shared.
export function seedSessions(now){return [{id:'s:pricing',title:'Pricing pushback options',ownerId:'arjun',shared:true,createdAt:now-3*60*MIN,touched:['structure']},{id:'s:prep',title:'Prep for Thursday client call',ownerId:'priya',shared:false,createdAt:now-DAY,touched:['closing']}];}
export const canSeeSession=(session,userId)=>Boolean(session)&&(session.shared||session.ownerId===userId);
export const pendingProposals=c=>c.proposals.filter(p=>p.status==='pending');
export const changesSince=(c,version)=>c.changes.filter(x=>x.version>version);
export const openReviews=(c,userId)=>c.reviews.filter(r=>r.assignee===userId&&r.status==='open');

// A direct edit to a working term. Bumps the object version so in-flight reviews become stale.
export function editTerm(current,field,value,user){const next=structuredClone(current);const from=next[field];next[field]=value;next.objectVersion++;next.updatedBy=user.name;next.updatedAt=Date.now();next.changes.push({field,label:TERM_LABELS[field],from,to:value,by:user.name,version:next.objectVersion,time:Date.now()});return next;}

// Proposals record what was suggested against which version. Terms that already match are dropped.
export function createProposal(current,draft){const changes=draft.changes.filter(c=>current[c.field]!==c.to).map(c=>({field:c.field,label:TERM_LABELS[c.field],from:current[c.field],to:c.to}));if(!changes.length)return {ok:false,reason:'These terms already match the current structure.'};const next=structuredClone(current);const proposal={id:draft.id??`proposal-${next.proposals.length+1}`,title:draft.title??'Term change',object:draft.object??'Structure A',changes,baseVersion:next.objectVersion,status:'pending',author:draft.author,authorId:draft.authorId,source:draft.source,quote:draft.quote??'',affects:draft.affects??['memo','agreement','product'],time:Date.now()};if(next.proposals.some(p=>p.id===proposal.id))return {ok:false,reason:'This proposal already exists.'};next.proposals.push(proposal);next.reviews.push({id:`review-${next.reviews.length+1}`,assignee:'priya',requestedBy:draft.authorId,proposalId:proposal.id,thread:'structure',status:'open',time:Date.now()});return {ok:true,state:next,proposal};}

// Version-guarded decision. `options` selects the proposal and the deciding user; the
// defaults keep the original single-proposal call working.
export function resolvePricing(current,decision,expectedVersion,options={}){const user=options.user??users.priya;const id=options.proposalId??current.proposals[0]?.id;const found=current.proposals.find(p=>p.id===id);if(!found||found.status!=='pending')return {ok:false,reason:'This proposal has already been resolved.'};const allowed=can(user,'decide');if(!allowed.ok)return {ok:false,code:'forbidden',reason:allowed.reason};if(expectedVersion!==current.objectVersion)return {ok:false,code:'version_conflict',reason:'The structure changed while you were reviewing. Review the latest comparison before deciding.'};const next=structuredClone(current);const proposal=next.proposals.find(p=>p.id===id);const accept=decision==='accept';proposal.status=accept?'accepted':'rejected';proposal.resolvedBy=user.name;const applied=proposal.changes.map(c=>({field:c.field,label:c.label,from:current[c.field],to:accept?c.to:current[c.field]}));const closed=[proposal.id];if(accept){for(const c of proposal.changes)next[c.field]=c.to;next.objectVersion++;next.updatedBy=user.name;next.updatedAt=Date.now();next.memoStale=true;const fields=new Set(proposal.changes.map(c=>c.field));for(const other of next.proposals)if(other.status==='pending'&&other.changes.some(c=>fields.has(c.field))){other.status='superseded';other.supersededBy=proposal.id;closed.push(other.id);}}for(const r of next.reviews)if(closed.includes(r.proposalId))r.status='done';next.decisions.push({id:`decision-${next.decisions.length+1}`,proposalId:proposal.id,author:user.name,authorId:user.id,decision,changes:applied,from:applied[0].from,to:applied[0].to,version:next.objectVersion,time:new Date().toISOString()});return {ok:true,state:next,decision:next.decisions.at(-1)};}

const exchanges=[
['Priya Shah','Can we keep the refinancing at $250M and preserve room for a revolver?','Arjun Rao','I’ll compare a standalone TLB with a blended facility.'],
['Meera Kapoor','Entity registration is verified. Ownership evidence remains outstanding.','Priya Shah','Keep that dependency visible for the team.'],
['Arjun Rao','Structure A is the seven-year TLB. Structure B combines a term loan and revolver.','Priya Shah','Please separate liquidity flexibility from pricing in the comparison.'],
['Arjun Rao','Structure C adds capacity to $275M through private credit.','Priya Shah','Keep it as an alternative, not the preferred case.','Structure C'],
['Meera Kapoor','The client confirmed the ownership pack is being prepared.','Arjun Rao','I’ll leave KYC as pending in the handoff.'],
['Priya Shah','What are we assuming for the base-case fee?','Arjun Rao','The current term sheet says 1.50%; the earlier call was indicative.'],
['Arjun Rao','I’ve linked the leverage clause to page 8.','Priya Shah','Please show the step-down separately from current leverage.'],
['Arjun Rao','For Structure B the revolver would be $50M inside the $250M total.','Priya Shah','Check whether treasury actually wants committed liquidity or just headroom.','Structure B'],
['Arjun Rao','Treasury prefers committed liquidity but is sensitive to the undrawn fee.','Priya Shah','Then B stays alive. Keep its tenor at five years for now.','Structure B'],
['Priya Shah','How does C look on leverage?','Arjun Rao','5.5× opening, which is above what committee approved for the sector last quarter.','Structure C'],
['Meera Kapoor','Sanctions screening came back clear for all directors.','Priya Shah','Good. Note it on the KYC activity, not here.'],
['Arjun Rao','Comparable single-B logistics deals priced between 300 and 350 over.','Priya Shah','So 325 is mid-range. Keep the comps handy for committee.'],
['Priya Shah','Does the client still want the accordion?','Arjun Rao','Yes, $50M uncommitted. It doesn’t change base-case sizing.'],
['Arjun Rao','Private credit lenders want a 2.00% upfront fee on C.','Priya Shah','That cost needs to be explicit in the comparison.','Structure C'],
['Arjun Rao','Rating agency feedback suggests A keeps the existing corporate rating.','Priya Shah','Add that as a qualitative point; don’t overstate it.'],
['Meera Kapoor','Registered address check is done. Only beneficial ownership is open.','Arjun Rao','Thanks, I’ve updated the diligence summary.'],
['Priya Shah','If we went with B, how would the covenant package differ?','Arjun Rao','Tighter: 4.50× from day one, because of the revolver lenders.','Structure B'],
['Arjun Rao','Client CFO asked whether a six-year tenor on A is possible.','Priya Shah','Possible, but it weakens the refinancing story. Keep seven as the working case.'],
['Arjun Rao','Syndicate desk sees good demand for a seven-year TLB at this size.','Priya Shah','Record the date of that read; it goes stale quickly.'],
['Priya Shah','Use the senior secured structure as the working preference.','Arjun Rao','Recorded. The alternatives remain available for comparison.'],
['Meera Kapoor','Director identities and address checks are complete.','Priya Shah','Thanks. We still need verified beneficial ownership before final booking.'],
['Arjun Rao','Memo draft now uses the current 325 bps pricing.','Priya Shah','If pricing changes, flag the memo rather than silently rewriting it.'],
['Arjun Rao','Counsel has started the credit agreement from term sheet v3.','Priya Shah','Ask them to track every departure from the term sheet.'],
['Priya Shah','Has B’s commitment fee been agreed?','Arjun Rao','Not yet. Treasury floated 37.5 bps on the undrawn revolver.','Structure B'],
['Arjun Rao','Loan Ops needs the facility identifiers before booking.','Priya Shah','That waits for committee. Don’t pre-book.'],
['Priya Shah','Retain the original sources when a proposal supersedes them.','Arjun Rao','Agreed. Each pricing proposal will link to its source and prior version.'],
['Meera Kapoor','Client says the ownership declaration needs one more signature.','Priya Shah','Understood. Keep the closing condition open.'],
['Arjun Rao','The team is checking the client’s revised pricing request.','Meera Kapoor','KYC evidence status has not changed.']
];
// Oldest first, roughly eight hours apart, ending an hour before the seeded unread messages.
export const history=exchanges.flatMap((x,i)=>[{id:`h${i}a`,author:x[0],text:x[1],object:x[4]??'Structure A'},{id:`h${i}b`,author:x[2],text:x[3],object:x[4]??'Structure A'}]).map((m,i,all)=>({...m,age:(all.length-i)*8*60*MIN+60*MIN}));

const authorId=name=>Object.values(users).find(u=>u.name===name)?.id??'priya';
const card=(view,extra={})=>({view,presentation:'chat_card',stateMode:'live',...extra});

// Messages that exist before anyone types: the long structure history, the unread updates
// since Priya's last visit, and one agent update in the other shared threads.
function seededMessages(threadId,seedAt){
  if(threadId==='structure')return [
    ...history.map(m=>({id:m.id,authorId:authorId(m.author),kind:'user',text:m.text,object:m.object,ts:seedAt-m.age})),
    {id:'s1',authorId:'arjun',kind:'user',text:'@Priya The client has requested 300 bps for Structure A. Please review against the current 325 bps term sheet.',object:'Structure A',mentions:['priya'],ts:seedAt-46*MIN},
    {id:'s2',authorId:'agent',kind:'agent',trigger:'From email “Re: Falcon pricing”',text:'The client’s email asks for a lower margin on Structure A. I’ve recorded it as a proposal against version 4. The confirmed term stays as it is until the deal lead decides.',object:'Structure A',parts:[card('term_change',{proposalId:'pricing-17',activityId:'structure',stateMode:'snapshot'})],ts:seedAt-44*MIN},
    {id:'s3',authorId:'meera',kind:'user',text:'Ownership evidence is still pending. Pricing review can proceed, but KYC remains a separate requirement.',ts:seedAt-31*MIN},
    {id:'s4',authorId:'arjun',kind:'user',text:'On Structure B the revolver commitment fee is still open. Parking it until we know whether B is still in play.',object:'Structure B',ts:seedAt-22*MIN},
    {id:'s5',authorId:'arjun',kind:'user',text:'One more flag: if 300 goes through, the memo’s recommendation and counsel’s draft will both still say 325.',object:'Structure A',ts:seedAt-12*MIN},
  ];
  if(threadId==='s:pricing')return [
    {id:'sp1',authorId:'arjun',kind:'user',text:'Thinking through our response if the client pushes below 300. Options: hold at 300 with a lower fee, or step-down pricing tied to leverage.',ts:seedAt-180*MIN},
    {id:'sp2',authorId:'priya',kind:'user',text:'A leverage grid is cleaner than giving up fee. What would the grid look like?',ts:seedAt-150*MIN},
    {id:'sp3',authorId:'agent',kind:'agent',text:'A two-step grid is common for this profile: the opening margin while net leverage is above 4.50×, and 25 bps lower below it. The current structures are here for reference.',parts:[card('structure_comparison',{activityId:'structure'})],ts:seedAt-148*MIN},
    {id:'sp4',authorId:'arjun',kind:'user',text:'Drafted a grid on that basis. I’ll bring it to the structure thread once the 300 request is decided.',ts:seedAt-8*MIN},
  ];
  if(threadId==='s:prep')return [
    {id:'sq1',authorId:'priya',kind:'user',text:'What should I be ready to answer on Thursday’s call with the CFO?',ts:seedAt-DAY},
    {id:'sq2',authorId:'agent',kind:'agent',text:'Three things are likely to come up: the 300 bps request, the timing of the ownership declaration, and whether a six-year tenor is still possible. The closing list shows what is open on our side.',parts:[card('closing_checklist',{activityId:'closing'})],ts:seedAt-DAY+2*MIN},
  ];
  const one=(text,view,trigger)=>[{id:`seed-${threadId}`,authorId:'agent',kind:'agent',trigger,text,parts:[card(view,{activityId:threadId})],ts:seedAt-3*DAY}];
  if(threadId==='agreement')return one('Counsel circulated draft 1. Margin and fee match the agreed terms; the leverage covenant is looser than the term sheet.','credit_agreement','From counsel’s email “Falcon — draft credit agreement”');
  if(threadId==='closing')return one('Five conditions stand between this deal and closing. Each has a named owner; I’ll update this list as they report back.','closing_checklist','Closing checklist prepared');
  return [];
}

// One normalised list per thread: seeded history first, then everything posted since.
export function threadMessages(state,threadId){const c=state.collaboration;const posted=state.messages.filter(m=>m.context===threadId).map((m,i)=>({id:m.id??`p-${threadId}-${i}`,authorId:m.authorId??(m.role==='assistant'?'agent':'priya'),kind:m.kind??(m.role==='assistant'?'agent':'user'),text:m.text,object:m.object,mentions:m.mentions,parts:m.parts,trigger:m.trigger,ts:m.time??c?.seedAt??0}));return [...(c?seededMessages(threadId,c.seedAt):[]),...posted];}

export const readCursor=(c,userId,threadId)=>c.read?.[userId]?.[threadId]??c.seedAt;
export function unreadMessages(state,userId,threadId,since){const cursor=since??readCursor(state.collaboration,userId,threadId);return threadMessages(state,threadId).filter(m=>m.ts>cursor&&m.authorId!==userId);}
export function markRead(c,userId,threadId,ts){c.read??={};c.read[userId]??={};if((c.read[userId][threadId]??c.seedAt)>=ts)return false;c.read[userId][threadId]=ts;return true;}

// "Since you last visited": derived from the unread messages themselves, so it can never
// disagree with the conversation. Each line may carry a proposal to jump to.
export function catchUp(state,userId,threadId,since){const unread=unreadMessages(state,userId,threadId,since);if(!unread.length)return null;const c=state.collaboration,lines=[];let other=0;for(const m of unread){const ref=m.parts?.find(p=>p.proposalId||p.decisionId);const proposal=ref?.proposalId&&c.proposals.find(p=>p.id===ref.proposalId);const decision=ref?.decisionId&&c.decisions.find(d=>d.id===ref.decisionId);if(ref?.view==='term_change'&&proposal)lines.push({text:`${proposal.author.split(" ")[0]} proposed ${proposal.changes.map(x=>`${x.label} ${formatTerm(x.field,x.from)} → ${formatTerm(x.field,x.to)}`).join(', ')} on ${proposal.object}`,proposalId:proposal.id,status:proposal.status});else if(decision)lines.push({text:`${decision.author} ${decision.decision==='accept'?'accepted':'rejected'} a change: ${decision.changes.map(x=>`${x.label} ${formatTerm(x.field,x.from)} → ${formatTerm(x.field,x.to)}`).join(', ')}`});else if(m.mentions?.includes(userId))lines.push({text:`${users[m.authorId].name.split(' ')[0]} asked for your review`,messageId:m.id});else if(m.kind==='system')lines.push({text:m.text});else other++;}const people=[...new Set(unread.filter(m=>m.kind==='user').map(m=>users[m.authorId].name.split(' ')[0]))];if(other)lines.push({other:true,text:`${other} other message${other>1?'s':''}${people.length?' from '+people.join(' and '):''}`});return {count:unread.length,lines};}

export const parseMentions=text=>Object.values(users).filter(u=>u.role!=='agent'&&new RegExp(`@${u.name.split(' ')[0]}\\b`,'i').test(text)).map(u=>u.id);
