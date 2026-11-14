/** Minimal Cloudflare D1 interface, deliberately independent of the browser. */
export interface NpcQuotaD1 {
  prepare(query:string):{bind(...values:(string|number)[]):{first<T=unknown>():Promise<T|null>}};
}

/** One row per UTC day. The JSON maps contain at most 100 hashed identities per
 * row because each successful entry also spends the global daily allowance. */
export const NPC_AI_QUOTA_SCHEMA = `CREATE TABLE IF NOT EXISTS npc_ai_daily_quota (
  day TEXT PRIMARY KEY NOT NULL,
  total INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  minute_total INTEGER NOT NULL,
  user_counts TEXT NOT NULL,
  user_minute_counts TEXT NOT NULL
)`;

/** A single SQLite statement checks and spends both quotas atomically, even
 * when several Worker isolates call it simultaneously. Values are bound. */
export const NPC_AI_CONSUME_SQL = `INSERT INTO npc_ai_daily_quota
  (day,total,minute,minute_total,user_counts,user_minute_counts)
  VALUES (?1,1,?3,1,json_object(?2,1),json_object(?2,1))
  ON CONFLICT(day) DO UPDATE SET
    total=total+1,
    minute_total=CASE WHEN minute=?3 THEN minute_total+1 ELSE 1 END,
    user_counts=json_set(user_counts,'$."'||?2||'"',COALESCE(json_extract(user_counts,'$."'||?2||'"'),0)+1),
    user_minute_counts=CASE WHEN minute=?3 THEN json_set(user_minute_counts,'$."'||?2||'"',COALESCE(json_extract(user_minute_counts,'$."'||?2||'"'),0)+1) ELSE json_object(?2,1) END,
    minute=?3
  WHERE total<100
    AND COALESCE(json_extract(user_counts,'$."'||?2||'"'),0)<10
    AND minute<=?3
    AND (minute<>?3 OR minute_total<10)
    AND (minute<>?3 OR COALESCE(json_extract(user_minute_counts,'$."'||?2||'"'),0)<3)
  RETURNING total`;

/** The identity MUST come from the hosting platform's verified sign-in, never
 * from user-supplied headers. This adapter does not authenticate users itself.
 * Per-isolate handler concurrency remains two; the SQL adds shared burst caps. */
export function createD1DailyQuota(db:NpcQuotaD1,now:()=>Date=()=>new Date()) {
  return async(identity:{id:string}):Promise<boolean>=>{
    if(!identity||typeof identity.id!=='string'||identity.id.trim()!==identity.id||identity.id.length<1||identity.id.length>256)return false;
    const clock=now(),timestamp=clock.getTime();if(!Number.isFinite(timestamp)||timestamp<0)return false;
    const day=clock.toISOString().slice(0,10),minute=Math.floor(timestamp/60000);
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity.id));
    const key=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
    const result=await db.prepare(NPC_AI_CONSUME_SQL).bind(day,key,minute).first<{total?:unknown}>();
    return !!result&&typeof result.total==='number'&&Number.isInteger(result.total)&&result.total>=1&&result.total<=100;
  };
}
