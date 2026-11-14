import {createNpcDialogueHandler,type NpcAiConfig} from './handler';
import {createD1DailyQuota,type NpcQuotaD1} from './d1-quota';

export interface SiteNpcAiEnvironment {
  NPC_AI_ENABLED?:string;
  ANTHROPIC_API_KEY?:string;
  NEARAI_API_KEY?:string;
  NPC_AI_PROVIDER?:string;
  NPC_AI_QUOTA_DB?:NpcQuotaD1;
}
/** The caller is responsible for obtaining verified platform identity, not
 * accepting an arbitrary HTTP header from an untrusted direct request. */
export type VerifiedSiteIdentity=(request:Request)=>Promise<{id:string}|null>;

/** Create once per Worker isolate, after platform authentication integration.
 * Missing a verified identity resolver or database leaves the API disabled. */
export function createSiteNpcDialogueHandler(env:SiteNpcAiEnvironment,identity?:VerifiedSiteIdentity,fetcher?:typeof fetch) {
  const provider=env.NPC_AI_PROVIDER==='near-ai'?'near-ai':env.NPC_AI_PROVIDER===undefined||env.NPC_AI_PROVIDER==='anthropic'?'anthropic':undefined;
  const apiKey=provider==='near-ai'?env.NEARAI_API_KEY:provider==='anthropic'?env.ANTHROPIC_API_KEY:undefined;
  const security=identity&&env.NPC_AI_QUOTA_DB?{authenticate:identity,consumeQuota:createD1DailyQuota(env.NPC_AI_QUOTA_DB)}:undefined;
  const config:NpcAiConfig={enabled:env.NPC_AI_ENABLED==='true',provider,apiKey,security,fetcher};
  return createNpcDialogueHandler(config);
}
