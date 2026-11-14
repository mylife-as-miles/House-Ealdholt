# Ealdholt market events (testnet prototype)

The contract emits one structured log after each successful market action or listing mutation. Events use the [NEP-297](https://github.com/near/NEPs/blob/master/neps/nep-0297.md) envelope:

```text
EVENT_JSON:{"standard":"ealdholt_market","version":"1.0.0","event":"…","data":{…}}
```

The contract serializes JSON values rather than interpolating user input. `actor` is the NEAR predecessor account of the call. All `unit_price`, `total`, `supply_cost` and `starter_game_coins` fields are **game credits**, not NEAR or transferable tokens. `buyer` and `seller` in a `merchant_brokered` event name simulated stalls, not NEAR accounts. Timestamps ending in `_ms` are Unix milliseconds. Event types and their `data` fields are:

| Event | Fields |
| --- | --- |
| `player_joined` | `actor`, `starter_game_coins` |
| `supply_gathered` | `actor`, `item`, `quantity` |
| `stall_trade` | `actor`, `direction`, `stall`, `item`, `quantity`, `unit_price` |
| `merchant_brokered` | `actor`, `buyer`, `seller`, `item`, `quantity`, `unit_price`, `produced_item`, `produced_quantity` |
| `player_baked` | `actor`, `timber_used`, `supply_cost`, `bread_produced` |
| `player_ate` | `actor`, `bread`, `energy_restored` |
| `market_day` | `actor`, `day`, `households_fed`, `households_unfed` |
| `delivery_committed` | `actor`, `receipt_id`, `world_hash`, `timber` |
| `listing_created` | `actor`, `listing_id`, `item`, `quantity`, `unit_price`, `expires_at_ms` |
| `listing_filled` | `actor` (buyer), `seller`, `listing_id`, `item`, `quantity`, `unit_price`, `total`, `remaining_quantity` |
| `listing_cancelled` | `actor` (seller), `listing_id`, `item`, `quantity_returned` |
| `listing_expired` | `actor` (the account requesting cleanup), `seller`, `listing_id`, `item`, `quantity_returned` |

`market_day` summarizes the day and does not enumerate household transactions. `delivery_committed` records an on-chain commitment, not evidence that timber was imported into a village save or that residents physically repaired anything. The local browser-save receipt registry is not globally replay-proof if an old save is restored.

A log by itself is **not evidence of settlement**. A future indexer or explorer view must check the expected contract/account and event fields, transaction and receipt execution outcome, and finality from a trusted RPC before reporting a confirmed action. Logs in failed execution attempts must not be accepted as successes. This project does not yet provide an event indexer or a deployed testnet contract.

The use of contract-side checks and separately verifiable transaction outcomes is informed by [AgentShield](https://github.com/0xNexuz/agentshield) (MIT). AgentShield's payment vault, mandates, security guarantees and live testnet results are not part of this game. No AgentShield code is copied. [near-workspaces-js](https://github.com/near/near-workspaces-js) can test deployed Wasm and receipt behavior; its repository uses GPL-3.0 and has not been added as a project dependency. A local sandbox attempt was blocked by this environment's file-descriptor limit, so runtime gas and live wallet behavior remain unverified.

Run the local contract tests and compile the release Wasm:

```sh
cargo test --locked --manifest-path contracts/ealdholt-market/Cargo.toml --lib
cargo build --locked --manifest-path contracts/ealdholt-market/Cargo.toml --target wasm32-unknown-unknown --release
```

The delivery `world_hash` and actor account are public and linkable. A hash of a predictable local world key is pseudonymous, not secret or anonymous. Never put raw world keys, personal data or credentials into these fields.
