// Registered views. Cards and workspaces read the same deal state, so a chat card, the
// persistent summary and the full surface can never show different values.
//
// ctx = { state, structures, me, icon, esc, btn, badge, heading, can(action), timeAgo(ts) }

import {registerView} from './registry.js';
import {activityDefinitions,status,liveTerms,fmt,agreementClauses,closingConditions,servicingSchedule,canSubmitBooking} from './model.js';
import {pendingProposals,formatTerm} from './collaboration.js';

const DAY=86400e3;
const line=(label,value,sub='',valueSub='')=>`<div class="context-line"><span>${label}${sub?`<small>${sub}</small>`:''}</span><span>${value}${valueSub?`<small>${valueSub}</small>`:''}</span></div>`;

function frame(ctx,{title,right='',body,open,openLabel='Open details'}){
  const notes=open?(ctx.state.activityNotes?.[open]||[]).slice(-2):[];
  return `<div class="context-card"><div class="context-heading"><strong>${title}</strong>${right}</div>${body}${notes.length?`<div class="drafting-notes"><span class="eyebrow">Your working notes</span>${notes.map(n=>`<p>${ctx.esc(n)}</p>`).join('')}</div>`:''}${open?`<div class="context-footer">${ctx.btn('work:'+open,openLabel,'link')}${ctx.icon('external')}</div>`:''}</div>`;
}

// Who owns an external step, what we last heard, and how old that is.
export function freshness(ctx,activityId){
  const known=ctx.state.collaboration?.external?.[activityId];
  if(!known)return '';
  const old=Date.now()-known.at>2*DAY;
  const owner=activityDefinitions.find(a=>a.id===activityId).owner;
  return `<div class="freshness ${old?'old':''}">${ctx.icon('clock')}<span><strong>${ctx.esc(owner)}</strong> · ${ctx.esc(known.status)}<small>Last known ${ctx.timeAgo(known.at)} · ${ctx.esc(known.source)}${old?' · may be out of date':''}</small></span></div>`;
}

const changeText=c=>`${c.label} ${formatTerm(c.field,c.from)} → ${formatTerm(c.field,c.to)}`;
const PROPOSAL_TONE={pending:'review',accepted:'done',rejected:'draft',superseded:'waiting'};
const activityName=id=>activityDefinitions.find(a=>a.id===id)?.name??id;

export function registerViews(workspaces){
  // ---- Deal structure ----
  registerView('structure_comparison',{
    workspace:workspaces.structure,
    card(ctx,spec){
      const c=ctx.state.collaboration;
      const list=spec.objectIds?.length?ctx.structures.filter(s=>spec.objectIds.includes(s.id)):ctx.structures;
      const pending=pendingProposals(c);
      return frame(ctx,{title:list.length===ctx.structures.length?'Financing alternatives':'Structure comparison',right:`<span class="small">Live · v${c.objectVersion}</span>`,open:'structure',openLabel:'Open comparison',
        body:list.map(s=>line(`<strong>${s.name}</strong>${ctx.state.preferred===s.id?' <span class="pill done">Preferred</span>':''}`,`$${s.amount}M`,s.type,`S + ${s.margin} bps · ${s.tenor} years · ${fmt.fee(s.fee)} fee`)).join('')
          +pending.map(p=>`<div class="pending-line">${ctx.icon('info')}<span>${ctx.esc(p.title)}: ${p.changes.map(changeText).join(', ')}<small>Proposed by ${ctx.esc(p.author)} · not applied</small></span>${ctx.btn('review:'+p.id,'Review','link')}</div>`).join('')});
    },
  });

  // A proposal is history: it keeps what was suggested and against which version.
  registerView('term_change',{
    card(ctx,spec){
      const c=ctx.state.collaboration,p=c.proposals.find(x=>x.id===spec.proposalId);
      if(!p)return `<div class="context-card unsupported"><strong>Proposal unavailable</strong><p class="small">It may have been withdrawn.</p></div>`;
      const mine=ctx.can('decide').ok;
      const outcome=p.status==='superseded'?`Superseded by ${ctx.esc(c.proposals.find(x=>x.id===p.supersededBy)?.title??'a later change')}. Original proposal preserved.`:`${p.status==='accepted'?'Accepted':'Rejected'} by ${ctx.esc(p.resolvedBy??'the deal lead')}. Original proposal preserved.`;
      return `<article class="proposal-card"><div class="row between"><strong>${ctx.esc(p.title)} · ${ctx.esc(p.object)}</strong><span class="pill ${PROPOSAL_TONE[p.status]}">${p.status}</span></div>${p.changes.map(x=>`<p class="proposal-values"><em>${x.label}</em><span>${formatTerm(x.field,x.from)}</span> → <strong>${formatTerm(x.field,x.to)}</strong></p>`).join('')}<p class="small">Proposed against v${p.baseVersion} · ${ctx.esc(p.author)}<br>${ctx.esc(p.source)}</p><p class="small">Affects: ${p.affects.map(activityName).join(' · ')}</p>${p.status==='pending'?ctx.btn('review:'+p.id,mine?'Compare & review':'View comparison','primary'):`<p class="small">${outcome}</p>${ctx.btn('work:structure','View current structure','link')}`}</article>`;
    },
  });

  registerView('decision_receipt',{
    card(ctx,spec){
      const c=ctx.state.collaboration,d=c.decisions.find(x=>x.id===spec.decisionId);
      if(!d)return '';
      const p=c.proposals.find(x=>x.id===d.proposalId);
      const accepted=d.decision==='accept';
      return `<div class="decision-receipt">${ctx.icon('check')}<div><strong>${ctx.esc(d.author)} ${accepted?'accepted':'rejected'} ${ctx.esc(p?.title.toLowerCase()??'the proposal')}</strong><p>${accepted?d.changes.map(changeText).join(' · '):'Current terms kept'} · Structure A v${d.version}</p><p class="small">Source: ${ctx.esc(p?.source??'')}</p>${accepted?`<div class="row">${(p?.affects??['memo']).map(id=>ctx.btn('go:'+id,`${activityName(id)} →`,'link')).join('')}</div>`:''}</div></div>`;
    },
  });

  registerView('deal_progress',{
    card(ctx){
      return `<div class="context-card"><div class="context-heading"><strong>Deal progress</strong><span class="small">Project Falcon</span></div><div class="progress-activities compact">${activityDefinitions.map(a=>`<button class="progress-activity" data-action="go:${a.id}"><span class="progress-symbol">${ctx.icon(a.icon)}</span><span><strong>${a.name}</strong><small>${a.owner}</small></span>${ctx.badge(a.id)}${ctx.icon('chevron')}</button>`).join('')}</div></div>`;
    },
  });

  // ---- Existing activities: same cards the chat already showed, now addressable by name ----
  registerView('memo_draft',{
    workspace:workspaces.memo,
    card(ctx){
      const stale=ctx.state.collaboration?.memoStale;
      return frame(ctx,{title:'Credit memo',right:ctx.badge('memo'),open:'memo',openLabel:'Open full draft',
        body:`${stale?`<div class="pending-line">${ctx.icon('info')}<span>Pricing changed after this draft was written<small>The recommendation still shows the earlier terms</small></span></div>`:''}<div class="memo-excerpt"><span class="eyebrow">Transaction overview</span><p>${ctx.esc(ctx.state.memo.split('\n\n')[0])}</p></div><div class="small">Drafting with the deal’s available information. Unconfirmed inputs remain flagged.</div>`});
    },
  });
  registerView('kyc_checklist',{
    workspace:workspaces.kyc,
    card(ctx){const s=ctx.state;return frame(ctx,{title:'KYC evidence',right:ctx.badge('kyc'),open:'kyc',body:line('Verified checks',s.kycVerified?'5 of 5':'4 of 5')+line('Beneficial ownership',s.kycVerified?'Verified':s.kycReceived?'Review pending':'Evidence missing','Client provides · Meera verifies')});},
  });
  registerView('covenant_schedule',{
    workspace:workspaces.covenants,
    card(ctx){return frame(ctx,{title:'Extracted covenants',right:ctx.badge('covenants'),open:'covenants',body:line('Net leverage','5.0× → 4.5×')+line('Reporting','Quarterly')+'<div class="small">Term sheet, pp. 8–9 · Source review available</div>'});},
  });
  registerView('deal_setup',{
    workspace:workspaces.setup,
    card(ctx){return frame(ctx,{title:'Deal setup',right:ctx.badge('setup'),open:'setup',body:line('Borrower','Acme Logistics')+line('Target financing','$250M')});},
  });

  // ---- Committee ----
  registerView('committee_pack',{
    workspace:workspaces.credit,
    card(ctx){
      const s=ctx.state,d=s.committeeDecision;
      return frame(ctx,{title:'Committee pack',right:ctx.badge('credit'),open:'credit',openLabel:'Open committee handoff',
        body:line('Credit memo',status('memo',s)[0],'Basis of the pack')+line('Submission',s.creditRequested?'Submitted':'Not submitted')+(d?line('Decision',ctx.esc(d.outcome))+`<ul class="conditions">${d.conditions.map(x=>`<li>${ctx.esc(x)}</li>`).join('')}</ul>`:'')+freshness(ctx,'credit')});
    },
  });

  // ---- Product setup ----
  const booking=ctx=>{const t=liveTerms(ctx.state),v=`Structure A v${ctx.state.collaboration.objectVersion}`;return [['Facility identifier','FAL-TLB-001','Loan Ops default'],['Borrower','Acme Logistics Ltd.','Deal setup'],['Product','Term Loan B · senior secured',v],['Commitment','USD 250,000,000',v],['Margin',fmt.margin(t.margin),v],['Upfront fee',fmt.fee(t.fee),v],['Rate index','Term SOFR (3M) · ACT/360','Loan Ops default'],['Maturity','7 years from closing',v]];};
  registerView('product_setup',{
    card(ctx){const t=liveTerms(ctx.state);return frame(ctx,{title:'Booking preview',right:ctx.badge('product'),open:'product',openLabel:'Open booking',body:line('Facility','FAL-TLB-001','Term Loan B')+line('Commitment','USD 250M',`Follows Structure A v${ctx.state.collaboration.objectVersion}`,`${fmt.margin(t.margin)} · ${fmt.fee(t.fee)} fee`)+freshness(ctx,'product')});},
    workspace(ctx){
      const s=ctx.state,ready=canSubmitBooking(s),allowed=ctx.can('submitBooking');
      const why=s.bookingSubmitted?'Submitted. The receipt is recorded in the deal history.':!s.committeeDecision?'Waiting for the committee decision.':!s.memoApproved||s.collaboration.memoStale?'The memo must be current and approved.':!allowed.ok?allowed.reason:'Nothing is committed until you confirm.';
      return ctx.heading('Product setup','The booking Loan Ops will receive. It follows the live structure.',ctx.badge('product'))+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>Field</th><th>Value</th><th>Taken from</th></tr></thead><tbody>${booking(ctx).map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td class="small">${r[2]}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><p class="small">${why}</p>${ctx.btn('bookingConfirm',s.bookingSubmitted?'Submitted':'Submit to ledger…','primary',ready&&allowed.ok?'':'disabled')}</div></section>${freshness(ctx,'product')}`;
    },
  });

  // ---- Credit agreement ----
  const clauseState=c=>c.aligned?['Matches','done']:c.accepted?['Deviation accepted','waiting']:['Differs','review'];
  registerView('credit_agreement',{
    card(ctx){const s=ctx.state;return frame(ctx,{title:`Credit agreement · draft ${s.agreement.draft}`,right:ctx.badge('agreement'),open:'agreement',openLabel:'Open clause comparison',body:agreementClauses(s).map(c=>line(c.clause,c.aligned?c.agreed:`${c.draft} in draft`,'',c.aligned?'Matches agreed terms':c.accepted?'Deviation accepted':`Agreed: ${c.agreed}`)).join('')+freshness(ctx,'agreement')});},
    workspace(ctx){
      const s=ctx.state,allowed=ctx.can('acceptDeviation');
      return ctx.heading('Credit agreement','Counsel’s draft against the agreed terms. Counsel owns the document.',ctx.badge('agreement'))+freshness(ctx,'agreement')+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>Clause</th><th>Agreed terms</th><th>Draft ${s.agreement.draft}</th><th>Status</th></tr></thead><tbody>${agreementClauses(s).map(c=>{const [label,tone]=clauseState(c);return `<tr><td>${c.clause}</td><td>${c.agreed}</td><td>${c.draft}</td><td><span class="pill ${tone}">${label}</span>${c.open&&c.id==='leverage'?ctx.btn('acceptDeviation','Accept deviation','link small',allowed.ok?'':`disabled title="${allowed.reason}"`):''}</td></tr>`;}).join('')}</tbody></table></div><div class="table-footer"><p class="small">Differences on pricing follow the live structure. They clear when counsel circulates a draft that matches.</p></div></section>`;
    },
  });

  // ---- Closing ----
  registerView('closing_checklist',{
    card(ctx){return frame(ctx,{title:'Closing conditions',right:ctx.badge('closing'),open:'closing',openLabel:'Open checklist',body:closingConditions(ctx.state).map(c=>line(c.label,c.met?'Met':'Open',c.owner,c.detail)).join('')});},
    workspace(ctx){
      const s=ctx.state;
      const action=c=>c.met?'':c.id==='fee'?ctx.btn('signFeeLetter','Record signed letter','',ctx.can('signFeeLetter').ok?'':`disabled title="${ctx.can('signFeeLetter').reason}"`):c.id==='kyc'?(s.kycReceived?ctx.btn('verifyKyc','Mark verified','',ctx.can('verifyKyc').ok?'':`disabled title="${ctx.can('verifyKyc').reason}"`):ctx.btn('go:kyc','Go to KYC','link small')):ctx.btn('go:'+({committee:'credit',agreement:'agreement',booking:'product'})[c.id],'Go to activity','link small');
      return ctx.heading('Closing','Every condition has one owner. Nothing closes on an assumption.',ctx.badge('closing'))+`<div class="panel checks">${closingConditions(s).map(c=>`<div class="check"><span class="check-icon ${c.met?'':'open'}">${ctx.icon(c.met?'check':'clock')}</span><div><strong>${c.label}</strong><p class="small">${c.owner} · ${c.detail}</p></div><span class="check-actions">${action(c)}<span class="pill ${c.met?'done':'review'}">${c.met?'Met':'Open'}</span></span></div>`).join('')}</div>`;
    },
  });

  // ---- Servicing ----
  registerView('servicing_schedule',{
    card(ctx){const rows=servicingSchedule(ctx.state);return frame(ctx,{title:'Servicing schedule',right:ctx.badge('servicing'),open:'servicing',openLabel:'Open schedule',body:rows.slice(0,2).map(r=>line(r.date,`$${r.interest}M interest`,'Payment date',`$${r.amortisation}M amortisation`)).join('')+freshness(ctx,'servicing')});},
    workspace(ctx){
      return ctx.heading('Servicing','What Loan Ops will run after close. Illustrative until the facility is booked.',ctx.badge('servicing'))+freshness(ctx,'servicing')+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>Payment date</th><th>Interest (est.)</th><th>Amortisation</th><th>Covenant test</th></tr></thead><tbody>${servicingSchedule(ctx.state).map(r=>`<tr><td>${r.date}</td><td>$${r.interest}M</td><td>$${r.amortisation}M</td><td>${r.test}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><p class="small">Interest assumes Term SOFR of 4.30% and the current margin of ${fmt.margin(liveTerms(ctx.state).margin)}.</p></div></section>`;
    },
  });
}
