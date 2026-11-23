/* Streamlit component protocol; real-time loop remains entirely in this iframe. */
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=()=>crypto.randomUUID();
const DEMO='cyber-sushi-demo-v1', AUTH='cyber-sushi-auth-v1';
let C,E,S=null,view='menu',config={cloud:false},auth=null,ready=false,initAuth=false;
let selected={},held=false,paused=true,pending=null,saveError=false,revision=0,logoutRequested=false;
let lastFrame=performance.now(),lastSave=0,serverAt=0,serverPerf=0,toastUntil=0,lastVisual='',lockRelease=null,hasLock=false;
let audio=null,muted=true,tab;
try{tab=sessionStorage.getItem('cs-tab')||uuid();sessionStorage.setItem('cs-tab',tab);}catch{tab=uuid();}
// Duplicated tabs inherit sessionStorage. An existing live iframe makes the new tab rotate its ID.
let tabChannel;
try{tabChannel=new BroadcastChannel('cs-tab-identity');const instance=uuid();tabChannel.onmessage=e=>{const m=e.data;if(m.tab!==tab||m.instance===instance)return;if(m.kind==='probe')tabChannel.postMessage({kind:'occupied',tab,instance,target:m.instance});else if(m.kind==='occupied'&&m.target===instance){tab=uuid();sessionStorage.setItem('cs-tab',tab);}};tabChannel.postMessage({kind:'probe',tab,instance});}catch{}
const screen=$('#screen');
function parentMessage(type,extra={}){window.parent.postMessage({isStreamlitMessage:true,type,...extra},'*');}
function height(){parentMessage('streamlit:setFrameHeight',{height:Math.max(760,document.body.scrollHeight+5)});}
new ResizeObserver(height).observe(document.body);
function status(text,error=false){$('#saveStatus').textContent=text;$('#saveStatus').style.color=error?'#ff9ab9':'';$('#retry').hidden=!error;}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');toastUntil=performance.now()+4200;}
function beep(type='ok'){
 if(muted)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.type='sine';o.frequency.setValueAtTime(type==='bad'?160:660,audio.currentTime);o.frequency.exponentialRampToValueAtTime(type==='bad'?85:990,audio.currentTime+.13);g.gain.setValueAtTime(.045,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.2);o.start();o.stop(audio.currentTime+.21);}catch{}
}
function serverNow(){return auth&&serverAt?serverAt+(performance.now()-serverPerf):Date.now();}
function loadDemo(){try{const raw=localStorage.getItem(DEMO);return raw?E.restore(JSON.parse(raw)):null;}catch{toast('로컬 저장을 읽을 수 없습니다. 브라우저 저장 권한을 확인하세요.');return null;}}
async function acquire(){
 if(auth||hasLock)return true;
 if(!navigator.locks){toast('이 브라우저는 안전한 다중 탭 잠금을 지원하지 않습니다. 최신 Chrome/Edge/Firefox에서 실행하세요.');return false;}
 return new Promise(resolve=>navigator.locks.request('cyber-sushi-demo',{ifAvailable:true},lock=>{
  if(!lock){toast('다른 탭에서 로컬 데모를 실행 중입니다. 먼저 닫아 주세요.');resolve(false);return;}
  hasLock=true;resolve(true);return new Promise(done=>{lockRelease=()=>{hasLock=false;done();};});
 }));
}
function backup(){try{if(S)localStorage.setItem(auth?'cs-backup-'+auth.localId:DEMO,JSON.stringify(S));return true;}catch{status('저장 실패: 브라우저 저장 공간 확인',true);saveError=true;paused=true;return false;}}
function send(action,state=null){
 if(pending)return;
 const id=uuid();pending={id,opId:id,action,tab,token:auth.idToken,revision,...(state?{state:JSON.parse(JSON.stringify(state))}:{})};
 status(action==='load'?'불러오는 중…':'저장 중…');saveError=false;parentMessage('streamlit:setComponentValue',{value:pending,dataType:'json'});lastSave=performance.now();
}
function checkpoint(){
 if(!S)return;
 if(auth){backup();if(!pending)send('save',S);}
 else if(backup()){status('로컬 저장 완료');saveError=false;lastSave=performance.now();}
}
async function refreshToken(){
 if(!auth||Date.now()<auth.expiresAt-90000)return;
 const r=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refreshToken})});
 const d=await r.json();if(!r.ok)throw Error('로그인 갱신에 실패했습니다. 다시 로그인해 주세요.');
 auth.idToken=d.id_token;auth.refreshToken=d.refresh_token;auth.expiresAt=Date.now()+Number(d.expires_in)*1000;sessionStorage.setItem(AUTH,JSON.stringify(auth));
}
async function retry(){
 if(!auth){saveError=false;checkpoint();paused=view==='menu';return;}
 if(!pending)return;try{await refreshToken();pending.id=uuid();pending.token=auth.idToken;saveError=false;status('다시 저장 중…');parentMessage('streamlit:setComponentValue',{value:pending,dataType:'json'});lastSave=performance.now();}catch(e){toast(e.message);}
}
function response(r){
 if(!pending||r.id!==pending.id)return;
 if(!r.ok){saveError=true;status('저장 실패 · 진행 일시 정지',true);toast(r.error);return;}
 const action=pending.action;pending=null;saveError=false;revision=r.revision;serverAt=r.now;serverPerf=performance.now();
 if(action==='release'){finishLogout();return;}
 if(r.state){const oldDelivery=S?.deliveries.length||0;S=E.restore(r.state);if(S.deliveries.length<oldDelivery){toast('드론 배송 도착 · 재고에 반영했습니다.');beep();}muted=S.settings.muted;}
 else if(action==='load')S=null;
 status('클라우드 저장 완료');lastSave=performance.now();
 if(logoutRequested){send('release');return;}
 if(action==='load'){view='menu';paused=true;}
 render();
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.data?.type!=='streamlit:render')return;
 config=event.data.args.config||config;
 if(ready){if(event.data.args.response)response(event.data.args.response);bootstrapAuth();updateHeader();}
});
async function bootstrapAuth(){
 if(initAuth||!ready)return;initAuth=true;
 await new Promise(resolve=>setTimeout(resolve,180));
 if(config.cloud){try{auth=JSON.parse(sessionStorage.getItem(AUTH)||'null');if(auth){await refreshToken();send('load');}}catch{auth=null;toast('로그인이 만료되었습니다. 다시 로그인하세요.');}}
 updateHeader();
}
function updateHeader(){
 $('#mode').textContent=auth?'CLOUD SAVE':'LOCAL DEMO';$('#network').textContent=auth?'Firebase · 사용자별 클라우드 저장':'이 브라우저의 로컬 저장 · 클라우드와 별개';$('#sound').textContent=muted?'SOUND OFF':'SOUND ON';
}
function guarded(fn){return (...args)=>{if(pending||saveError){toast('저장 완료를 기다리거나 저장 재시도를 선택하세요.');return;}try{fn(...args);}catch(e){toast(e.message);beep('bad');}};}
function action(fn){return guarded(()=>{fn();checkpoint();render();});}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').hidden=false;held=false;height();}
function closeModal(){$('#modal').hidden=true;held=false;}
$('#closeModal').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
$('#retry').onclick=retry;
$('#brand').onclick=e=>{e.preventDefault();openMenu();};$('#menuBtn').onclick=()=>openMenu();
$('#sound').onclick=guarded(()=>{muted=!muted;if(S){S.settings.muted=muted;checkpoint();}updateHeader();if(!muted)beep();});
function openMenu(){if(pending&&!saveError){toast('저장 요청 처리 중입니다. 잠시 기다려 주세요.');return;}paused=true;view='menu';held=false;if(!saveError)checkpoint();render();}
async function newGame(){
 if(pending||saveError)return toast('저장 요청을 먼저 완료하세요.');
 const existing=auth?S:loadDemo();
 if(existing){modal('<h2>새로운 야간 근무</h2><p>기존 '+(auth?'클라우드':'로컬 데모')+' 세이브를 덮어씁니다. 이 작업은 되돌릴 수 없습니다.</p><div class="action-row"><button id="cancelNew">취소</button><button id="confirmNew" class="danger">기존 저장을 덮어쓰고 시작</button></div>');$('#cancelNew').onclick=closeModal;$('#confirmNew').onclick=()=>startNew();}
 else await startNew();
}
async function startNew(){if(!await acquire())return;closeModal();S=E.fresh();S.settings.muted=muted;selected={};view='game';paused=false;E.startDay(S,uuid());checkpoint();render();}
async function continueGame(){if(pending||saveError)return toast('저장 요청을 먼저 완료하세요.');if(!await acquire())return;if(!auth)S=loadDemo();if(!S)return toast('이어할 저장이 없습니다. 새 게임을 시작하세요.');view='game';paused=false;muted=S.settings.muted;render();}
function menuHTML(){const exists=auth?!!S:!!loadDemo();return `<section class="menu-hero"><canvas class="city" id="city"></canvas><div class="hero-shade"></div><div class="hero-copy"><div class="eyebrow">A SMALL KITCHEN. A NEON CITY.</div><h1>CYBER<span>SUSHI</span></h1><p>잠들지 않는 도시, 마지막 따뜻한 한 접시.<br>칼을 잡고 오늘 밤의 손님을 맞이하세요.</p><div class="menu-buttons"><button class="primary" id="newGame">새 게임 / OPEN THE SHOP</button><button id="continue" ${!exists?'disabled':''}>이어하기${S?' · DAY '+S.day:''}</button><button id="help">조작법</button><button id="settings">설정</button><button id="login">${auth?'계정 / 로그아웃':'로그인'}</button></div><p style="font-size:11px;margin-top:20px">${auth?'클라우드 모드 · '+esc(auth.email):'LOCAL DEMO — 회원가입 없이 바로 플레이<br>데모 진행은 이 브라우저에만 저장됩니다.'}</p>${auth?'<button class="small ghost" id="reloadCloud">클라우드 다시 불러오기</button>':''}</div><div class="hero-caption">OPEN UNTIL THE CITY SLEEPS<br><small>寿司 / SECTOR 07</small></div></section>`;}
function ingredientsText(mix){return Object.entries(mix).map(([k,v])=>C.ingredients.find(i=>i.id===k).name+' '+v).join(' + ');}
function foodIcon(i){return `<i class="food-icon" data-id="${i.id}" style="--food:${i.color}"></i>`;}
function statsHTML(){return `<div class="stats"><div class="stat"><small>NIGHT SHIFT</small><b>DAY ${S.day}</b></div><div class="stat cash"><small>CREDITS</small><b>${S.cash.toLocaleString()} C</b></div><div class="stat bad"><small>COMPLAINTS</small><b>${S.complaints} / ${E.e.maxComplaints}</b></div></div>`;}
function deliveryHTML(){return `<section class="panel deliveries"><div class="panel-head"><span>DRONE LOGISTICS / 배송 현황</span><button class="small" id="shop">재료 주문</button></div><div class="delivery-list" id="deliveryList"></div></section>`;}
function deliveryUpdate(){const el=$('#deliveryList');if(!el||!S)return;el.innerHTML=S.deliveries.length?S.deliveries.map(d=>`<span class="delivery-item">${esc(ingredientsText(d.mix))} · <b>${Math.max(0,Math.ceil((d.due-serverNow())/1000))}s</b></span>`).join(''):'배송 중인 주문 없음 · 주문 후 30초 뒤 도착';}
const guides=[['재료를 직접 골라요','카운터에서 주문 받기를 누르고 주방으로 이동하세요. 주문서를 보고 트레이에서 재료를 선택하세요. 같은 재료를 여러 번 누르면 수량이 늘어납니다.'],['칼질 타이밍','조리 시작 후 밝은 막대가 청록 구간 중앙에 올 때 클릭 또는 SPACE. 총 3번입니다.'],['밥을 쥐어요','버튼 또는 SPACE를 누르고 있으면 막대가 올라가고, 놓으면 내려갑니다. 움직이는 청록 구간을 6초간 따라가세요.'],['플레이팅과 서빙','토핑을 올린 뒤 포장하고 카운터로 이동하세요. 포장 상자를 손님 전달 영역으로 드래그해 놓으세요. 틀린 재료 조합도 요리가 되지만 손님은 떠납니다.'],['재료 구매','배송 현황의 재료 주문에서 수량을 입력해 구매하세요. 현금은 즉시 차감되고 30초 뒤 재고가 됩니다.'],['영업 시작 준비 완료','안내를 마치면 손님당 90초가 적용됩니다. 메뉴에서는 일시 정지, 주문·도감 패널에서는 계속 흐릅니다.']];
function guideHTML(){if(!S.tutorial)return '';const g=guides[S.tutorialStep];return `<div class="guide"><div><strong>TUTORIAL ${S.tutorialStep+1}/6 · ${g[0]}</strong><br>${g[1]}<br><span class="muted">튜토리얼 중 손님 타이머 정지 · 조리는 실제로 진행됩니다.</span></div><div class="tools"><button class="small" id="guideNext">${S.tutorialStep===5?'안내 마치기':'다음'}</button><button class="small ghost" id="guideSkip">건너뛰기</button></div></div>`;}
function resultHTML(){if(!S.lastResult)return '';const r=S.lastResult,p=C.patrons[r.patron];return `<div class="result-banner ${r.ok?'':'fail'}"><b>${r.reason}</b> · 품질 ${r.quality}점 · ${r.seconds.toFixed(1)}초 · 판매 ${r.price}C + 팁 ${r.tip}C<br>“${esc(r.ok?p.happy:p.angry)}”</div>`;}
function kitchenHTML(){
 const c=S.cooking,d=S.dish;
 let bench='<div class="empty-board">재료를 선택하고 조리를 시작하세요</div>';
 if(c){const title={cut:'01 / 칼질 · '+(c.cuts+1)+'번째',rice:'02 / 밥 쥐기',plate:'03 / 토핑 플레이팅'}[c.stage];bench=`<div class="mini"><div class="mini-title">${title}</div><div class="stage-pips"><i class="on"></i><i class="${c.stage!=='cut'?'on':''}"></i><i class="${c.stage==='plate'?'on':''}"></i></div><div class="gauge ${c.stage==='rice'?'rice-gauge':''}"><div class="target" id="target"></div><div class="cursor" id="cursor"></div></div><button id="miniAction" class="primary">${c.stage==='rice'?'길게 누르기 / 놓기':'타이밍 맞추기 · SPACE'}</button><div class="mini-hint" id="miniHint"></div></div>`;}
 else if(d)bench='<canvas class="dish-canvas" id="dishCanvas"></canvas>';
 return `<div class="panel"><div class="panel-head"><span>PREP STATION / 조리대</span><span>${c?'COOKING':d?'READY TO SERVE':'SELECT INGREDIENTS'}</span></div><div class="kitchen-body"><div class="bench"><span class="bench-label">${d?'QUALITY '+d.quality+' / 100':'HANDCRAFTED · NOT AUTOMATED'}</span>${bench}</div><div class="ingredient-grid">${C.ingredients.map(i=>`<button class="ingredient ${(selected[i.id]||0)?'selected':''}" data-ing="${i.id}" ${c||d?'disabled':''}>${foodIcon(i)}<span>${i.name}<small>재고 ${S.inventory[i.id]} · ${i.cost}C</small></span>${selected[i.id]?'<b>×'+selected[i.id]+'</b>':''}</button>`).join('')}</div><div class="ingredient-info"><span>${Object.keys(selected).length?esc(ingredientsText(selected)):'선택한 재료 없음'}</span><button id="clearMix" class="small ghost" ${c||d?'disabled':''}>선택 초기화</button></div><div class="action-row"><button id="begin" class="primary" ${c||d?'disabled':''}>조리 시작</button><button id="packFood" class="primary" ${!d?'disabled':''}>포장하고 카운터로</button><button id="discard" ${!c&&!d?'disabled':''}>폐기</button></div></div></div>`;
}

function serviceHTML(){
 if(S.roomIndex!==S.index||S.roomDay!==S.day){S.roomDay=S.day;S.roomIndex=S.index;S.room='counter';S.acceptedIndex=null;S.packed=false;}
 S.room=S.room||'counter';
 let html=originalServiceHTML();
 const accepted=S.acceptedIndex===S.index;
 const nav=`<nav class="room-nav" aria-label="매장 이동"><button id="goCounter" class="${S.room==='counter'?'active':''}">01 · 카운터</button><span class="route-line">주문 접수 → 주방 조리 → 포장 → 전달</span><button id="goKitchen" class="${S.room==='kitchen'?'active':''}">02 · 주방으로 이동 →</button></nav>`;
 html=html.replace('<div class="game-grid">',`${nav}<div class="game-grid scene-floor room-${S.room}">`);
 const parcel=S.dish&&S.packed?`<div class="handoff"><div id="dropZone" class="drop-zone" role="button" tabindex="0" aria-label="손님에게 포장 음식 전달">손님에게 전달<br><small>포장 음식을 이곳에 놓으세요</small></div><button id="parcel" class="parcel" aria-label="포장 음식 집기, 방향키 대신 엔터로 선택 후 손님 영역에서 엔터"><i class="parcel-band"></i><b>CYBER SUSHI</b><small>QUALITY ${S.dish.quality} · DRAG TO SERVE</small></button><p class="muted">마우스·터치로 포장 상자를 끌어 손님 영역에 놓으세요.<br>키보드: 상자에서 Enter → 전달 영역에서 Enter</p></div>`:'';
 html=html.replace('<canvas class="patron-scene"',`<canvas class="patron-scene"`);
 html=html.replace('<div class="order-wrap">',`<div class="order-wrap"><div class="counter-actions">${accepted?'<span class="order-stamp">ORDER ACCEPTED · 주문 접수 완료</span>':'<button id="takeOrder" class="primary">주문 받기</button>'}</div>${parcel}`);
 html=html.replace('PREP STATION / 조리대','BACK KITCHEN / 주방');
 const order=E.menu(S,S.queue[S.index].menu);
 if(S.room==='kitchen')html=html.replace('<div class="kitchen-body">',`<div class="kitchen-body"><div class="note"><b>주문서 · ${esc(order.name)}</b><br>${ingredientsText(order.ingredients)}<br>남은 시간 <strong id="kitchenTimer"></strong></div>`);
 html=html.replace('<div class="bench">','<div class="bench"><div id="judgement" class="judgement" aria-live="polite"></div>');
 return html;
}
function moveRoom(room){held=false;S.room=room;checkpoint();render();}
function bindRooms(){
 if(view!=='game'||S?.phase!=='service')return;
 $('#goCounter').onclick=guarded(()=>moveRoom('counter'));
 $('#goKitchen').onclick=guarded(()=>{if(S.acceptedIndex!==S.index){toast('카운터에서 주문 받기를 눌러 주세요.');return;}moveRoom('kitchen');});
 if($('#takeOrder'))$('#takeOrder').onclick=action(()=>{S.acceptedIndex=S.index;beep();toast('주문을 받았습니다. 주방으로 이동하세요.');});
 if($('#packFood'))$('#packFood').onclick=action(()=>{if(!S.dish)return;S.packed=true;S.room='counter';beep();toast('포장 완료! 상자를 손님에게 드래그하세요.');});
 const box=$('#parcel'),zone=$('#dropZone');if(!box||!zone)return;
 let drag=null,armed=false;
 const deliver=guarded(()=>{if(!S.dish||!S.packed||S.room!=='counter')return;E.serve(S,uuid());S.packed=false;selected={};beep(S.lastResult.ok?'ok':'bad');checkpoint();render();});
 box.onpointerdown=e=>{if(pending||saveError)return;e.preventDefault();box.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY};box.classList.add('dragging');zone.classList.add('ready');};
 box.onpointermove=e=>{if(!drag)return;box.style.transform=`translate(${e.clientX-drag.x}px,${e.clientY-drag.y}px) rotate(-4deg)`;const r=zone.getBoundingClientRect();zone.classList.toggle('over',e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom);};
 const reset=()=>{drag=null;box.style.transform='';box.classList.remove('dragging');zone.classList.remove('ready','over');};
 box.onpointerup=e=>{if(!drag)return;const r=zone.getBoundingClientRect(),hit=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;reset();if(hit)deliver();else toast('손님 전달 영역에 놓아 주세요.');};
 box.onpointercancel=reset;
 box.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();armed=true;zone.classList.add('ready');zone.focus();}};
 zone.onkeydown=e=>{if(e.key==='Enter'&&armed){e.preventDefault();armed=false;deliver();}};
}
function paintJudgement(){
 const el=$('#judgement');if(!el)return;const f=S?.feedback,c=S?.cooking;
 el.hidden=!(f&&f.left>0);if(f&&f.left>0){el.className='judgement '+f.label.toLowerCase();el.innerHTML=`<strong>${f.label}</strong><span>${f.score} / 100</span><small>${c?.cooldown>0?'잠깐 호흡을 고르세요 · '+c.cooldown.toFixed(1)+'s':'플레이팅 완료'}</small>`;}
 const button=$('#miniAction');if(button){button.disabled=!!(c?.cooldown>0);if(c?.cooldown>0){held=false;$('#miniHint').textContent='다음 동작 준비 중…';}}
}

function originalServiceHTML(){const q=S.queue[S.index],r=E.menu(S,q.menu),p=C.patrons[q.patron];return `<div class="game">${guideHTML()}<div class="topline"><div><div class="eyebrow">THE COUNTER IS OPEN</div><h2>오늘 밤도, 한 접시씩.</h2></div>${statsHTML()}</div>${resultHTML()}<div class="game-grid"><section class="panel"><div class="panel-head"><span>COUNTER 01 / 손님</span><span>${S.index+1} / ${S.queue.length}</span></div><canvas class="patron-scene" id="patron"></canvas><div class="order-wrap"><div class="customer-name">${p.name} / ${p.role}</div><div class="order-name">${r.name}</div><p class="dialogue">“${p.line}”</p><div class="order-bottom"><div><span class="muted" style="font-size:12px">${ingredientsText(r.ingredients)}</span><br><b style="color:var(--gold)">${r.price} C</b></div><span id="timer" class="timer">90.0s</span></div><div class="time-track"><i id="timeBar"></i></div><div class="tools" style="margin-top:16px"><button id="book" class="small">레시피 도감</button><button id="help" class="small ghost">조작법</button></div></div></section>${kitchenHTML()}</div>${deliveryHTML()}</div>`;}
function receiptHTML(l){const t=E.totals(l);return `<div class="panel receipt">${[['음식 판매 매출',l.sales],['팁',l.tips],['재료 구매 지출',l.purchases],['사용·폐기 재료 원가',l.cost],['영업이익',t.profit],['순현금흐름',t.cashflow],['현재 잔액',S.cash]].map(([k,v])=>`<div class="receipt-row ${k==='영업이익'?'total':''}"><span>${k}</span><b>${v.toLocaleString()} C</b></div>`).join('')}<div class="receipt-row"><span>만족 / 불만족 손님</span><b>${l.satisfied} / ${l.dissatisfied}</b></div></div>`;}
function summaryHTML(){const next=S.day+1,newMenus=E.unlocked(next).filter(r=>r.day===next);return `<div class="summary"><div class="eyebrow">SHIFT COMPLETE / DAY ${S.day}</div><h1>오늘의 불을 잠시 끕니다.</h1><p class="muted">모든 손님을 응대했습니다. 다음 영업 전에 재고를 확인하세요.</p><div class="summary-grid">${receiptHTML(S.ledger)}<div><div class="panel receipt"><h3>장부는 이렇게 계산해요</h3><p class="note">영업이익 = 판매 매출 + 팁 − 사용·폐기 원가<br>순현금흐름 = 판매 매출 + 팁 − 구매 지출<br><br>남은 재고는 당일 원가에 포함되지 않습니다. 무료 시작 재고도 사용 시 기준 단가로 계산합니다.</p><b>다음 영업일: DAY ${next}</b><p class="muted">${newMenus.length?'신메뉴 '+newMenus.map(r=>r.name).join(', '):'기존 메뉴로 영업을 이어갑니다.'}</p></div><div class="note">정산 이후 구매는 다음 영업일 장부에 반영됩니다. 이미 구매한 금액: ${S.pendingPurchases||0}C</div><div class="action-row"><button id="prepare" class="primary">다음 날 시작 · DAY ${next} 준비</button><button id="book">레시피 도감</button></div></div></div>${deliveryHTML()}</div>`;}
function prepHTML(){const unlocked=E.unlocked(S.day).filter(r=>r.day===S.day);return `<div class="summary"><div class="eyebrow">BEFORE THE RUSH</div><h1>DAY ${S.day} · 영업 준비</h1>${statsHTML()}<p class="note">손님 제한 시간은 흐르지 않습니다. 배송을 기다리거나 영업을 시작하세요.<br>준비 단계의 구매 지출은 DAY ${S.day} 장부에 반영됩니다. 영업 시작 시 손님·주문 목록을 생성하고 저장합니다.</p><div class="prep-list">${unlocked.length?unlocked.map(r=>`<div class="unlock"><small>NEW MENU / DAY ${r.day}</small><br><strong>${r.name}</strong><br>${ingredientsText(r.ingredients)}<br>${r.price} C</div>`).join(''):'<div class="unlock">오늘의 신메뉴 없음 · 재고를 충분히 준비하세요.</div>'}</div><div class="panel receipt"><h3>현재 재고</h3><div class="prep-list">${C.ingredients.map(i=>`<span>${foodIcon(i)} ${i.name} <b>${S.inventory[i.id]}</b></span>`).join('')}</div></div><div class="action-row"><button id="openShop" class="primary">영업 시작 · 손님 맞이하기</button><button id="book">레시피 도감</button></div>${deliveryHTML()}</div>`;}
function overHTML(){return `<div class="summary gameover"><div class="eyebrow">THE LAST ORDER</div><h1>네온이 꺼졌습니다.</h1><p class="muted">누적 불만족 ${S.complaints}명. 이 세이브는 게임오버 상태로 저장되며 이어하기로 우회할 수 없습니다.</p>${resultHTML()}<div class="summary-grid"><div class="panel receipt">${[['완료한 생존 일수',S.day-1+'일'],['마지막 영업일','DAY '+S.day],['누적 매출 (음식 판매)',S.stats.sales+' C'],['누적 팁',S.stats.tips+' C'],['누적 순이익 (영업 기준)',S.stats.sales+S.stats.tips-S.stats.cost+' C'],['정상 서빙 수',S.stats.served+'접시']].map(([k,v])=>`<div class="receipt-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>${receiptHTML(S.ledger)}</div><div class="action-row"><button id="restart" class="primary">다시 시작</button><button id="backMenu">메인 메뉴</button></div></div>`;}
function render(){
 if(!ready)return;held=false;updateHeader();
 screen.innerHTML=view==='menu'?menuHTML():S.phase==='service'?serviceHTML():S.phase==='summary'?summaryHTML():S.phase==='prep'?prepHTML():overHTML();
 const bind=(id,fn)=>{const el=$('#'+id);if(el)el.onclick=fn;};
 bind('newGame',newGame);bind('continue',continueGame);bind('help',help);bind('settings',settings);bind('login',account);bind('book',book);bind('shop',shop);
 bind('reloadCloud',()=>{if(pending&&!saveError)return toast('요청 처리 중입니다.');modal('<h2>클라우드 다시 불러오기</h2><p>저장에 실패한 현재 변경은 포기하고 서버의 마지막 저장으로 돌아갑니다. 기존 세이브를 덮어쓰지 않습니다.</p><button id="reloadConfirm" class="danger">마지막 클라우드 저장 불러오기</button>');$('#reloadConfirm').onclick=()=>{pending=null;saveError=false;closeModal();send('load');};});
 bind('clearMix',guarded(()=>{selected={};render();}));
 $$('.ingredient').forEach(b=>b.onclick=guarded(()=>{const k=b.dataset.ing;selected[k]=((selected[k]||0)+1);if(selected[k]>9)delete selected[k];render();}));
 bind('begin',action(()=>{if(S.acceptedIndex!==S.index)throw Error('카운터에서 주문을 먼저 받아 주세요.');E.begin(S,selected,uuid());selected={};beep();}));
 bind('serve',action(()=>{E.serve(S,uuid());selected={};beep(S.lastResult.ok?'ok':'bad');}));
 bind('discard',action(()=>{E.discard(S,uuid());toast('폐기했습니다. 사용한 재료는 반환되지 않습니다.');}));
 bind('prepare',action(()=>{E.prepare(S,uuid());}));bind('openShop',action(()=>{E.startDay(S,uuid());}));
 bind('restart',newGame);bind('backMenu',openMenu);
 bind('guideNext',action(()=>{if(S.tutorialStep<5)S.tutorialStep++;else S.tutorial=false;}));bind('guideSkip',action(()=>S.tutorial=false));
 const mini=$('#miniAction');if(mini){mini.onpointerdown=e=>{e.preventDefault();if(pending||saveError||S.cooking?.cooldown>0)return;mini.setPointerCapture(e.pointerId);if(S.cooking?.stage==='rice')held=true;else doMini();};mini.onpointerup=()=>held=false;mini.onpointercancel=()=>held=false;}
 bindRooms();lastVisual=visualKey();deliveryUpdate();height();
}
function visualKey(){return S?[S.phase,S.index,S.cooking?.stage,S.cooking?.cuts,!!S.dish].join(':'):'';}
function doMini(){if(S?.cooking?.cooldown>0||S?.room!=='kitchen')return;if(view!=='game'||paused||pending||saveError||!$('#modal').hidden)return;E.act(S);beep();checkpoint();render();}
window.addEventListener('keydown',e=>{if(e.code!=='Space'||/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)||!$('#modal').hidden)return;if(view==='game'&&S?.cooking){e.preventDefault();if(e.repeat||pending||saveError)return;if(S.room!=='kitchen'||S.cooking.cooldown>0)return;if(S.cooking.stage==='rice')held=true;else doMini();}});
window.addEventListener('keyup',e=>{if(e.code==='Space')held=false;});window.addEventListener('blur',()=>held=false);
function help(){modal(`<div class="eyebrow">CHEF'S FIELD MANUAL</div><h2>손으로 만드는 한 접시</h2><p>조작법을 열어도 영업 중 시간은 흐릅니다. 잠시 멈추려면 상단 메뉴를 누르세요.</p><div class="help-grid">${guides.slice(0,5).map((g,i)=>`<div><b>0${i+1} · ${g[0]}</b><span>${g[1]}</span></div>`).join('')}<div><b>90초와 다섯 번의 실수</b><span>90초까지 정확한 메뉴를 서빙하면 성공. 90초 초과 또는 오주문은 불만족 1명. 누적 5명이면 즉시 폐점합니다. 품질은 팁에만 영향을 줍니다.</span></div><div><b>팁 / 저장 / 탭</b><span>품질 60·80·95점부터 5·15·25%, 30초 이내 추가 5%. 최대 30%. 메뉴에서는 일시 정지, 배송은 현실 시간 기준. 한 계정·데모당 한 탭만 실행하세요.</span></div></div>`);}
function settings(){modal(`<h2>설정</h2><p>효과음은 브라우저에서 합성하며 외부 음원은 사용하지 않습니다.</p><button id="toggleSound">효과음 ${muted?'켜기':'끄기'}</button><div class="note">저장 위치: ${auth?'Firebase 클라우드':'이 브라우저의 로컬 데모'}<br>새로고침하면 마지막 저장 상태로 돌아갑니다. 손님 시간은 오프라인 동안 멈추고 배송만 계속됩니다.</div>`);$('#toggleSound').onclick=guarded(()=>{muted=!muted;if(S){S.settings.muted=muted;checkpoint();}updateHeader();settings();if(!muted)beep();});}
function book(){const day=S?.day||1;modal(`<div class="eyebrow">RECIPE ARCHIVE</div><h2>레시피 도감</h2><p>5일마다 새로운 메뉴가 열립니다. 미래 재료도 미리 구매할 수 있습니다.</p><div class="recipes">${E.recipes(Math.max(65,day+5)).map(r=>`<article class="recipe ${r.day>day?'locked':''}"><small>${r.day>day?'LOCKED · DAY '+r.day:'UNLOCKED · DAY '+r.day}</small><h3>${esc(r.name)}</h3><p>${ingredientsText(r.ingredients)}</p><b>${r.price} C</b> <span class="muted">/ 원가 ${E.cost(r.ingredients)} C</span><p>칼질 3회 → 밥 쥐기 6초 → 플레이팅<br>난이도 ×${r.difficulty}</p></article>`).join('')}</div>`);}
function shop(){if(!S)return;modal(`<div class="eyebrow">DRONE SUPPLY / 30 SECONDS</div><h2>재료 주문</h2><p>주문 확정 즉시 결제 · 배송 전에는 사용할 수 없습니다.<br>${S.phase==='summary'?'정산 이후 구매는 다음 영업일 장부에 반영합니다.':'영업 중에는 손님 시간이 계속 흐릅니다.'}</p><form id="shopForm">${C.ingredients.map(i=>`<label class="shop-row">${foodIcon(i)}<span>${i.name}<small class="muted"> · 재고 ${S.inventory[i.id]}</small></span><b>${i.cost}C</b><input aria-label="${i.name} 구매 수량" name="${i.id}" type="number" min="0" max="999" step="1" value="0"></label>`).join('')}<div class="receipt-row total"><span>총 주문 금액</span><b id="shopTotal">0 C</b></div><p>보유 ${S.cash} C</p><button class="primary" type="submit">구매 확정 / 드론 호출</button></form>`);
 const form=$('#shopForm');form.oninput=()=>{let total=0;C.ingredients.forEach(i=>total+=i.cost*Number(form.elements[i.id].value||0));$('#shopTotal').textContent=total+' C';};
 form.onsubmit=e=>{e.preventDefault();guarded(()=>{const mix={};for(const i of C.ingredients){const v=Number(form.elements[i.id].value);if(v!==0)mix[i.id]=v;}if(S.deliveries.length>=200)throw Error('동시 배송은 200건까지 가능합니다.');E.buy(S,mix,uuid(),serverNow());checkpoint();closeModal();toast('드론이 출발했습니다. 30초 뒤 도착합니다.');beep();render();})();};
}
const authMessages={EMAIL_EXISTS:'이미 가입한 이메일입니다.',INVALID_EMAIL:'이메일 형식을 확인하세요.',INVALID_LOGIN_CREDENTIALS:'이메일 또는 비밀번호가 올바르지 않습니다.',EMAIL_NOT_FOUND:'이메일 또는 비밀번호가 올바르지 않습니다.',INVALID_PASSWORD:'이메일 또는 비밀번호가 올바르지 않습니다.',USER_DISABLED:'사용 중지된 계정입니다.',TOO_MANY_ATTEMPTS_TRY_LATER:'요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.',OPERATION_NOT_ALLOWED:'Firebase에서 이메일/비밀번호 로그인을 활성화하세요.',WEAK_PASSWORD:'비밀번호는 6자 이상 입력하세요.'};
function account(){
 if(auth){modal(`<h2>클라우드 계정</h2><p>${esc(auth.email)}</p><p>로그아웃하면 즉시 게임을 멈추고 저장한 후 연결을 종료합니다. 저장 실패 시 로그아웃을 보류합니다.</p><button id="logout" class="danger">저장 후 로그아웃</button>`);$('#logout').onclick=guarded(()=>{paused=true;held=false;logoutRequested=true;closeModal();view='menu';if(S)checkpoint();else send('release');render();});return;}
 if(!config.cloud){modal('<h2>로컬 데모 모드</h2><p>현재 Firebase가 설정되지 않아 회원가입과 클라우드 저장은 비활성화되어 있습니다. 새 게임과 이어하기는 바로 사용할 수 있습니다.</p><div class="note">프로젝트 README의 Firebase 설정 후 앱을 재시작하면 이메일 회원가입·로그인·비밀번호 재설정이 활성화됩니다. 데모와 클라우드 세이브는 서로 덮어쓰지 않습니다.</div>');return;}
 modal('<h2>이메일 로그인</h2><p>로컬 데모와 클라우드 진행은 별개입니다.</p><form class="form" id="authForm"><label for="email">이메일</label><input id="email" type="email" autocomplete="email" required><label for="password">비밀번호</label><input id="password" type="password" minlength="6" autocomplete="current-password" required><div class="action-row"><button class="primary" type="submit">로그인</button><button type="button" id="signup">회원가입</button></div><button type="button" id="reset" class="ghost small" style="margin-top:12px">비밀번호 재설정 이메일</button><div class="auth-error" id="authError" role="alert"></div></form>');
 const form=$('#authForm');form.onsubmit=e=>{e.preventDefault();authenticate('signInWithPassword');};$('#signup').onclick=()=>{if(form.reportValidity())authenticate('signUp');};$('#reset').onclick=()=>authenticate('sendOobCode');
}
async function authenticate(method){
 const email=$('#email').value.trim(),password=$('#password').value;if(!email){$('#authError').textContent='이메일을 입력하세요.';return;}
 $$('#authForm button').forEach(b=>b.disabled=true);
 try{const body=method==='sendOobCode'?{requestType:'PASSWORD_RESET',email}:{email,password,returnSecureToken:true};const res=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+method+'?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok){const code=data.error?.message?.split(' : ')[0];throw Error(authMessages[code]||'로그인 요청에 실패했습니다. 네트워크와 Firebase 설정을 확인하세요.');}
 if(method==='sendOobCode'){$('#authError').textContent='가입된 주소라면 재설정 이메일을 받을 수 있습니다. 스팸함도 확인하세요.';return;}
 if(S&&!auth)backup();lockRelease?.();lockRelease=null;
 auth={idToken:data.idToken,refreshToken:data.refreshToken,localId:data.localId,email:data.email,expiresAt:Date.now()+Number(data.expiresIn)*1000};sessionStorage.setItem(AUTH,JSON.stringify(auth));S=null;revision=0;paused=true;view='menu';closeModal();send('load');render();
 }catch(e){if($('#authError'))$('#authError').textContent=e.message||'네트워크 연결을 확인하세요.';}
 finally{$$('#authForm button').forEach(b=>b.disabled=false);}
}
function finishLogout(){auth=null;sessionStorage.removeItem(AUTH);pending=null;logoutRequested=false;saveError=false;S=null;view='menu';paused=true;status('로그아웃 완료');render();}
/* Canvas artwork: procedural, original vector-style city, diverse patrons and sushi. */
function canvasCtx(id){const el=$('#'+id);if(!el)return null;const ratio=Math.min(devicePixelRatio||1,2),w=el.clientWidth,h=el.clientHeight;if(el.width!==Math.round(w*ratio)||el.height!==Math.round(h*ratio)){el.width=Math.round(w*ratio);el.height=Math.round(h*ratio);}const ctx=el.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return {ctx,w,h};}
function rect(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(x,y,w,h);}
function oval(g,x,y,rx,ry,c){g.fillStyle=c;g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fill();}
function cityArt(g,w,h,t){
 const sky=g.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#15132f');sky.addColorStop(1,'#121f35');rect(g,0,0,w,h,sky);
 for(let i=0;i<18;i++){let x=i*w/16-20,bh=h*(.24+((i*37)%11)/25),bw=w/16+15;rect(g,x,h*.78-bh,bw,bh,'#0a1223');for(let yy=h*.78-bh+12;yy<h*.75;yy+=19)for(let xx=x+8;xx<x+bw-7;xx+=13)if((Math.floor(xx+yy)+i)%3)rect(g,xx,yy,4,7,i%3?'#466e8460':'#b853b050');}
 // Elevated rails, shop windows and neon signs.
 rect(g,0,h*.75,w,8,'#40566b');rect(g,0,h*.78,w,h*.22,'#0a1524');
 for(let i=0;i<10;i++){rect(g,i*w/9,h*.75,4,h*.25,'#253d52');}
 g.save();g.shadowBlur=20;g.shadowColor='#ae63ff';rect(g,w*.69,h*.16,w*.18,4,'#bd8bff');g.font='bold '+Math.max(20,w*.04)+'px sans-serif';g.fillStyle='#d5aaff';g.fillText('寿 司',w*.69,h*.25);g.shadowColor='#3dffe1';rect(g,w*.64,h*.36,4,h*.22,'#55e9d1');g.restore();
 const glow=g.createRadialGradient(w*.8,h*.65,5,w*.8,h*.65,w*.35);glow.addColorStop(0,'#f7ad5830');glow.addColorStop(1,'#f7ad5800');rect(g,w*.45,h*.4,w*.55,h*.5,glow);
 g.strokeStyle='#94bbda35';g.lineWidth=1;for(let i=0;i<100;i++){const x=(i*137.7+t*31)%w,y=(i*97.3+t*260)%h;g.beginPath();g.moveTo(x,y);g.lineTo(x-6,y+23);g.stroke();}
 for(let i=0;i<12;i++)rect(g,w*.52+(i*37)%Math.max(1,w*.45),h*.84+i%4*12,20+i%3*14,2,i%2?'#9c64e72a':'#51cdbf30');
}
function patronArt(t){const c=canvasCtx('patron');if(!c)return;const {ctx:g,w,h}=c;cityArt(g,w,h,t);const p=C.patrons[S.queue[S.index].patron],idx=S.queue[S.index].patron;const x=w*.51,y=h*.44,scale=h/220;g.save();g.translate(x,y);g.scale(scale,scale);
 // Warm pendant lamps frame each distinct customer silhouette.
 g.shadowBlur=25;g.shadowColor='#ffc780';rect(g,-180,-100,2,45,'#79747c');oval(g,-179,-48,24,6,'#ffce88');g.shadowBlur=0;
 oval(g,0,106,91,74,'#101a2a');g.fillStyle=p.color;g.beginPath();g.moveTo(-61,59);g.lineTo(-88,145);g.lineTo(88,145);g.lineTo(61,59);g.closePath();g.fill();rect(g,-26,62,52,79,'#1b2438');rect(g,-10,40,20,27,idx===3?'#b48d83':'#e2b7a3');
 oval(g,0,0,43,53,['#d8ab99','#be8b79','#ebc0af','#c59889','#bf9c8c','#e1b9a0'][idx]);
 g.fillStyle=p.hair;g.beginPath();g.moveTo(-45,8);g.quadraticCurveTo(-58,-69,12,-57);g.quadraticCurveTo(59,-59,48,10);g.lineTo(27,-24);g.lineTo(-17,-34);g.closePath();g.fill();
 if(idx===2){oval(g,-47,28,14,50,p.hair);oval(g,47,28,14,50,p.hair);}if(idx===1){rect(g,-43,-58,70,12,p.hair);rect(g,-30,-70,15,20,p.hair);}if(idx===4){rect(g,-52,-45,100,14,'#242c45');rect(g,-42,-65,82,25,'#303d5a');rect(g,-6,-58,12,10,'#d7bd75');}
 rect(g,-27,-5,16,3,'#262538');rect(g,13,-5,16,3,'#262538');rect(g,idx%2?-32:10,-9,23,10,p.color);g.shadowBlur=10;g.shadowColor=p.color;rect(g,idx%2?-30:12,-6,18,2,'#dffffb');g.shadowBlur=0;
 g.strokeStyle='#845b5d';g.lineWidth=2;g.beginPath();g.moveTo(-9,28);g.quadraticCurveTo(0,31,10,27);g.stroke();rect(g,35,15,5,18,'#bac7d1');rect(g,-64,88,12,26,'#1b2939');g.restore();
 rect(g,0,h-18,w,18,'#986947');rect(g,0,h-18,w,3,'#e9b77a');g.fillStyle='#ecd4b7';g.font='10px monospace';g.fillText('COUNTER 01',14,h-30);
}
function dishArt(){const c=canvasCtx('dishCanvas');if(!c||!S.dish)return;const {ctx:g,w,h}=c;g.clearRect(0,0,w,h);oval(g,w/2,h*.6,w*.36,h*.28,'#070d17');oval(g,w/2,h*.53,w*.35,h*.28,'#56717b');oval(g,w/2,h*.51,w*.32,h*.23,'#cbd9d7');const mix=S.dish.mix,keys=Object.keys(mix).filter(k=>k!=='rice');
 for(let j=0;j<3;j++){let x=w/2+(j-1)*w*.17,y=h*.49+(j%2)*9;oval(g,x,y+8,29,15,mix.rice?'#f4eddd':'#385154');for(let z=0;z<8;z++)oval(g,x-21+z*6,y+10+(z%2)*3,3,1,'#cecbbf');keys.forEach((k,i)=>{const ingredient=C.ingredients.find(a=>a.id===k);if(k==='nori'){rect(g,x-6,y-11,12,35,ingredient.color);}else if(k==='sauce'){g.strokeStyle=ingredient.color;g.lineWidth=3;g.beginPath();g.moveTo(x-20,y-7);g.lineTo(x+20,y+6);g.stroke();}else{oval(g,x+i*3,y-i*5,28,12,ingredient.color);g.strokeStyle='#ffffff70';g.lineWidth=2;for(let z=-15;z<20;z+=10){g.beginPath();g.moveTo(x+z,y-8-i*5);g.lineTo(x+z-5,y+5-i*5);g.stroke();}}});}
 oval(g,w*.76,h*.6,10,6,'#8ccd87');
}
let lastDeliveryPaint=0,refreshing=false;
function frame(now){
 const dt=Math.max(0,(now-lastFrame)/1000);lastFrame=now;
 if(ready){
  const cc=canvasCtx('city');if(cc)cityArt(cc.ctx,cc.w,cc.h,now/1000);
  if(S&&view==='game'&&S.phase==='service')patronArt(now/1000);
  if(S&&view==='game'&&!paused&&!pending&&!saveError&&!document.hidden){
   const result=E.tick(S,dt,held);if(result){beep('bad');checkpoint();}
   if(visualKey()!==lastVisual){checkpoint();render();}
  }
  if(S&&!saveError&&!pending&&(auth||hasLock)){
   if(auth){if(S.deliveries.some(d=>d.due<=serverNow()))checkpoint();}
   else if(E.receive(S,Date.now()).length){checkpoint();toast('드론 배송 도착 · 재고를 보충했습니다.');beep();render();}
   if(now-lastSave>(auth?12000:5000))checkpoint();
  }
  if(auth&&!pending&&!refreshing&&Date.now()>auth.expiresAt-90000){refreshing=true;refreshToken().catch(e=>{saveError=true;status(e.message,true);}).finally(()=>refreshing=false);}
  if(pending&&!saveError&&now-lastSave>25000){saveError=true;status('응답 지연 · 저장 재시도',true);}
  if($('#kitchenTimer')&&S)$('#kitchenTimer').textContent=S.tutorial?'튜토리얼 · 시간 정지':Math.max(0,E.e.customerSeconds-S.elapsed).toFixed(1)+'s';
  if($('#timer')&&S){const left=Math.max(0,E.e.customerSeconds-S.elapsed);$('#timer').textContent=S.tutorial?'GUIDE':left.toFixed(1)+'s';$('#timer').classList.toggle('urgent',left<20);$('#timeBar').style.width=(left/E.e.customerSeconds*100)+'%';}
  const c=S?.cooking;if(c&&$('#cursor')){let pos,target,width;
   if(c.stage==='cut'){pos=E.cutCursor(c);target=E.cutTarget(c);width=.25/c.difficulty;$('#miniHint').textContent='중앙에 가까울수록 높은 점수 · 자동 진행까지 '+Math.max(0,2.7-c.time).toFixed(1)+'s';}
   else if(c.stage==='rice'){pos=c.bar;target=E.riceTarget(c);width=.34/c.difficulty;$('#miniHint').textContent='누르면 위로 / 놓으면 아래로 · 남은 시간 '+Math.max(0,6-c.time).toFixed(1)+'s';}
   else{pos=E.plateCursor(c);target=.5;width=.23/c.difficulty;$('#miniHint').textContent='중앙에서 토핑 올리기 · '+Math.max(0,3.2-c.time).toFixed(1)+'s';}
   if(c.stage==='rice'){$('#cursor').style.top=Math.min(97,100*(1-pos))+'%';$('#target').style.top=100*(1-target-width/2)+'%';$('#target').style.height=100*width+'%';}else{$('#cursor').style.left=Math.min(99,100*pos)+'%';$('#target').style.left=100*(target-width/2)+'%';$('#target').style.width=100*width+'%';}
  }
  if(S?.dish)dishArt();
  paintJudgement();
  if(now-lastDeliveryPaint>250){deliveryUpdate();lastDeliveryPaint=now;}
 }
 if(now>toastUntil)$('#toast').classList.remove('show');requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();held=false;if(document.hidden&&S&&!pending&&!saveError)checkpoint();});
window.addEventListener('pagehide',()=>{if(S&&!auth&&hasLock)backup();});
fetch('catalog.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(c=>{C=c;E=new SushiEngine(C);ready=true;render();parentMessage('streamlit:componentReady',{apiVersion:1});requestAnimationFrame(frame);setTimeout(()=>{if(window.parent===window){initAuth=true;status('로컬 데모 · 브라우저 저장');}},200);}).catch(()=>{screen.textContent='게임 데이터를 불러올 수 없습니다. Streamlit으로 실행하거나 정적 웹 호스트에 프로젝트를 배포하세요.';});
