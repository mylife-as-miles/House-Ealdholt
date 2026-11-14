# House Ealdholt

A standalone desktop entry for Crownfall's My Legacy village, built from the existing Ealdholt source and authored Elderbloom environment. It uses the inherited village, the 100-resident roster and saved simulation, rather than a replacement scene.

The source combines Crownfall's `codex/ealdholt-open-water-procedural-fire` at `54aa7b1dd50eb777b01caf75cbcbdd98af4e3aef` (including PR #14, `d678838bf89b8e91ccde15d031b6a27f164db739`) with later `main` work at `a8e9d8013eef0d24c7166f7a845d5cd2248d650b`. The standalone adds a production entry and source-qualified population loading. Original Crownfall source remains separate.

## Setup and run

You need Node 20.19 or later, npm, the GitHub CLI, and an account authorized to read the private `mylife-as-miles/Crownfall` repository and its Elderbloom release. Authenticate with `gh auth login` using your own account; do not put credentials in this project.

```sh
npm ci
npm --prefix 'main game' ci
mkdir -p private-assets/elderbloom
gh release download elderbloom-village-2026-11-06 --repo mylife-as-miles/Crownfall --dir private-assets/elderbloom --skip-existing
npm run assets:village:verify
npm run assets:house:install
npm run build
npm run preview
```

Open the local URL printed by Vite. On every visit, the original 30-second House Ealdholt film plays first; Skip or Escape proceeds to the village loading screen, then the saved village opens. If browser autoplay blocks audio, use the on-screen sound control. The release installer verifies every downloaded file against the pinned SHA-256 manifest. The second installer obtains the exact source-qualified resident site, the original loading image, Ealdholt opening film and the user-supplied soundtrack from private Crownfall Git objects and verifies their hashes; it will not overwrite an existing file. The film is 13,820,923 bytes, SHA-256 `cabfcb4780ee7a27675122c9350d257d351e3c7b257da8c18a0d62dfa698fa9e`; the private source object is pinned to commit `28c967c2535db68fc396ee7350f715336d0aad51`. No credential is embedded in the client. The build checks the opening film, model, matching pond probe and resident site and fails if they are missing or changed.

The desktop GLB is 174,285,136 bytes (about 166 MiB), SHA-256 `3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28`. The population site is SHA-256 `fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475`. The latter is retrieved from Crownfall's private asset branch; the private release itself does not contain it. The download commands require authorized access to both.

The model, baked reflection, source-derived site, village loading image, opening film and soundtrack are excluded from the public Git repository. The `dist` output **does contain** these private assets and must only be shared or hosted in accordance with their licences and access terms. The Elderbloom release's `LICENSE-USE.md` states its Fab Standard License and NoAI restrictions; it is not a standalone open asset library. The user-supplied music has its own provenance and is not relicensed by the code licence.

The original Ealdholt film shows the licensed village and contains a soundtrack generated with Stable Audio 3.0 Small under the Stability AI Community License. Its two camera moves are credited to Leonxlnx's [FIRST BLOOM](https://github.com/Leonxlnx/first-bloom), whose repository has no stated code licence. Crownfall's original `main game/public/video/SOURCES.md` says reuse of those moves requires the author's confirmation. The film is not covered by Crownfall's MIT code licence; do not make it publicly accessible without resolving those rights and the Fab licence terms.

## Existing systems and limits

The renderer uses the authored village model and existing terrain, pond, woodland and surrounding environment. My Legacy retains its views, observer controls, clock, weather, saves, households and resident simulation, plus source-bound fire response, building damage and rebuilding code. The roster and simulation represent 100 people; rendering uses a smaller, changing set of character models. Many jobs, interiors and physical interactions remain unqualified, and a simulated routine is not proof that a villager visibly performed it. The original source replay established a burn-to-rebuild sequence in a deterministic fixture; this standalone has not visually demonstrated that entire sequence. Quest hardware and physical-device performance are not verified by this desktop package.

`npm run typecheck` and `npm run test:core` run the desktop typecheck and focused population, presentation and emergency-site tests. An optional actual-source test can be run after setup:

```sh
CROWNFALL_BUILDING_EMERGENCY_SOURCE_GLB="$PWD/private-assets/elderbloom/elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb" \
CROWNFALL_BUILDING_EMERGENCY_SITE_JSON="$PWD/private-assets/elderbloom/ealdholt-population-desktop-fresh-exterior-v4-tall-commuting.json" \
node --import tsx 'main game/src/legacy/aethelgard/building-emergency-sites.test.ts'
```

## Credits

Crownfall code retains its [MIT licence](LICENSE). Third-party notices remain alongside the assets, including `main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/SOURCES.md`, its `clips/SOURCES.md`, and the regional and texture provenance files. The 100STYLE-derived motion clips are CC BY 4.0 and credit Ian Mason, Sebastian Starke and Taku Komura. MakeHuman and Poly Haven sources include CC0 material; the respective licence texts and notices are retained. Fonts retain their SIL Open Font License notices in `main game/public/fonts`.

## Verification (14 November 2026)

A clean copy of the public files, with the authenticated private assets installed locally, passed the desktop production build and `npm run test:core`. The original-source emergency test above passed all 10 tests against the pinned desktop model and site, including its source-bound long projection and checkpoint. Additional navigation, workplace, clock and reconstruction test modules passed; paired desktop/Quest fire presentation tests passed in the combined Crownfall checkout. The standalone omits the Quest runtime, so those paired Quest tests are not runnable in the desktop-only package.

A fresh headless Chromium session fetched the original model, pond probe, site, resident models and clip libraries successfully. The population reported 100 registered people in 25 households, with three character actors ready in the observed frame. Main-camera diagnostics recorded four resident draw calls, as well as authored architecture and terrain submissions. The clock advanced normally. These counts establish asset loading and render submissions; they do not establish completed work interactions, an end-to-end visible fire and rebuild, smooth animation, or physical-device performance.

For an additional local visibility check, an instrumented copy rendered the same frame at 320×180 with the population on, off and on again. One RGB pixel differed between on and off while matching between both on renders; no pixels changed between the on renders. This establishes a small population contribution in that view, not a recognizable close-up or a motion/occupation proof. The comparison ran locally; no village image was uploaded.

## NEAR Hackathon: Ealdholt market (new work)

The baseline is commit `8537296096c51f3eacdb56be09e847909f666376`; the new work is on `hackathon/near-village-economy` ([compare the branch](https://github.com/mylife-as-miles/House-Ealdholt/compare/8537296096c51f3eacdb56be09e847909f666376...hackathon/near-village-economy) once pushed). The authored village, villagers and pre-existing simulation are Crownfall work. The market, wallet integration, contract and tests on this branch are new. The game still opens the real village and its existing Market panel is available from the village controls.

The Market panel offers a local village ledger and a separate NEAR testnet ledger. Gather renewable timber, trade with the woodcutter, bake bread using timber and purchased supplies, and buy or sell bread to the bakery. Merchant wallets and stocks are finite; each stall holds up to 20 units and prices respond to stock and demand. Advancing a market day pays a wage when the merchant can afford it, allows the baker to purchase fuel for a batch, and lets the village's 25 existing households buy bread rations from their own finite wallets. Scarcity and missed meals are recorded. Market days rotate the first household buyer, regrow up to two units of timber and do not advance the village clock. Household transactions are abstract simulation events: they do not claim a resident physically worked or ate. The previous local save format is migrated with existing balances preserved.

Delivering 12 timber adds it to the existing repair stores in the same local save; actual rebuilding retains its existing worker and site requirements. A verified local building shortage temporarily raises player timber quotes, and filling the stores lowers that premium. The player can also broker a simulated fuel purchase between the bakery and woodcutter, paid from the bakery’s existing funds. These actions do not prove physical NPC work; local fire conditions do not alter the shared NEAR ledger. In the NEAR mode, players can also list timber or bread at a fixed price: the contract holds listed goods in escrow, transfers game coins to the seller on purchase, and returns unsold goods when cancelled. Purchases check the expected price, available quantity and buyer funds. Listings expire after 24 hours; their owner can cancel at any time, and anyone can return expired escrow to the seller. Testnet market days have a 60-second cooldown. Household wallets are contract accounting records associated with immutable saved household IDs; they are not individual NEAR accounts. Game coins are ledger units, not NEAR or a transferable token.

Connect My NEAR Wallet to an initialized testnet contract account, join, and approve actions in the wallet. A finalized delivery bound to this village can be applied to its local repair stores. Receipt use is recorded in that browser save; restoring an older backup can permit a receipt to be applied again. Trust only the contract you deploy and the configured testnet RPC. This prototype has no anti-Sybil protection: its 32-player registration limit and shared commons can be exhausted. Player transactions and listing storage cost gas, and the contract owner funds storage. Do not use real-value assets. The current contract state is not compatible with any previously deployed prototype; use a fresh testnet contract, not an upgrade over an existing state.
Public reviewers can run the local market and contract tests from the source without the restricted village assets. Running the full 3D village requires the authorized private-asset setup above.

**The contract has not been deployed and an end-to-end wallet transaction has not been verified.** A NEAR testnet account and testnet gas are needed. Build and test the contract with a current Rust toolchain:

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --manifest-path contracts/ealdholt-market/Cargo.toml --lib
cargo build --locked --manifest-path contracts/ealdholt-market/Cargo.toml --target wasm32-unknown-unknown --release
npm run test:market
```

Deploy the resulting `contracts/ealdholt-market/target/wasm32-unknown-unknown/release/ealdholt_market.wasm` to an account you control on **testnet**, then initialize it with `new` and empty JSON arguments `{}`. See [NEAR's deployment guide](https://docs.near.org/smart-contracts/release/deploy). Transactions and gas are approved in the owner's wallet. No keys belong in this repository.

The market pricing adapts [Copper Acorn](https://github.com/san-npm/copper-acorn) at `e8f3efef18818ca15bff3d18ce1bac890ab84f05`, Apache-2.0; its licence and notice are in [third_party/copper-acorn](third_party/copper-acorn). The market files containing the adapted algorithm and the contract are Apache-2.0. [Bazaar Sovereign](https://github.com/Automationbot24x7/bazaar-sovereign) (`685b68f0b4f7bf7694720e20769c2547a3f7f8f8`, MIT) informed separate merchant budgets and stock. [Hearthmarket](https://github.com/nguyenkhangph/hearthmarket) (`d3076b4e235c75e447b8c955b0ba29241704372e`, MIT) informed the distinction between local simulation and verified contract actions. Wallet connection uses NEAR Wallet Selector; the contract uses near-sdk.


## Further inspiration

The fixed-capacity stalls and expiring offers were informed by [FarmVerse](https://github.com/chanhduc321-cmd/farmverse) (`ddb13f7ba035982ab669fec97acc3d5d914b6a47`, MIT) and [Haggletown](https://github.com/bizgent-assist/haggletown) (`5b59fba08812f1635191e4def4bd30e21e4a01ca`, MIT). [Afterlight](https://github.com/GGGODLIN/near-afterlight) (`6d762aeb51ca1413ae821ff7b2b769ffdf64df2f`, MIT) informed the shared whole-turn golden vectors tested independently in Rust and TypeScript. [Haat](https://github.com/vinuah-dev/haat) (`0b8b71ce4477f33cad6b79eede847209377be46c`) was reviewed for ideas; no code was copied because no reuse licence was found. These are design inspirations, not claims that Ealdholt has their AI agents, tokens, relayers or deployed contracts.

For the complete comparison, trust boundaries and next steps, see [Economy research](docs/ECONOMY-RESEARCH.md).
