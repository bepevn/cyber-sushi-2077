/* Pure deterministic rules; shared by browser and Node tests. No DOM or network. */
(function(root){
'use strict';
class GameError extends Error {}
class Engine {
 constructor(catalog){this.c=catalog;this.e=catalog.economy;this.by=Object.fromEntries(catalog.ingredients.map(x=>[x.id,x]));}
 cost(mix){return Object.entries(mix).reduce((s,[k,v])=>s+this.by[k].cost*v,0);}
 signature(mix){return Object.keys(mix).filter(k=>mix[k]>0).sort().map(k=>k+':'+mix[k]).join('|');}
 recipes(day=60){
  const out=this.c.recipes.map(r=>({...r,price:r.price??Math.round(this.cost(r.ingredients)*this.e.extraMarkup+3*this.e.extraStagePremium)}));
  const seen=new Set(out.map(r=>this.signature(r.ingredients))),ex=this.c.expansion;
  const keys=this.c.ingredients.filter(x=>x.id!=='rice').map(x=>x.id);let n=0;
  for(let rice=1;rice<=ex.maxRice;rice++)for(let mask=1;mask<(1<<keys.length);mask++){
   const parts=keys.filter((_,i)=>mask&(1<<i)); if(parts.length>ex.maxOtherIngredients)continue;
   const ingredients={rice,...Object.fromEntries(parts.map(k=>[k,1]))};const sig=this.signature(ingredients);if(seen.has(sig))continue;
   const unlock=ex.startDay+n*ex.interval;if(unlock>day)return out;
   n++;seen.add(sig);out.push({id:'extra-'+n,name:ex.prefix+' '+String(n).padStart(3,'0')+' · '+parts.map(k=>this.by[k].name).join('·'),day:unlock,ingredients,price:Math.round(this.cost(ingredients)*this.e.extraMarkup+3*this.e.extraStagePremium),difficulty:ex.difficulty,style:ex.style});
  }return out;
 }
 menu(s,id){return this.recipes(s.day).find(r=>r.id===id);}
 unlocked(day){return this.recipes(day).filter(r=>r.day<=day);}
 ledger(day){return {day,sales:0,tips:0,purchases:0,cost:0,satisfied:0,dissatisfied:0};}
 totals(l){return {...l,profit:l.sales+l.tips-l.cost,cashflow:l.sales+l.tips-l.purchases};}
 fresh(seed=Date.now()){
  const s={schema:1,revision:0,day:1,phase:'prep',cash:this.e.startingCash,inventory:Object.fromEntries(this.c.ingredients.map(i=>[i.id,this.e.startingInventory[i.id]||0])),complaints:0,unlocked:this.unlocked(1).map(r=>r.id),queue:[],index:0,elapsed:0,cooking:null,dish:null,deliveries:[],history:[],ledger:this.ledger(1),stats:{sales:0,tips:0,cost:0,served:0},settings:{muted:false},tutorial:true,tutorialStep:0,seed:seed>>>0,events:[],lastResult:null};return s;
 }
 rand(s){s.seed=(Math.imul(s.seed,1664525)+1013904223)>>>0;return s.seed/4294967296;}
 once(s,id,fn){if(!id)throw new GameError('이벤트 ID가 없습니다.');if(s.events.includes(id))return false;fn();s.events.push(id);if(s.events.length>512)s.events.shift();return true;}
 startDay(s,id){return this.once(s,id,()=>{
  if(s.phase!=='prep')throw new GameError('영업 준비 중에만 시작할 수 있습니다.');
  if(s.complaints>=this.e.maxComplaints)throw new GameError('게임오버 세이브입니다.');
  const menus=this.unlocked(s.day);s.unlocked=menus.map(r=>r.id);
  s.queue=Array.from({length:Math.min(this.e.maxCustomers,this.e.baseCustomers+s.day-1)},()=>({menu:menus[Math.floor(this.rand(s)*menus.length)].id,patron:Math.floor(this.rand(s)*this.c.patrons.length)}));
  s.index=0;s.elapsed=0;s.phase='service';s.lastResult=null;
 });}
 nextDay(s,id){return this.once(s,id,()=>{if(s.phase!=='summary')throw new GameError('하루 정산 후에만 준비할 수 있습니다.');s.day++;s.phase='prep';s.ledger=this.ledger(s.day);s.unlocked=this.unlocked(s.day).map(r=>r.id);s.queue=[];s.index=0;s.elapsed=0;s.lastResult=null;});}
 buy(s,mix,id,now){return this.once(s,id,()=>{
  if(!['prep','service','summary'].includes(s.phase))throw new GameError('지금은 구매할 수 없습니다.');
  const entries=Object.entries(mix);if(!entries.length||entries.some(([k,v])=>!this.by[k]||!Number.isSafeInteger(v)||v<=0||v>999))throw new GameError('수량은 1~999의 정수여야 합니다.');
  const cost=this.cost(mix);if(cost>s.cash)throw new GameError('크레딧이 부족합니다.');
  s.cash-=cost;
  // After closing, purchases belong to the next business day, not the closed ledger.
  if(s.phase==='summary'){s.pendingPurchases=(s.pendingPurchases||0)+cost;}else s.ledger.purchases+=cost;
  s.deliveries.push({id,mix:{...mix},due:now+this.e.deliverySeconds*1000,serverStamped:false});
 });}
 receive(s,now){const arrived=[];s.deliveries=s.deliveries.filter(d=>{if(d.due>now)return true;for(const[k,v]of Object.entries(d.mix))s.inventory[k]+=v;arrived.push(d.id);return false;});return arrived;}
 begin(s,mix,id){return this.once(s,id,()=>{
  if(s.phase!=='service'||s.cooking||s.dish)throw new GameError('조리대가 비어 있을 때 시작하세요.');
  const entries=Object.entries(mix);if(!entries.length||entries.some(([k,v])=>!this.by[k]||!Number.isInteger(v)||v<1||v>9))throw new GameError('재료를 1개 이상 선택하세요.');
  if(entries.some(([k,v])=>s.inventory[k]<v))throw new GameError('재고가 부족합니다. 배송 중인 재료는 쓸 수 없습니다.');
  const recipe=this.unlocked(s.day).find(r=>this.signature(r.ingredients)===this.signature(mix));
  for(const[k,v]of entries)s.inventory[k]-=v;
  const cost=this.cost(mix);s.ledger.cost+=cost;s.stats.cost+=cost;
  s.cooking={id,mix:{...mix},menu:recipe?.id||null,difficulty:(s.day===1?0.65:(recipe?.difficulty||1)),stage:'cut',time:0,scores:[],cuts:0,bar:0.4,inside:0};
 });}
 cutTarget(c){return 0.5+0.12*Math.sin(c.cuts*2);}
 cutCursor(c){return (Math.sin(c.time*(3.4*c.difficulty)+c.cuts)+1)/2;}
 riceTarget(c){return 0.5+Math.sin(c.time*1.5*c.difficulty)*0.23;}
 plateCursor(c){return (Math.sin(c.time*3*c.difficulty)+1)/2;}
 act(s){const c=s.cooking;if(!c)return;
  if(c.stage==='cut'){c.scores.push(Math.max(0,100-Math.abs(this.cutCursor(c)-this.cutTarget(c))*220*c.difficulty));c.cuts++;c.time=0;if(c.cuts>=3)c.stage='rice';}
  else if(c.stage==='plate'){c.scores.push(Math.max(0,100-Math.abs(this.plateCursor(c)-0.5)*230*c.difficulty));this.finish(s);}
 }
 finish(s){const c=s.cooking;s.dish={mix:c.mix,menu:c.menu,quality:Math.round(c.scores.reduce((a,b)=>a+b,0)/c.scores.length)};s.cooking=null;}
 tick(s,dt,held=false){if(!Number.isFinite(dt)||dt<=0)return null;
  if(s.phase!=='service')return null;
  if(!s.tutorial){s.elapsed+=dt;if(s.elapsed>this.e.customerSeconds){return this.resolve(s,false,'시간 초과');}}
  const c=s.cooking;if(!c)return null;
  // Integrate control in small elapsed-time steps, independent of display FPS.
  let remaining=dt;while(remaining>0&&s.cooking){const step=Math.min(remaining,1/60);remaining-=step;c.time+=step;
   if(c.stage==='cut'&&c.time>=2.7){c.scores.push(0);c.cuts++;c.time=0;if(c.cuts>=3)c.stage='rice';}
   else if(c.stage==='rice'){
    c.bar=Math.max(0,Math.min(1,c.bar+(held?0.58:-0.36)*step));if(Math.abs(c.bar-this.riceTarget(c))<=0.17/c.difficulty)c.inside+=step;
    if(c.time>=6){c.scores.push(Math.min(100,c.inside/6*100));c.stage='plate';c.time=0;}
   }else if(c.stage==='plate'&&c.time>=3.2){c.scores.push(0);this.finish(s);}
  }return null;
 }
 tip(price,quality,seconds){if(seconds>this.e.customerSeconds)return 0;const base=this.e.tipBands.find(([q])=>quality>=q)[1];return Math.round(price*Math.min(this.e.maxTip,base+(seconds<=this.e.fastSeconds?this.e.fastTip:0)));}
 serve(s,id){return this.once(s,id,()=>{if(s.phase!=='service'||!s.dish)throw new GameError('완성된 접시가 없습니다.');this.resolve(s,s.elapsed<=this.e.customerSeconds&&s.dish.menu===s.queue[s.index].menu,s.elapsed>this.e.customerSeconds?'시간 초과':'오주문');});}
 discard(s,id){return this.once(s,id,()=>{if(!s.dish&&!s.cooking)throw new GameError('폐기할 음식이 없습니다.');s.dish=null;s.cooking=null;});}
 resolve(s,ok,reason){
  const order=this.menu(s,s.queue[s.index].menu),quality=s.dish?.quality||0,seconds=s.elapsed;
  const price=ok?order.price:0,tip=ok?this.tip(price,quality,seconds):0;
  s.cash+=price+tip;s.ledger.sales+=price;s.ledger.tips+=tip;s.stats.sales+=price;s.stats.tips+=tip;
  if(ok){s.ledger.satisfied++;s.stats.served++;}else{s.complaints++;s.ledger.dissatisfied++;}
  s.lastResult={ok,reason:ok?'서빙 성공':reason,quality,seconds,price,tip,patron:s.queue[s.index].patron};
  s.index++;s.elapsed=0;s.cooking=null;s.dish=null;
  if(s.complaints>=this.e.maxComplaints){s.phase='gameover';s.history.push(this.totals(s.ledger));}
  else if(s.index>=s.queue.length){s.phase='summary';s.history.push(this.totals(s.ledger));}
  return s.lastResult;
 }
 restore(raw){const s=JSON.parse(JSON.stringify(raw));if(s.schema!==1)throw new GameError('지원하지 않는 세이브 버전입니다.');if(!Number.isFinite(s.cash)||s.cash<0||Object.values(s.inventory).some(v=>!Number.isInteger(v)||v<0))throw new GameError('세이브 검증에 실패했습니다.');if(s.complaints>=this.e.maxComplaints)s.phase='gameover';return s;}
 prepare(s,id){const pending=s.pendingPurchases||0;this.nextDay(s,id);if(s.phase==='prep'){s.ledger.purchases+=pending;s.pendingPurchases=0;}}
}
if(typeof module!=='undefined')module.exports={Engine,GameError};else root.SushiEngine=Engine;
})(typeof window!=='undefined'?window:globalThis);
