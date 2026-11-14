# Economy research and implementation notes

This describes ideas inspected for Ealdholt, not functionality inherited from other games. The authored Crownfall village remains the game. All prices and balances currently described below are game credits, not NEAR or a fungible token.

## Projects the team reviewed

| Project | Useful idea | What it means for Ealdholt |
| --- | --- | --- |
| [Copper Acorn](https://github.com/san-npm/copper-acorn) | Scarcity, demand and a buy/sell spread. | The adapted quote formula is already used; its Apache licence and notice are retained in `third_party/copper-acorn`. |
| [Bazaar Sovereign](https://github.com/Automationbot24x7/bazaar-sovereign) | Distinct merchant inventories and money. | The baker and woodcutter have separate bounded stock and budgets. |
| [Hearthmarket](https://github.com/nguyenkhangph/hearthmarket) | Distinguish simulated market actions from contract-enforced actions. | Local village transactions and the separate NEAR ledger are explicitly labelled. |
| [Haat](https://github.com/vinuah-dev/haat) | Buyer swarms and sealed-bid auctions. | A possible future market-day mechanic. The repository did not provide an identified reuse licence; no code was copied. Its README describes testnet code as not yet run on testnet. |
| [Afterlight](https://github.com/GGGODLIN/near-afterlight) | Cross-language checks and economic conservation. | Shared pricing and full-turn vectors run against TypeScript and Rust; Ealdholt does not claim Afterlight's NFTs or deployed contract. |
| [FarmVerse](https://github.com/chanhduc321-cmd/farmverse) | Bounded stalls, budgets, expiring offers and production. | Ealdholt limits inventory and expires escrowed player offers. FarmVerse distinguishes its playable farm and pricing API from planned merchant agents; do not describe those plans as Ealdholt features. |
| [Haggletown](https://github.com/bizgent-assist/haggletown) | Merchant-to-merchant trading and contract-enforced offer bounds. | Ealdholt can broker a bounded baker/woodcutter fuel transaction. Haggletown reports a testnet deployment with individual merchant accounts; Ealdholt does not yet have these accounts or live testnet proof. |
| [Tidewater Market](https://github.com/charitra10/tidewater-market) | Budget-backed requests for scarce goods. | A future repair-timber order could reserve a real budget, expire and settle once. Do not copy its guest sponsorship or real-NEAR design by default. |
| [Settlement Village](https://github.com/Lingikaushikreddy/Settlement-Village) | Visible blocked reasons and protected reserves. | Surface the existing repair timber, need and eligibility checks without inventing villager work. |
| [Brunnfeld](https://github.com/marcopatzelt/brunnfeld-agentic-world) | Ingredient/location-gated recipes and price history. | A future market ledger could show recent transaction history and production dependencies. |
| [Manyworld](https://github.com/alinojoumi8/manyworld) | Ledger reconciliation and clear rule-based versus model-driven labels. | Keep conservation tests and player-facing descriptions of abstract transactions. |

Except for the attributed Copper Acorn quote formula, the features in this pass were independently implemented, not copied from those repositories. Licences should be rechecked before later code reuse.

## What is implemented now

- Source-bound, validated local building damage creates a temporary premium on **player** timber buy and sell quotes when existing unreserved repair timber is short. Duplicate fire/legacy records are merged. Supplying existing repair stores can lower that shortage; it does not complete a rebuild. A stale displayed quote is rejected without committing either wallet.
- A player can broker a simulated purchase of fuel between the baker and woodcutter: the bakery pays the current base timber ask from its own funds, receives no physical work credit, and produces bread only with capacity and stock. The daily automatic batch remains a fixed-price wholesale rule. Household and NPC wallets are ledger records, not separate NEAR accounts or autonomous AI agents.
- The local village's untrusted fire data cannot change shared NEAR prices. A world-wide on-chain disaster economy would need an authoritative world ledger and verifiable event source, not a client-supplied claim.
- Contract household identities are persisted at initialization; the versioned household-ID order must never be changed for an existing deployment. The client fails closed if the contract's identities do not match.

## Deployment and safety priorities

The contract and wallet UI still need a deployed testnet account and actual end-to-end verification. The contract funds its own storage and permits at most 32 players and 64 listings; it can be exhausted by cheap accounts. Follow NEAR's [storage guidance](https://docs.near.org/smart-contracts/security/storage.md) and [NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md) before changing those bounds. A restricted function-call key limits the receiver and methods but still permits abuse of allowed methods; use policy limits, allowance, pause and key-recovery planning ([NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys.md)).

The local browser-save receipt registry is not global replay protection: restoring or copying an old save can reapply a delivery. A competitive shared village needs an authoritative world ledger and idempotent application of finalized receipts. [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) signatures authenticate messages; they are not transaction authorization. Real gas sponsorship requires a funded relayer and signed delegates under [NEP-366](https://docs.near.org/protocol/transactions/meta-tx.md). Don't claim gasless play until that is actually configured and verified.

A local NEAR Workspaces sandbox was attempted during development, but the sandbox could not start: it required a 65,535 file-descriptor limit while this environment's hard limit was 16,384. The compiled Wasm and direct Rust unit tests pass, but neither actual runtime gas usage nor the UI's 30 Tgas transaction allowance has been verified. Run a sandbox in an environment that supports its requirements, then verify a funded testnet wallet and finalized transactions before claiming a live NEAR flow.

## Additional NEAR references

- [NEAR Workspaces](https://github.com/near/near-workspaces-js) exercises compiled contracts and multiple accounts; the JavaScript repository is GPL-3.0. We have not copied its code or added it as a dependency. The local sandbox limitation above still applies.
- [AgentShield](https://github.com/0xNexuz/agentshield) describes bounded testnet agent payments and a vault with recipient, spending and nonce restrictions. Its published proof endpoint is project-operated; those claims are not evidence that Ealdholt is deployed. Ealdholt has no autonomous agent keys or native-NEAR payment vault.
- [Nearcarta](https://github.com/nearcarta/nearcarta) describes guest accounts and a sponsored relayer. Sponsorship requires funding, an operator and real signed delegates; it is not yet a feature of Ealdholt. Its MIT software licence does not automatically cover third-party art.
- [Crownfall: Vael](https://github.com/neromtoobad/crownfall) is a separate project from the private Crownfall source of House Ealdholt. Its reported testnet proof and replayable game examples are reference material, not proof of Ealdholt deployment. Its coin and wagering systems are not part of this village.
- [Boundora](https://github.com/indueth/boundora) reserves all rights; [NEAR's auctions tutorial](https://github.com/near-examples/auctions-tutorial) has no identified reuse licence. Treat both as references only, not code or asset sources without appropriate permission.
- [NEAR's app starter](https://github.com/near/create-near-app) and [NEAR API JS](https://github.com/near/near-api-js) are useful examples for account, RPC, wallet and build workflows. This project retains its existing wallet-selector integration.

The contract now emits structured market events; see [NEAR event notes](NEAR-EVENTS.md). Verify transaction outcome and finality independently before presenting an event as a settled transaction.
