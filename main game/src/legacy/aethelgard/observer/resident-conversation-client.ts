/** Browser-side boundary for the optional, same-origin NPC dialogue service.
 * No model credentials or trusted character facts belong in the browser. */
export const NPC_DIALOGUE_ENDPOINT = '/api/npc-dialogue';
export const NPC_MESSAGE_LIMIT = 500;
export const NPC_HISTORY_LIMIT = 6;
export type ConversationMessage = {role:'user'|'assistant';content:string};
export type DialogueStatus = {available:false}|{available:true;model:string};
export interface DialogueReply {residentId:string;reply:string;model:string}

const isRecord = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shortString = (v:unknown, max:number):v is string => typeof v === 'string' && v.trim().length>0 && v.length<=max;
const isJson = (response:Response) => response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false;

/** Availability is configuration state, not proof that the provider will accept a request. */
export async function checkDialogueService(signal?:AbortSignal, fetcher:typeof fetch=fetch):Promise<DialogueStatus> {
  const response = await fetcher(NPC_DIALOGUE_ENDPOINT,{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin',signal});
  if (!response.ok || !isJson(response)) return {available:false};
  const data:unknown=await response.json();
  if (!isRecord(data) || data.available!==true || !shortString(data.model,160)) return {available:false};
  return {available:true,model:data.model};
}

/** Return only a response bound to the selected resident; errors are deliberately generic. */
export async function requestResidentDialogue(residentId:string,message:string,history:readonly ConversationMessage[],signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<DialogueReply> {
  const text=message.trim();
  if (!shortString(residentId,160) || !shortString(text,NPC_MESSAGE_LIMIT) || history.length>NPC_HISTORY_LIMIT || history.some(h=>!h || !['user','assistant'].includes(h.role) || !shortString(h.content,NPC_MESSAGE_LIMIT))) throw new Error('Please enter a message of 1–500 characters.');
  const response=await fetcher(NPC_DIALOGUE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'same-origin',body:JSON.stringify({residentId,message:text,history}),signal});
  if (!response.ok || !isJson(response)) {
    if(response.status===401)return Promise.reject(new Error('Sign in to use resident dialogue.'));
    if(response.status===429)return Promise.reject(new Error('Dialogue limit reached. Please try again later.'));
    if(response.status===503)return Promise.reject(new Error('Resident dialogue is not configured.'));
    throw new Error('Resident dialogue is unavailable. Please try again later.');
  }
  let result:unknown;
  try { result=await response.json(); } catch { throw new Error('The dialogue service returned an invalid response.'); }
  if (!isRecord(result)||result.residentId!==residentId||!shortString(result.reply,500)||!shortString(result.model,160)) throw new Error('The dialogue service returned an invalid response.');
  return {residentId,reply:result.reply,model:result.model};
}
