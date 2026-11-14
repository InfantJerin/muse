// A stand-in for the real agent session. It answers with the protocol events a real session
// would send, so the UI code path is identical. Replies are scripted, not generated.
//
// The mock reads deal state through `getState` because it has no tools of its own. A real
// agent uses its own tools and deal store instead; nothing else here leaks into the UI.

import {envelope,uid} from './protocol.js';
import {status,liveTerms,fmt,agreementClauses,closingConditions,refreshRecommendation,activityDefinitions} from '../model.js';
import {pendingProposals,formatTerm} from '../collaboration.js';

const card=(view,activityId,extra={})=>({view,activityId,presentation:'chat_card',stateMode:'live',...extra});

// Each skill pairs an intent with the registered view that presents its result.
// This is the shape to keep when real skills replace these: pick a view, never invent UI.
const SKILLS=[
  {name:'memo_draft',match:/memo|recommendation/,activityId:'memo',view:'memo_draft',
    say:({state})=>state.collaboration?.memoStale?'The memo still reflects the earlier pricing, so it is marked as needing an update. I can refresh the recommendation when you’re ready; it will need your review before approval.':`Here is the current memo. Status: ${status('memo',state)[0].toLowerCase()}.`},
  {name:'committee_pack',match:/committee|approval|vote/,activityId:'credit',view:'committee_pack',
    say:({state})=>state.committeeDecision?'Committee approved the deal with conditions. They are listed on the pack.':state.creditRequested?'The pack is with the committee. The status below is the last one reported to us, not a live feed.':'The committee pack can be submitted once the memo is approved.'},
  {name:'product_setup',match:/book|product|ledger|facility id/,activityId:'product',view:'product_setup',
    say:({state})=>state.bookingSubmitted?'The facility has been submitted to the ledger.':'This is the booking Loan Ops would receive. It follows the current structure and cannot be submitted before committee approval.'},
  {name:'credit_agreement',match:/agreement|counsel|clause|deviation/,activityId:'agreement',view:'credit_agreement',
    say:({state})=>{const open=agreementClauses(state).filter(c=>c.open);return open.length?`Counsel’s draft ${state.agreement.draft} differs from the agreed terms on ${open.map(c=>c.clause.toLowerCase()).join(' and ')}.`:`Counsel’s draft ${state.agreement.draft} matches the agreed terms.`;}},
  {name:'closing_checklist',match:/clos|condition|block|outstanding|missing|next/,activityId:'closing',view:'closing_checklist',
    say:({state})=>{const open=closingConditions(state).filter(c=>!c.met);return open.length?`${open.length} closing condition${open.length>1?'s are':' is'} still open: ${open.map(c=>`${c.label.toLowerCase()} (${c.owner})`).join('; ')}.`:'Every closing condition is met.';}},
  {name:'servicing_schedule',match:/servic|payment|interest|schedule/,activityId:'servicing',view:'servicing_schedule',
    say:()=>'This is the first year of servicing events on the current terms. It is illustrative until the facility is booked.'},
  {name:'kyc_checklist',match:/kyc|ownership|diligence/,activityId:'kyc',view:'kyc_checklist',
    say:({state})=>`KYC status: ${status('kyc',state)[0].toLowerCase()}. Four of five checks are verified; beneficial ownership is the open item.`},
  {name:'covenant_schedule',match:/covenant|leverage/,activityId:'covenants',view:'covenant_schedule',
    say:({state})=>`The leverage covenant is ${fmt.leverage(liveTerms(state).leverage)} with a step-down after year two.`},
  {name:'structure_comparison',match:/compar|structure|option|pricing|margin|alternativ/,activityId:'structure',view:'structure_comparison',
    say:({state},ids)=>{const n=pendingProposals(state.collaboration).length;return `${ids?.length?'Here are those structures side by side':'Here are the three structures'} on current terms.${n?` ${n} proposed change${n>1?'s are':' is'} awaiting review and not yet reflected.`:''}`;}},
];

function digest(state){
  const c=state.collaboration,lines=[];
  for(const p of pendingProposals(c))lines.push(`**${p.title}** from ${p.author} is awaiting review (${p.changes.map(x=>`${x.label} ${formatTerm(x.field,x.from)} → ${formatTerm(x.field,x.to)}`).join(', ')}).`);
  const last=c.decisions.at(-1);
  if(last)lines.push(`${last.author} ${last.decision==='accept'?'accepted':'rejected'} the last change; Structure A is at version ${c.objectVersion}.`);
  if(c.memoStale)lines.push('The credit memo needs an update because pricing changed.');
  const open=closingConditions(state).filter(x=>!x.met).length;
  lines.push(`${open} of 5 closing conditions remain open.`);
  return lines.join('\n');
}

// "set margin to 310 bps", "propose a 1.25% fee", "change leverage to 4.75x"
function parseChange(text){
  if(!/\b(propose|set|change|update|reduce|increase|lower|raise|move)\b/i.test(text))return null;
  let m;
  if((m=text.match(/(\d{3})\s*bps/i)))return {field:'margin',to:Number(m[1])};
  if(/fee/i.test(text)&&(m=text.match(/(\d(?:\.\d+)?)\s*%/)))return {field:'fee',to:Number(m[1])};
  if(/leverage/i.test(text)&&(m=text.match(/(\d(?:\.\d+)?)\s*[x×]/i)))return {field:'leverage',to:Number(m[1])};
  return null;
}

export function planReply(ctx,{text,threadId,userId,userName}){
  const {state}=ctx,lower=text.toLowerCase();
  const change=parseChange(text);
  if(change){
    if(state.collaboration[change.field]===change.to)return {text:`Structure A already has ${formatTerm(change.field,change.to)} for that term, so there is nothing to propose.`};
    const id=uid('proposal');
    return {status:['Checking the current structure…'],
      events:[['proposal.created',{proposal:{id,title:'Term change',object:'Structure A',changes:[change],author:userName,authorId:userId,source:`Requested in conversation by ${userName}`,quote:text}}]],
      text:'I’ve recorded that as a proposal instead of changing the confirmed term. The deal lead has been asked to review it.',
      parts:[card('term_change','structure',{proposalId:id,stateMode:'snapshot'})]};
  }
  if(/chang|since|catch|happen|update me/.test(lower))return {status:['Reviewing recent activity…'],text:digest(state),parts:[card('deal_progress',null)]};
  const current=activityDefinitions.find(a=>a.id===threadId);
  const skill=SKILLS.find(s=>s.match.test(lower))??SKILLS.find(s=>s.activityId===current?.id);
  if(!skill)return {text:digest(state),parts:[card('deal_progress',null)]};
  const ids=skill.name==='structure_comparison'?[...text.matchAll(/\b([ABC])\b/g)].map(m=>m[1].toLowerCase()):[];
  const plan={status:[`Looking up ${activityDefinitions.find(a=>a.id===skill.activityId).name.toLowerCase()}…`],text:skill.say(ctx,ids),parts:[card(skill.view,skill.activityId,ids.length?{objectIds:[...new Set(ids)]}:{})]};
  if(/^open\b|\bopen the\b|side by side|full (draft|view|comparison)/.test(lower))plan.commands=[{forUserId:userId,command:'open_surface',activityId:skill.activityId}];
  return plan;
}

export function createMockAgent({getState,schedule=(fn,ms)=>setTimeout(fn,ms)}={}){
  const handlers=new Set();
  const emit=(type,payload)=>handlers.forEach(fn=>fn(envelope(type,payload)));
  const run=steps=>{const next=i=>{if(i<steps.length)schedule(()=>{steps[i][1]();next(i+1);},steps[i][0]);};next(0);};

  // Status lines, then a streamed reply, then the durable result.
  function reply(threadId,plan,extra={}){
    const messageId=uid('m'),steps=[];
    for(const label of plan.status??[])steps.push([450,()=>emit('agent.status',{threadId,label})]);
    steps.push([450,()=>{emit('agent.status',{threadId,label:null});emit('message.started',{threadId,messageId});}]);
    const words=plan.text.split(' ');
    for(let i=0;i<words.length;i+=4)steps.push([45,()=>emit('message.delta',{threadId,messageId,text:(i?' ':'')+words.slice(i,i+4).join(' ')})]);
    steps.push([60,()=>{
      for(const [type,payload] of plan.events??[])emit(type,payload);
      emit('message.completed',{threadId,message:{id:messageId,text:plan.text,parts:plan.parts??[],...extra}});
      for(const c of plan.commands??[])emit('ui.command',c);
    }]);
    run(steps);
  }

  const scenarios={
    // A new document version arrives. Confirmed values stay; the differences become one proposal.
    term_sheet_v4(){
      const {state}=getState(),c=state.collaboration;
      const changes=[{field:'margin',to:300},{field:'fee',to:1.375},{field:'leverage',to:4.75}].filter(x=>c[x.field]!==x.to);
      if(!changes.length||c.proposals.some(p=>p.id==='termsheet-v4'))return emit('error',{message:'Term sheet v4 has already been processed.'});
      reply('structure',{status:['Reading Term_Sheet_v4.pdf (page 4 of 11)…','Comparing with the confirmed terms…'],
        events:[['proposal.created',{proposal:{id:'termsheet-v4',title:'Term sheet v4',object:'Structure A',changes,author:'Arjun Rao',authorId:'arjun',source:'Term_Sheet_v4.pdf · pp. 4–8 · uploaded by Arjun',quote:'Applicable Margin: SOFR plus 300 basis points. Upfront Fee: 1.375%. Total Net Leverage Ratio not to exceed 4.75 to 1.00.',affects:['memo','agreement','product','covenants']}}]],
        text:`Term sheet v4 differs from the current structure on ${changes.length} term${changes.length>1?'s':''}. Nothing has been changed: the confirmed values stay until the deal lead reviews the proposal.`,
        parts:[card('term_change','structure',{proposalId:'termsheet-v4',stateMode:'snapshot'})]},{trigger:'From Term_Sheet_v4.pdf',object:'Structure A'});
    },
    committee_decision(){
      const {state}=getState();
      if(!state.creditRequested)return emit('error',{message:'The committee has nothing to decide yet. Approve the memo and submit the pack first.'});
      if(state.committeeDecision)return emit('error',{message:'The committee decision is already recorded.'});
      emit('external.updated',{activityId:'credit',status:'Approved with conditions',source:'Committee secretary minute',detail:{outcome:'Approved with conditions',conditions:['Beneficial ownership verified before first drawdown','Net leverage covenant no looser than the term sheet at signing']}});
      reply('credit',{text:'The committee secretary has recorded an approval with two conditions. Product setup can now be booked; both conditions are tracked under closing.',parts:[card('committee_pack','credit')]},{trigger:'From the committee secretary’s minute'});
    },
    legal_draft(){
      emit('external.updated',{activityId:'agreement',status:'New draft circulated by counsel',source:'Email from Harlow & Reed (synthetic)',detail:{newDraft:true}});
      reply('agreement',{status:['Reading the new draft…','Comparing clauses with the agreed terms…'],text:'Counsel circulated a new draft. I’ve compared its pricing and covenant clauses with the current structure.',parts:[card('credit_agreement','agreement')]},{trigger:'From counsel’s email “Falcon — revised draft”'});
    },
  };

  return {
    onEvent(fn){handlers.add(fn);return ()=>handlers.delete(fn);},
    simulate(name){scenarios[name]?.();},
    scenarios:Object.keys(scenarios),
    send(command){
      const p=command.payload,ctx=getState();
      switch(command.type){
        case 'session.open':emit('session.ready',{capabilities:{views:SKILLS.map(s=>s.view).concat('term_change','decision_receipt','deal_progress'),actions:['memo.refresh']}});break;
        case 'message.send':reply(p.threadId,planReply(ctx,p));break;
        case 'action.request':
          if(p.action==='memo.refresh'){
            const text=refreshRecommendation(ctx.state,ctx.structures,p.args.text);
            reply('memo',{status:['Reading the confirmed terms…','Redrafting the recommendation…'],
              events:[['object.updated',{objectId:'memo',patch:{text},reason:'Recommendation refreshed from current terms'}]],
              text:`I’ve refreshed the recommendation to ${fmt.margin(liveTerms(ctx.state).margin)}. The rest of the draft is untouched. Please review it before approving.`,
              parts:[card('memo_draft','memo')]});
          }
          break;
        // The agent hears about decisions made in the UI and follows up where they have consequences.
        case 'ui.action':
          if(p.action==='proposal.accepted'){
            reply('memo',{text:`Structure A changed to version ${p.result.version}. The memo’s recommendation still reflects the earlier terms, so I’ve marked it as needing an update without rewriting it.`,parts:[card('memo_draft','memo')]},{trigger:'Structure A changed'});
            if(agreementClauses(ctx.state).some(c=>c.open))reply('agreement',{text:'Counsel’s draft no longer matches the agreed terms. The differences are listed below so they can be raised with counsel.',parts:[card('credit_agreement','agreement')]},{trigger:'Structure A changed'});
          }
          break;
      }
    },
  };
}
