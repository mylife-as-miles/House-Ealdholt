// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;
use near_sdk::{near, env, require, AccountId, PanicOnDefault};

// Pricing adapted from Copper Acorn contract/src/economy.rs, Apache-2.0.
// Copyright 2026 Copper Acorn contributors; see third_party/copper-acorn/.
fn quote(base: u32, stock: u32, target: u32, demand: u32) -> (u32, u32) {
    let adjustment = (100 * (target as i64 - stock.min(10000) as i64)).div_euclid(2 * target as i64).clamp(-50,75);
    let factor=(100 + adjustment + (demand.min(6)*5) as i64).clamp(50,175) as u32;
    let reference=(base * factor / 100).max(1);
    let bid=(reference * 80 / 100).max(1);
    (bid, ((reference * 120 + 99)/100).max(bid+1))
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Player { pub coins:u32, pub timber:u32, pub bread:u32, pub energy:u32, pub next_delivery:u32 }
impl Default for Player { fn default()->Self { Self{coins:16,timber:0,bread:0,energy:4,next_delivery:0} } }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Delivery { pub id:u32, pub world_hash:String, pub timber:u32 }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Town { pub forest:u32,pub merchant_timber:u32,pub merchant_coins:u32,pub bakery_bread:u32,pub bakery_coins:u32,pub timber_demand:u32,pub bread_demand:u32,pub day:u32 }
impl Default for Town { fn default()->Self {Self{forest:24,merchant_timber:5,merchant_coins:30,bakery_bread:8,bakery_coins:20,timber_demand:0,bread_demand:0,day:1}} }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Household { pub coins:u32, pub meals:u32, pub missed:u32 }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Listing { pub id:u32, pub seller:AccountId, pub item:String, pub quantity:u32, pub unit_price:u32, pub expires_at_ms:u64 }
#[near(serializers = [json])]
pub struct Snapshot { pub player:Option<Player>,pub town:Town,pub timber_bid:u32,pub timber_ask:u32,pub bread_ask:u32,pub bread_bid:u32,pub deliveries:Vec<Delivery>,pub households:Vec<Household>,pub last_fed:u32,pub last_unfed:u32,pub next_day_at_ms:u64,pub listings:Vec<Listing> }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct EaldholtMarket { town:Town, players:BTreeMap<AccountId,Player>, deliveries:BTreeMap<AccountId,Vec<Delivery>>, households:Vec<Household>, supplier_coins:u32, last_fed:u32, last_unfed:u32, last_day_ns:u64, listings:BTreeMap<u32,Listing>, next_listing:u32 }

#[near]
impl EaldholtMarket {
    #[init]
    pub fn new()->Self {Self{town:Town::default(),players:BTreeMap::new(),deliveries:BTreeMap::new(),households:vec![Household{coins:16,meals:0,missed:0};25],supplier_coins:0,last_fed:0,last_unfed:0,last_day_ns:env::block_timestamp(),listings:BTreeMap::new(),next_listing:1}}
    pub fn get_market(&self,account_id:AccountId)->Snapshot {
        let (bid,ask)=quote(5,self.town.merchant_timber,6,self.town.timber_demand);
        let (bread_bid,bread)=quote(4,self.town.bakery_bread,8,self.town.bread_demand);
        Snapshot{player:self.players.get(&account_id).cloned(),town:self.town.clone(),timber_bid:bid,timber_ask:ask,bread_ask:bread,bread_bid,deliveries:self.deliveries.get(&account_id).cloned().unwrap_or_default(),households:self.households.clone(),last_fed:self.last_fed,last_unfed:self.last_unfed,next_day_at_ms:self.last_day_ns / 1_000_000 + 60_000,listings:self.listings.values().cloned().collect()}
    }
    /// One bounded starter wallet per NEAR account. This is game credit, not NEAR or a transferable token.
    pub fn join(&mut self) {let id=env::predecessor_account_id();require!(!self.players.contains_key(&id),"Already joined");require!(self.players.len()<32,"Market is full");self.players.insert(id,Player::default());}
    pub fn act(&mut self,action:String,limit:u32,world_hash:Option<String>){
        let id=env::predecessor_account_id();let p=self.players.get_mut(&id).unwrap_or_else(||env::panic_str("Join the market first"));
        let t=&mut self.town;
        match action.as_str() {
            "gather"=>{require!(p.energy>0 && t.forest>=2,"Need energy and timber in the commons");p.energy-=1;t.forest-=2;p.timber+=2;},
            "sell-timber"=>{let (price,_)=quote(5,t.merchant_timber,6,t.timber_demand);require!(price>=limit && p.timber>=1 && t.merchant_timber<20 && t.merchant_coins>=price,"Price changed, timber missing, stall full or merchant cannot pay");p.timber-=1;t.merchant_timber+=1;p.coins+=price;t.merchant_coins-=price;},
            "buy-timber"=>{let (_,price)=quote(5,t.merchant_timber,6,t.timber_demand);require!(price<=limit && t.merchant_timber>=1 && p.coins>=price,"Price changed, stock missing or insufficient coins");p.coins-=price;t.merchant_coins+=price;t.merchant_timber-=1;p.timber+=1;t.timber_demand=t.timber_demand.saturating_add(1).min(1_000_000);},
            "buy-bread"=>{let (_,price)=quote(4,t.bakery_bread,8,t.bread_demand);require!(price<=limit && t.bakery_bread>=1 && p.coins>=price,"Price changed, bread missing or insufficient coins");p.coins-=price;t.bakery_coins+=price;t.bakery_bread-=1;p.bread+=1;t.bread_demand=t.bread_demand.saturating_add(1).min(1_000_000);},
            "sell-bread"=>{let (price,_)=quote(4,t.bakery_bread,8,t.bread_demand);require!(price>=limit && p.bread>=1 && t.bakery_bread<20 && t.bakery_coins>=price,"Price changed, bread missing, stall full or baker cannot pay");p.bread-=1;t.bakery_bread+=1;p.coins+=price;t.bakery_coins-=price;},
            "bake"=>{require!(p.timber>=1 && p.coins>=3,"Baking needs timber and 3 coins");p.timber-=1;p.coins-=3;self.supplier_coins+=3;p.bread+=2;},
            "eat"=>{require!(p.bread>=1 && p.energy<=6,"Need bread and room for energy");p.bread-=1;p.energy+=2;},
            "next-day"=>{require!(t.day<1000,"Market day limit reached");let now=env::block_timestamp();require!(now.saturating_sub(self.last_day_ns)>=60_000_000_000,"Market day cooldown");self.last_day_ns=now;t.day+=1;t.forest=(t.forest+2).min(24);p.energy=(p.energy+1).min(8);t.timber_demand/=2;t.bread_demand/=2;
                let start=((t.day-2) as usize)%self.households.len();
                if t.merchant_coins>=2 {t.merchant_coins-=2;self.households[start].coins+=2;}
                if t.bakery_coins>=3 && t.merchant_timber>=1 && t.bakery_bread<=18 {t.bakery_coins-=3;t.merchant_coins+=3;t.merchant_timber-=1;t.bakery_bread+=2;}
                self.last_fed=0;self.last_unfed=0;
                let count=self.households.len();for i in 0..count {let h=&mut self.households[(start+i)%count];let (_,price)=quote(4,t.bakery_bread,8,t.bread_demand);
                    if t.bakery_bread>0 && h.coins>=price {h.coins-=price;t.bakery_coins+=price;t.bakery_bread-=1;t.bread_demand=t.bread_demand.saturating_add(1).min(1_000_000);h.meals+=1;self.last_fed+=1;} else {h.missed+=1;self.last_unfed+=1;}}
            },
            "donate-timber"=>{let world=world_hash.unwrap_or_default();require!(world.len()==64 && world.bytes().all(|c|c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),"Expected lowercase world hash");require!(p.timber>=12,"Need 12 timber");let records=self.deliveries.entry(id).or_default();require!(records.len()<64,"Delivery limit reached");p.timber-=12;p.next_delivery+=1;records.push(Delivery{id:p.next_delivery,world_hash:world,timber:12});},
            _=>env::panic_str("Unknown action"),
        }
    }
    /// Escrow inventory at a fixed unit price; the contract cannot spend NEAR.
    pub fn create_listing(&mut self,item:String,quantity:u32,unit_price:u32) {
        require!(item=="timber" || item=="bread","Unsupported item");
        require!((1..=100).contains(&quantity) && (1..=1000).contains(&unit_price),"Invalid listing terms");
        require!(self.listings.len()<64,"Marketplace is full");
        let seller=env::predecessor_account_id();let player=self.players.get_mut(&seller).unwrap_or_else(||env::panic_str("Join the market first"));
        let stock=if item=="timber" {&mut player.timber} else {&mut player.bread};require!(*stock>=quantity,"Insufficient inventory");*stock-=quantity;
        let id=self.next_listing;self.next_listing=self.next_listing.checked_add(1).unwrap_or_else(||env::panic_str("Listing IDs exhausted"));
        let expires_at_ms=env::block_timestamp() / 1_000_000 + 86_400_000;
        self.listings.insert(id,Listing{id,seller,item,quantity,unit_price,expires_at_ms});
    }
    pub fn buy_listing(&mut self,listing_id:u32,quantity:u32,expected_unit_price:u32) {
        let buyer=env::predecessor_account_id();let listing=self.listings.get(&listing_id).cloned().unwrap_or_else(||env::panic_str("Listing no longer exists"));
        require!(buyer!=listing.seller,"Cannot buy your own listing");require!(env::block_timestamp() / 1_000_000 < listing.expires_at_ms,"Listing expired");require!(quantity>0 && quantity<=listing.quantity && expected_unit_price==listing.unit_price,"Listing changed or invalid quantity");
        let total=quantity.checked_mul(listing.unit_price).unwrap_or_else(||env::panic_str("Price overflow"));
        let buyer_wallet=self.players.get_mut(&buyer).unwrap_or_else(||env::panic_str("Join the market first"));require!(buyer_wallet.coins>=total,"Insufficient coins");buyer_wallet.coins-=total;
        if listing.item=="timber" {buyer_wallet.timber+=quantity;} else {buyer_wallet.bread+=quantity;}
        self.players.get_mut(&listing.seller).unwrap_or_else(||env::panic_str("Seller unavailable")).coins+=total;
        if quantity==listing.quantity {self.listings.remove(&listing_id);} else {self.listings.get_mut(&listing_id).unwrap().quantity-=quantity;}
    }
    /// Anyone can clear an expired listing; escrow always goes back to its seller.
    pub fn reclaim_expired(&mut self,listing_id:u32) {
        let listing=self.listings.get(&listing_id).cloned().unwrap_or_else(||env::panic_str("Listing no longer exists"));
        require!(env::block_timestamp() / 1_000_000 >= listing.expires_at_ms,"Listing has not expired");
        let player=self.players.get_mut(&listing.seller).unwrap_or_else(||env::panic_str("Seller unavailable"));
        if listing.item=="timber" {player.timber+=listing.quantity;} else {player.bread+=listing.quantity;}self.listings.remove(&listing_id);
    }
    pub fn cancel_listing(&mut self,listing_id:u32) {
        let seller=env::predecessor_account_id();let listing=self.listings.get(&listing_id).cloned().unwrap_or_else(||env::panic_str("Listing no longer exists"));
        require!(listing.seller==seller,"Only the seller can cancel");let player=self.players.get_mut(&seller).unwrap_or_else(||env::panic_str("Seller unavailable"));
        if listing.item=="timber" {player.timber+=listing.quantity;} else {player.bread+=listing.quantity;}self.listings.remove(&listing_id);
    }
}

#[cfg(test)]
mod tests {
 use super::*;
 use near_sdk::{testing_env,test_utils::VMContextBuilder};
 fn caller(id:&str){let mut context=VMContextBuilder::new();context.predecessor_account_id(id.parse().unwrap());testing_env!(context.build());}
 #[test] fn shared_pricing_vectors_match_browser(){
  let vectors:near_sdk::serde_json::Value=near_sdk::serde_json::from_str(include_str!("../../../shared/legacy/aethelgard/observer/market-quote-vectors.json")).unwrap();
  for row in vectors.as_array().unwrap(){let n=|key:&str| row[key].as_u64().unwrap() as u32;let (bid,ask)=quote(n("base"),n("stock"),n("target"),n("demand"));assert_eq!((bid,ask),(n("bid"),n("ask")));}
 }
 #[test] fn whole_economy_turns_match_shared_browser_vectors(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();
  let rows:near_sdk::serde_json::Value=near_sdk::serde_json::from_str(include_str!("../../../shared/legacy/aethelgard/observer/market-turn-vectors.json")).unwrap();
  for row in rows.as_array().unwrap(){let action=row["action"].as_str().unwrap();if action=="next-day" {let mut c=VMContextBuilder::new();c.predecessor_account_id("alice.testnet".parse().unwrap()).block_timestamp(60_000_000_000);testing_env!(c.build());}
   m.act(action.into(),0,None);let snap=m.get_market("alice.testnet".parse().unwrap());let p=snap.player.unwrap();let t=snap.town;
   let checks=[("coins",p.coins),("timber",p.timber),("bread",p.bread),("energy",p.energy),("forest",t.forest),("merchant_timber",t.merchant_timber),("merchant_coins",t.merchant_coins),("bakery_bread",t.bakery_bread),("bakery_coins",t.bakery_coins),("timber_demand",t.timber_demand),("bread_demand",t.bread_demand),("day",t.day),("supplier_coins",m.supplier_coins),("fed",m.last_fed),("unfed",m.last_unfed),("household_coins",m.households.iter().map(|h|h.coins).sum()),("timber_bid",snap.timber_bid),("timber_ask",snap.timber_ask),("bread_bid",snap.bread_bid),("bread_ask",snap.bread_ask)];
   for (key,value) in checks {assert_eq!(value as u64,row[key].as_u64().unwrap(),"{action}: {key}");}
  }
 }
 #[test] fn quote_reacts_to_scarcity_and_demand(){let low=quote(5,1,6,0);let high=quote(5,15,6,0);assert!(low.0>high.0);assert!(quote(5,6,6,6).1>quote(5,6,6,0).1);assert!(low.1>low.0);}
 #[test] fn shared_stock_and_wallets_conserve_trades_and_keep_deliveries_scoped(){
  caller("alice.testnet");let mut market=EaldholtMarket::new();market.join();market.act("gather".into(),0,None);
  let before=market.get_market("alice.testnet".parse().unwrap());market.act("sell-timber".into(),before.timber_bid,None);
  let after=market.get_market("alice.testnet".parse().unwrap());assert_eq!(after.player.as_ref().unwrap().coins,before.player.as_ref().unwrap().coins+before.timber_bid);assert_eq!(after.town.merchant_coins,before.town.merchant_coins-before.timber_bid);
  caller("bob.testnet");market.join();let bob=market.get_market("bob.testnet".parse().unwrap());assert_eq!(bob.town.merchant_timber,after.town.merchant_timber);assert_eq!(bob.player.unwrap().coins,16);
  caller("alice.testnet");market.act("gather".into(),0,None);market.act("gather".into(),0,None);market.act("gather".into(),0,None);market.act("buy-bread".into(),20,None);market.act("eat".into(),0,None);market.act("gather".into(),0,None);market.act("gather".into(),0,None);
  // Alice sold one; buy it back under the on-chain quote before donating.
  let ask=market.get_market("alice.testnet".parse().unwrap()).timber_ask;market.act("buy-timber".into(),ask,None);
  let world="a".repeat(64);market.act("donate-timber".into(),0,Some(world.clone()));let end=market.get_market("alice.testnet".parse().unwrap());assert_eq!(end.player.unwrap().timber,0);assert_eq!(end.deliveries.len(),1);assert_eq!(end.deliveries[0].world_hash,world);assert_eq!(end.deliveries[0].timber,12);
  assert!(market.get_market("bob.testnet".parse().unwrap()).deliveries.is_empty());
 }
 #[test] fn marketplace_escrows_transfers_and_returns_inventory_without_minting(){
  caller("alice.testnet");let mut market=EaldholtMarket::new();market.join();market.act("gather".into(),0,None);market.act("gather".into(),0,None);
  market.create_listing("timber".into(),4,3);let alice:AccountId="alice.testnet".parse().unwrap();let bob:AccountId="bob.testnet".parse().unwrap();
  assert_eq!(market.get_market(alice.clone()).player.unwrap().timber,0);assert_eq!(market.get_market(alice.clone()).listings[0].quantity,4);
  caller("bob.testnet");market.join();market.buy_listing(1,2,3);let b=market.get_market(bob);assert_eq!(b.player.unwrap().coins,10);assert_eq!(b.listings[0].quantity,2);
  let a=market.get_market(alice.clone());assert_eq!(a.player.unwrap().coins,22);
  caller("alice.testnet");market.cancel_listing(1);let a=market.get_market(alice);assert_eq!(a.player.unwrap().timber,2);assert!(a.listings.is_empty());
 }
 #[test] fn expired_escrow_can_be_returned_by_anyone_without_giving_it_to_the_caller(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),2,5);
  caller("bob.testnet");m.join();let mut context=VMContextBuilder::new();context.predecessor_account_id("bob.testnet".parse().unwrap()).block_timestamp(86_400_000_000_000);testing_env!(context.build());
  m.reclaim_expired(1);assert!(m.listings.is_empty());assert_eq!(m.players.get(&"alice.testnet".parse::<AccountId>().unwrap()).unwrap().timber,2);assert_eq!(m.players.get(&"bob.testnet".parse::<AccountId>().unwrap()).unwrap().timber,0);
 }
 #[test] #[should_panic(expected="Listing expired")] fn expired_listing_cannot_be_purchased(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),1,5);
  caller("bob.testnet");m.join();let mut context=VMContextBuilder::new();context.predecessor_account_id("bob.testnet".parse().unwrap()).block_timestamp(86_400_000_000_000);testing_env!(context.build());m.buy_listing(1,1,5);
 }
 #[test] #[should_panic(expected="Listing has not expired")] fn cannot_reclaim_a_live_listing(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),1,5);m.reclaim_expired(1);
 }
 #[test] #[should_panic(expected="stall full")] fn full_timber_stall_rejects_sales(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.town.merchant_timber=20;m.act("sell-timber".into(),0,None);
 }
 #[test] #[should_panic(expected="Listing changed")] fn stale_listing_price_is_rejected(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),1,5);
  caller("bob.testnet");m.join();m.buy_listing(1,1,4);
 }
 #[test] #[should_panic(expected="Only the seller")] fn another_player_cannot_cancel_listing(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),1,5);
  caller("bob.testnet");m.join();m.cancel_listing(1);
 }
 #[test] #[should_panic(expected="Insufficient coins")] fn buyer_cannot_overspend(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("gather".into(),0,None);m.create_listing("timber".into(),1,20);
  caller("bob.testnet");m.join();m.buy_listing(1,1,20);
 }
 #[test] fn household_demand_is_paid_from_finite_wallets_and_real_stock(){
  caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();
  let sum=|m:&EaldholtMarket|m.town.merchant_coins+m.town.bakery_coins+m.supplier_coins+m.players.values().map(|p|p.coins).sum::<u32>()+m.households.iter().map(|h|h.coins).sum::<u32>();
  let before=sum(&m);let mut context=VMContextBuilder::new();context.predecessor_account_id("alice.testnet".parse().unwrap()).block_timestamp(60_000_000_000);testing_env!(context.build());m.act("next-day".into(),0,None);assert_eq!(sum(&m),before);assert_eq!((m.last_fed,m.last_unfed),(10,15));assert_eq!(m.town.bakery_bread,0);
  m.act("gather".into(),0,None);m.act("bake".into(),0,None);let price=m.get_market("alice.testnet".parse().unwrap()).bread_bid;
  m.act("sell-bread".into(),price,None);assert_eq!(m.town.bakery_bread,1);assert_eq!(sum(&m),before);
 }
 #[test] #[should_panic(expected="Market day cooldown")] fn shared_day_cannot_be_fast_forwarded_without_time_passing(){caller("alice.testnet");let mut m=EaldholtMarket::new();m.join();m.act("next-day".into(),0,None);}
 #[test] #[should_panic(expected="Price changed")] fn stale_buy_quote_rejects(){caller("alice.testnet");let mut market=EaldholtMarket::new();market.join();market.act("buy-bread".into(),0,None);}
}
