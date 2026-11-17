// Deterministic economic simulation using the same engine as the shipped game.
const fs=require('fs');const {Engine}=require('../frontend/engine.js');const E=new Engine(require('../frontend/catalog.json'));
const reports=[];
for(const quality of [0,80,95]){
 let lowest=300,purchases=0;const s=E.fresh(20261116);s.tutorial=false;
 for(let day=1;day<=120;day++){
  if(day>1)E.prepare(s,'prepare-'+day);
  E.startDay(s,'open-'+day);
  // Buy each order's shortage on demand; assume 30s delivery + 20s cooking.
  // This tests solvency, not a player knowing tomorrow's random orders.
  while(s.phase==='service'){
   const id=day+'-'+s.index,r=E.menu(s,s.queue[s.index].menu),mix={};
   for(const[k,v]of Object.entries(r.ingredients))if(s.inventory[k]<v)mix[k]=v-s.inventory[k];
   if(Object.keys(mix).length){const cash=s.cash;E.buy(s,mix,'buy-'+id,0);purchases+=cash-s.cash;lowest=Math.min(lowest,s.cash);E.receive(s,30000);s.elapsed=50;}else s.elapsed=20;
   E.begin(s,r.ingredients,'cook-'+id);
   // Quality is the scenario assumption; economics still consumes real ingredients.
   s.dish={menu:r.id,mix:r.ingredients,quality};s.cooking=null;E.serve(s,'serve-'+id);
  }
  if(s.phase!=='summary')throw Error('Unexpected bankruptcy/gameover');
 }
 reports.push({days:120,quality,minimumCash:lowest,endingCash:s.cash,foodSales:s.stats.sales,tips:s.stats.tips,purchases,consumedCost:s.stats.cost,operatingProfit:s.stats.sales+s.stats.tips-s.stats.cost,served:s.stats.served});
}
fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/economy.json',JSON.stringify({assumptions:'Correct orders only; shortage purchases arrive after 30 seconds; 20 second cooking; no discards. Does not prove human difficulty balance.',reports},null,2));console.log(JSON.stringify(reports,null,2));
