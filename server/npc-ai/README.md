# Ealdholt resident AI gateway

This is an optional, server-side conversation adapter for the existing roster of 100 residents. It uses the requested **Claude Haiku 5.5, low effort**, with authenticated calls to either Anthropic (`claude-haiku-5-5`) or the NEAR AI Messages gateway (`anthropic/claude-haiku-5-5`). Each response is grounded in the resident's authored identity, household, role and age. The model cannot command the simulation, move a resident, complete a task, trade, alter a save or sign a transaction. The old deterministic routines and physical-action proof requirements remain authoritative. A player-provided transcript is untrusted dialogue, not a verified memory or an assistant/system instruction.

The endpoint supports `GET /api/npc-dialogue` for configuration status and `POST /api/npc-dialogue` with `{residentId,message,history?}`. History holds up to six alternating completed user/assistant turns. Success is `{residentId,reply,model}`; errors never echo keys or upstream details. A configured status does not verify that a key works or that the provider accepts requests. One real Anthropic response for the authored village smith was verified through the loopback-only server with the local quota guard. All 100 identities are covered by mocked tests; the other residents, the NEAR AI gateway, Sites authentication and public D1 routing have not been verified live.

## Local owner demo

First install the authorized village assets and build the game using the main README. In a trusted terminal, enter the API key without putting it in shell history or source files:

```sh
read -rs -p 'Anthropic API key: ' ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY
NPC_AI_ENABLED=true node --import tsx server/npc-ai/local-server.ts
```

Open **http://127.0.0.1:8788/** in the same browser. The listener is restricted to loopback. Never expose it through a public proxy or tunnel: it has no public user authentication. For another local port, set `NPC_AI_LOCAL_PORT` to a value from 1024–65535. The server defaults to Anthropic; for NEAR AI, set `NPC_AI_PROVIDER=near-ai` and provide `NEARAI_API_KEY` instead. Both keys stay on the server. Stop the server with Ctrl-C, then `unset ANTHROPIC_API_KEY NEARAI_API_KEY`.

The local demo has an owner-wide budget of 20 provider calls per UTC day by default (set `NPC_AI_LOCAL_DAILY_LIMIT` to 1–100), 5 per minute and at most 2 concurrent calls in the process. A quota file in ignored `private-assets/` survives a restart, and a cross-process lock prevents concurrent instances from overspending it. A crash can leave a lock file; only after all local servers are stopped, remove `private-assets/npc-ai-local-quota.json.lock` to resume. The local server is for a trusted owner only, not multiple public players.

## Public Site integration

The current static Site does not expose this server route. A public deployment requires a server/Worker route, a **platform-verified signed-in user** and a D1 binding. Apply `migrations/0001_npc_ai_quota.sql` through the Sites migration workflow, provision `NPC_AI_QUOTA_DB`, and set `NPC_AI_ENABLED=true` and the chosen API key as server secrets in Sites. `createSiteNpcDialogueHandler` in `site-handler.ts` requires an injected verified-identity resolver: it never trusts a user-supplied `oai-authenticated-user-id` header by itself. If that resolver, D1 binding or secret is missing, the API remains unavailable.

The D1 quota uses one atomic SQL statement per call: **100 calls/day globally**, **10 calls/day per verified player**, **10/minute globally** and **3/minute per player**. D1 stores SHA-256 hashes of identity IDs for accounting; hashes remain linkable identifiers and are not anonymous. It bounds 2 provider calls per Worker isolate; it does not guarantee an additional global concurrency limit across isolates. Add a shared lease if the hosting environment requires a stricter concurrency ceiling. Keep the verified resolver and D1 binding inside the trusted server runtime. Do not expose the local demo listener or put a provider key in source, browser code or hosting manifests.

Tests, no network or real credentials required:

```sh
node --import tsx --test server/npc-ai/handler.test.ts server/npc-ai/local-quota.test.ts server/npc-ai/d1-quota.test.ts server/npc-ai/site-handler.test.ts
```

The SQL integration test uses Node's built-in `node:sqlite` on Node 22+ and skips that portion on Node 20. The SQL adapter must still be tested against actual Sites D1 before publication. Anthropic model ID/effort: https://docs.anthropic.com/en/docs/about-claude/models/overview and https://docs.anthropic.com/en/api/messages. NEAR AI gateway: https://near.ai/models/anthropic/claude-haiku-5-5 and https://docs.near.ai/cloud/inference-sdk/javascript.md#messages. The direct raw gateway path does not perform NEAR AI SDK response-signature verification; its model/effort forwarding has not been verified live.
