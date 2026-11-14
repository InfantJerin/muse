// Presentation registry: the fixed set of components an agent skill may ask for.
//
// A view has up to two presentations of the same deal object:
//   card(ctx, spec)   compact, inside a chat message or the persistent summary
//   workspace(ctx)    the full working surface beside the chat
//
// Agents reference views by name in a view spec (see agent/protocol.js). Anything that is
// not registered renders as a visible "unsupported" card instead of arbitrary markup.

import {validateViewSpec} from './agent/protocol.js';

const views=new Map();

export function registerView(name,definition){views.set(name,definition);}
export const viewNames=()=>[...views.keys()];
export const hasWorkspace=name=>Boolean(views.get(name)?.workspace);

export function renderCard(spec,ctx){
  const problem=validateViewSpec(spec,viewNames());
  if(problem)return `<div class="context-card unsupported"><strong>This view can’t be shown</strong><p class="small">${ctx.esc(problem)}</p></div>`;
  return views.get(spec.view).card(ctx,spec);
}

export function renderWorkspace(name,ctx){
  const view=views.get(name);
  return view?.workspace?view.workspace(ctx):null;
}
