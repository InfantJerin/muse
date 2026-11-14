// A transport is the only thing the UI knows about the agent:
//
//   transport.send(command)        UI → agent      (see protocol.js COMMANDS)
//   transport.onEvent(handler)     agent → UI      (see protocol.js EVENTS), returns unsubscribe
//   transport.simulate?(scenario)  demo only; absent on real transports
//
// app.js picks one at start-up: the in-browser mock by default, or the HTTP transport when
// the page is opened with ?agent=<base url>.

import {createMockAgent} from './mock-agent.js';
import {envelope} from './protocol.js';

export function createMockTransport(options){return createMockAgent(options);}

// Server-sent events down, POST up. Untested against a real service: the endpoint shapes
// are the proposal in INTEGRATION.md and are the one place to adapt.
export function createHttpTransport({baseUrl,dealId,userId}){
  const handlers=new Set();
  const emit=event=>handlers.forEach(fn=>fn(event));
  const stream=new EventSource(`${baseUrl}/deals/${dealId}/events?user=${encodeURIComponent(userId)}`);
  stream.onmessage=e=>{try{emit(JSON.parse(e.data));}catch{emit(envelope('error',{message:'Unreadable event from agent service.'}));}};
  stream.onerror=()=>emit(envelope('agent.status',{threadId:null,label:null}));
  return {
    onEvent(fn){handlers.add(fn);return ()=>handlers.delete(fn);},
    async send(command){
      try{const res=await fetch(`${baseUrl}/deals/${dealId}/commands`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});if(!res.ok)throw new Error(String(res.status));}
      catch(err){emit(envelope('error',{message:`Agent service unavailable (${err.message}).`}));}
    },
    close(){stream.close();},
  };
}
