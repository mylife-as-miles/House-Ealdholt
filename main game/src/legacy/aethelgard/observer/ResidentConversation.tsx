import {useEffect,useRef,useState,type FormEvent} from 'react';
import {checkDialogueService,NPC_HISTORY_LIMIT,NPC_MESSAGE_LIMIT,requestResidentDialogue,type ConversationMessage,type DialogueStatus} from './resident-conversation-client';

type Status = {state:'checking'}|{state:'offline'}|{state:'configured';model:string};
/** Player-initiated conversation with a roster member. This does not drive the
 * resident's simulation, authorize transactions, or certify physical work. */
export function ResidentConversation({residentId,residentLabel}:{residentId:string;residentLabel:string}) {
  const [status,setStatus]=useState<Status>({state:'checking'});
  const [attempt,setAttempt]=useState(0),[message,setMessage]=useState('');
  const [history,setHistory]=useState<ConversationMessage[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const request=useRef<AbortController|null>(null),selected=useRef(residentId);
  selected.current=residentId;
  useEffect(()=>{request.current?.abort();setHistory([]);setMessage('');setNotice('');setBusy(false);},[residentId]);
  useEffect(()=>{
    const controller=new AbortController();let current=true;setStatus({state:'checking'});
    const timer=setTimeout(()=>controller.abort(),8_000);
    void checkDialogueService(controller.signal).then((result:DialogueStatus)=>{if(current)setStatus(result.available?{state:'configured',model:result.model}:{state:'offline'});}).catch(()=>{if(current)setStatus({state:'offline'});}).finally(()=>clearTimeout(timer));
    return()=>{current=false;clearTimeout(timer);controller.abort();};
  },[residentId,attempt]);
  useEffect(()=>{selected.current=residentId;return()=>{selected.current='';request.current?.abort();};},[]);
  const send=async(event:FormEvent)=>{
    event.preventDefault();const text=message.trim();if(status.state!=='configured'||busy||!text||text.length>NPC_MESSAGE_LIMIT)return;
    const id=residentId,controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setNotice('');
    const timer=setTimeout(()=>controller.abort(),30_000);
    try {
      const result=await requestResidentDialogue(id,text,history.slice(-NPC_HISTORY_LIMIT),controller.signal);
      if(selected.current!==id||controller.signal.aborted)return;
      if(result.model!==status.model)throw new Error('The dialogue service reported an unexpected model.');
      setHistory(old=>[...old,{role:'user' as const,content:text},{role:'assistant' as const,content:result.reply}].slice(-NPC_HISTORY_LIMIT));setMessage('');
    }catch(error){if(selected.current===id)setNotice(controller.signal.aborted?'The dialogue request timed out. Please try again.':error instanceof Error?error.message:'Resident dialogue is unavailable.');}
    finally{clearTimeout(timer);if(request.current===controller){request.current=null;if(selected.current===id)setBusy(false);}}
  };
  return <section data-resident-conversation aria-label={`Talk with ${residentLabel}`}>
    <h4>Talk with {residentLabel}</h4>
    <p className="obs-quiet">Optional AI dialogue for this resident. Conversation does not control their routine or prove physical work.</p>
    {status.state==='checking'?<p className="obs-quiet" role="status">Checking the dialogue service…</p>:status.state==='offline'?<>
      <p className="obs-quiet" role="status">AI dialogue is not configured or is unavailable. The existing village simulation continues.</p>
      <button type="button" data-nav className="obs-row" onClick={()=>setAttempt(n=>n+1)}>Check dialogue service again</button>
    </>:<>
      <p className="obs-quiet">Configured model: {status.model}. A provider response is required before dialogue can be verified.</p>
      <div role="log" aria-live="polite" aria-label="Conversation">{history.map((row,i)=><p className="obs-quiet" key={`${i}:${row.role}`}><strong>{row.role==='user'?'You':residentLabel}:</strong> {row.content}</p>)}</div>
      <form onSubmit={event=>void send(event)}>
        <label>Message <textarea data-nav maxLength={NPC_MESSAGE_LIMIT} value={message} disabled={busy} onChange={event=>setMessage(event.target.value)} /></label>
        <button type="submit" data-nav className="obs-row" disabled={busy||!message.trim()}>{busy?'Waiting for reply…':'Send message'}</button>
      </form>
      {notice&&<p role="status" className="obs-quiet">{notice}</p>}
    </>}
  </section>;
}
