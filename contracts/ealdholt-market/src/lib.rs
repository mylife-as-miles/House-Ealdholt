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
#[near(serializers = [json])]
pub struct Snapshot { pub player:Option<Player>,pub town:Town,pub timber_bid:u32,pub timber_ask:u32,pub bread_ask:u32,pub deliveries:Vec<Delivery> }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct EaldholtMarket { town:Town, players:BTreeMap<AccountId,Player>, deliveries:BTreeMap<AccountId,Vec<Delivery>> }

#[near]
impl EaldholtMarket {
    #[init]
    pub fn new()->Self {Self{town:Town::default(),players:BTreeMap::new(),deliveries:BTreeMap::new()}}
    pub fn get_market(&self,account_id:AccountId)->Snapshot {
        let (bid,ask)=quote(5,self.town.merchant_timber,6,self.town.timber_demand);
        let (_,bread)=quote(4,self.town.bakery_bread,8,self.town.bread_demand);
        Snapshot{player:self.players.get(&account_id).cloned(),town:self.town.clone(),timber_bid:bid,timber_ask:ask,bread_ask:bread,deliveries:self.deliveries.get(&account_id).cloned().unwrap_or_default()}
    }
    /// One bounded starter wallet per NEAR account. This is game credit, not NEAR or a transferable token.
    pub fn join(&mut self) {let id=env::predecessor_account_id();require!(!self.players.contains_key(&id),"Already joined");require!(self.players.len()<32,"Market is full");self.players.insert(id,Player::default());}
    pub fn act(&mut self,action:String,limit:u32,world_hash:Option<String>){
        let id=env::predecessor_account_id();let p=self.players.get_mut(&id).unwrap_or_else(||env::panic_str("Join the market first"));
        let t=&mut self.town;
        match action.as_str() {
            "gather"=>{require!(p.energy>0 && t.forest>=2,"Need energy and timber in the commons");p.energy-=1;t.forest-=2;p.timber+=2;},
            "sell-timber"=>{let (price,_)=quote(5,t.merchant_timber,6,t.timber_demand);require!(price>=limit && p.timber>=1 && t.merchant_coins>=price,"Price changed, timber missing or merchant cannot pay");p.timber-=1;t.merchant_timber+=1;p.coins+=price;t.merchant_coins-=price;},
            "buy-timber"=>{let (_,price)=quote(5,t.merchant_timber,6,t.timber_demand);require!(price<=limit && t.merchant_timber>=1 && p.coins>=price,"Price changed, stock missing or insufficient coins");p.coins-=price;t.merchant_coins+=price;t.merchant_timber-=1;p.timber+=1;t.timber_demand=t.timber_demand.saturating_add(1).min(1_000_000);},
            "buy-bread"=>{let (_,price)=quote(4,t.bakery_bread,8,t.bread_demand);require!(price<=limit && t.bakery_bread>=1 && p.coins>=price,"Price changed, bread missing or insufficient coins");p.coins-=price;t.bakery_coins+=price;t.bakery_bread-=1;p.bread+=1;t.bread_demand=t.bread_demand.saturating_add(1).min(1_000_000);},
            "eat"=>{require!(p.bread>=1 && p.energy<=6,"Need bread and room for energy");p.bread-=1;p.energy+=2;},
            "next-day"=>{require!(t.day<1000,"Market day limit reached");t.day+=1;p.energy=(p.energy+1).min(8);t.timber_demand/=2;t.bread_demand/=2;if t.bakery_coins>=3 && t.bakery_bread<=18 {t.bakery_coins-=3;t.bakery_bread+=2;}},
            "donate-timber"=>{let world=world_hash.unwrap_or_default();require!(world.len()==64 && world.bytes().all(|c|c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),"Expected lowercase world hash");require!(p.timber>=12,"Need 12 timber");let records=self.deliveries.entry(id).or_default();require!(records.len()<64,"Delivery limit reached");p.timber-=12;p.next_delivery+=1;records.push(Delivery{id:p.next_delivery,world_hash:world,timber:12});},
            _=>env::panic_str("Unknown action"),
        }
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
 #[test] #[should_panic(expected="Price changed")] fn stale_buy_quote_rejects(){caller("alice.testnet");let mut market=EaldholtMarket::new();market.join();market.act("buy-bread".into(),0,None);}
}
