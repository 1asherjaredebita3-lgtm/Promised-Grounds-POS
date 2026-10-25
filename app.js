import {configured, signedIn, signIn, signOut, publishOrder, fetchSharedMenu, saveSharedMenuItem, deleteSharedMenuItem} from './cloud.js';
/* PROMISED GROUNDS POS
 * Sections: defaults → storage → rendering → checkout → sync → event wiring.
 * Currency amounts are stored as whole centavos to avoid rounding errors.
 * Orders and queue belong to this browser. Sheets is the reporting destination.
 */
const DEFAULT_MENU = [
  {id:'americano',name:'Americano',category:'Coffee',description:'',price:6900,offerHotIced:true,hotPrice:7900,icedPrice:6900,available:true},
  {id:'latte',name:'Latte',category:'Coffee',description:'',price:7900,offerHotIced:true,hotPrice:8900,icedPrice:7900,available:true},
  {id:'vanilla-latte',name:'Vanilla Latte',category:'Coffee',description:'',price:8900,offerHotIced:false,hotPrice:null,icedPrice:8900,available:true},
  {id:'spanish-latte',name:'Spanish Latte',category:'Coffee',description:'',price:8900,offerHotIced:false,hotPrice:null,icedPrice:8900,available:true},
  {id:'mocha-latte',name:'Mocha Latte',category:'Coffee',description:'',price:9900,offerHotIced:true,hotPrice:9900,icedPrice:9900,available:true},
  {id:'salted-caramel',name:'Salted Caramel',category:'Coffee',description:'',price:9900,offerHotIced:false,hotPrice:null,icedPrice:9900,available:true},
  {id:'caramel-macchiato',name:'Caramel Macchiato',category:'Coffee',description:'',price:10900,offerHotIced:false,hotPrice:10900,icedPrice:null,available:true},
  {id:'green-apple-fizz',name:'Green Apple Fizz',category:'Fruit Fizz',description:'',price:7900,offerHotIced:false,hotPrice:null,icedPrice:7900,available:true},
  {id:'strawberry-fizz',name:'Strawberry Fizz',category:'Fruit Fizz',description:'',price:7900,offerHotIced:false,hotPrice:null,icedPrice:7900,available:true},
  {id:'blueberry-fizz',name:'Blueberry Fizz',category:'Fruit Fizz',description:'',price:7900,offerHotIced:false,hotPrice:null,icedPrice:7900,available:true},
  {id:'passion-fruit-fizz',name:'Passion Fruit Fizz',category:'Fruit Fizz',description:'',price:7900,offerHotIced:false,hotPrice:null,icedPrice:7900,available:true},
  {id:'grapes-fizz',name:'Grapes Fizz',category:'Fruit Fizz',description:'',price:7900,offerHotIced:false,hotPrice:null,icedPrice:7900,available:true},
  {id:'matcha-latte',name:'Matcha Latte',category:'Matcha',description:'',price:8900,offerHotIced:false,hotPrice:null,icedPrice:8900,available:true},
  {id:'dirty-matcha',name:'Dirty Matcha',category:'Matcha',description:'',price:9900,offerHotIced:false,hotPrice:null,icedPrice:9900,available:true},
  {id:'strawberry-matcha',name:'Strawberry Matcha',category:'Matcha',description:'',price:9900,offerHotIced:false,hotPrice:null,icedPrice:9900,available:true}
];
const STORAGE_KEY = 'promised-grounds-pos-v1';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = centavos => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(centavos/100);
const fromDbMenu = row => ({...row, offerHotIced:Boolean(row.offer_hot_iced), hotPrice:row.hot_price??null, icedPrice:row.iced_price??null, price:Number(row.price)||0});
const toDbMenu = p => ({id:p.id,name:p.name,category:p.category,description:p.description||'',price:p.price,offer_hot_iced:Boolean(p.offerHotIced),hot_price:p.hotPrice??null,iced_price:p.icedPrice??null,available:Boolean(p.available)});
let menuSyncing=false, menuLastLoadedAt=0;

const localDay = stamp => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
const timeText = stamp => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp));
const newId = () => crypto.randomUUID();
let state;
try { const saved=localStorage.getItem(STORAGE_KEY); state=saved?JSON.parse(saved):{menu:DEFAULT_MENU,orders:[],config:{url:'',key:'',lateMinutes:10}}; if(!Array.isArray(state.orders)||!Array.isArray(state.menu)||!state.config)throw Error(); }
catch { state={menu:DEFAULT_MENU,orders:[],config:{url:'',key:'',lateMinutes:10}}; alert('Saved data could not be read. Export or recover your existing browser data before using the POS.'); }
let cart=[], category='All', editingId=null, syncing=false, cloudSyncing=false;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$('toast').classList.remove('show'),4200);}
// Never confirm an order if the browser cannot save it.
function commit(next){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));state=next;return true;}catch{toast('Storage is full or unavailable. Order was not saved. Export a backup and retry.');return false;}}
function updateOrder(id,status){const order=state.orders.find(o=>o.id===id);if(!order)return;if(status==='cancelled'&&!confirm(`Cancel ${order.number}? This remains in history.`))return;const stamp=Date.now();const next=structuredClone(state);const target=next.orders.find(o=>o.id===id);target.status=status;target.updatedAt=Math.max(stamp,order.updatedAt+1);if(status==='ready')target.readyAt=stamp;if(status==='collected')target.collectedAt=stamp;if(status==='cancelled')target.cancelledAt=stamp;if(commit(next)){renderAll();syncOrders();syncLiveOrders();}}
const subtotal = () => cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
function duration(order){const end=order.readyAt||order.cancelledAt||Date.now();const seconds=Math.max(0,Math.floor((end-order.createdAt)/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
const activeOrders = () => state.orders.filter(o=>!['collected','cancelled'].includes(o.status));
function switchView(view){document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===view));renderAll();window.scrollTo(0,0);}
function renderMenu(){const categories=['All',...new Set(state.menu.filter(p=>p.available).map(p=>p.category))];if(!categories.includes(category))category='All';$('categories').innerHTML=categories.map(c=>`<button class="${category===c?'active':''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');const query=$('search').value.toLowerCase();const items=state.menu.filter(p=>p.available&&(category==='All'||category===p.category)&&`${p.name} ${p.description}`.toLowerCase().includes(query));$('products').innerHTML=items.map(p=>{const prices=p.offerHotIced?`Hot ${money(p.hotPrice)} · Iced ${money(p.icedPrice)}`:money(p.hotPrice??p.icedPrice??p.price);return `<button class="product" data-product="${escapeHtml(p.id)}" aria-label="Add ${escapeHtml(p.name)}"><div class="product-art"><span class="cup" aria-hidden="true"></span><small>${escapeHtml(p.category.toUpperCase())}</small></div><b>${escapeHtml(p.name)}</b><p>${escapeHtml(p.description)}</p><span class="product-price">${prices}</span><span class="add-circle" aria-hidden="true">＋</span></button>`}).join('')||'<div class="empty">No matching menu items.</div>';}
function renderCart(){const total=subtotal();$('cart').innerHTML=cart.length?cart.map(item=>`<div class="cart-row"><div class="cart-row-top"><b>${escapeHtml(item.name)}${item.temperature?` · ${escapeHtml(item.temperature)}`:''}</b><span>${money(item.price*item.quantity)}</span></div><div class="qty"><button data-quantity="-1" data-id="${escapeHtml(item.cartKey||item.id)}" aria-label="Remove one ${escapeHtml(item.name)}">−</button><span>${item.quantity}</span><button data-quantity="1" data-id="${escapeHtml(item.cartKey||item.id)}" aria-label="Add one ${escapeHtml(item.name)}">＋</button><small>${money(item.price)} each</small></div></div>`).join(''):'<div class="empty"><span class="empty-symbol">∪</span>Your order starts here.<br>Choose something good from the menu.</div>';$('total').textContent=money(total);$('placeOrder').disabled=!cart.length;renderPayment();}
function renderPayment(){const isCash=$('payment').value==='Cash';$('cashLabel').hidden=!isCash;const cash=Math.round(Number($('cash').value)*100);$('change').textContent=isCash&&$('cash').value?(cash>=subtotal()?`Change: ${money(cash-subtotal())}`:'Cash received is below the total.'):$('payment').value==='Unpaid'?'Order will be recorded as unpaid.':'';}
function stat(value,label){return `<div class="stat"><b>${value}</b><small>${label}</small></div>`;}
function renderQueue(){const active=activeOrders();$('queueCount').textContent=active.length;const waiting=active.filter(o=>!o.readyAt);const ready=active.filter(o=>o.status==='ready');$('queueStats').innerHTML=stat(waiting.length,'Waiting / preparing')+stat(ready.length,'Ready for collection')+stat(waiting.length?Math.floor(waiting.reduce((s,o)=>s+Date.now()-o.createdAt,0)/waiting.length/60000)+' min':'—','Average current wait');$('queueList').innerHTML=active.map(o=>`<article class="order-card"><div class="order-top"><span class="order-number">${o.number}</span><span class="status ${o.status}">${o.status==='queued'?'Queued':o.status==='preparing'?'Preparing':'Ready'}</span></div><h2>${escapeHtml(o.customer||'Walk-in')}</h2><p>${timeText(o.createdAt)}</p><div class="wait" data-timer="${o.id}">${duration(o)}</div><small>${o.readyAt?'Preparation time · stopped at ready':'Waiting time · min:sec'}</small><ul>${o.items.map(i=>`<li>${i.quantity} × ${escapeHtml(i.name)}</li>`).join('')}</ul>${o.notes?`<p><b>Note:</b> ${escapeHtml(o.notes)}</p>`:''}<footer><div class="history-line"><b>${money(o.total)}</b><span class="status">${escapeHtml(o.payment)}</span></div><div class="actions">${o.status==='queued'?`<button class="secondary" data-status="preparing" data-order="${o.id}">Start preparing</button>`:''}${o.status==='ready'?`<button class="primary" data-status="collected" data-order="${o.id}">Mark collected ✓</button>`:`<button class="primary" data-status="ready" data-order="${o.id}">Mark ready ✓</button>`}<button class="cancel" data-status="cancelled" data-order="${o.id}">Cancel order</button></div><small class="sync-label">${syncLabel(o)}</small></footer></article>`).join('')||'<div class="empty"><span class="empty-symbol">✓</span>A clear counter. You’re all caught up.</div>';renderCounterQueue();updateTimers();}
/* Compact bottom queue shares the original order timestamps and status actions.
 * It appears immediately after checkout; no second click starts the timer.
 */
function renderCounterQueue(){
  const orders=activeOrders();
  $('counterQueueCount').textContent=orders.length;
  $('counterQueueList').innerHTML=orders.map(order=>`
    <article class="counter-order">
      <div class="counter-order-details">
        <b>${escapeHtml(order.number)}</b>
        <span>${escapeHtml(order.customer||'Walk-in')}</span>
        <small>${order.items.map(item=>`${item.quantity} × ${escapeHtml(item.name)}`).join(', ')}</small>
      <small>${order.cloudSyncedAt>=order.updatedAt?'Live board ✓':'Live board pending'}</small>
      </div>
      <div class="counter-order-timing">
        <span class="wait" data-timer="${order.id}">${duration(order)}</span>
        <small>${order.readyAt?'Ready · timer stopped':'Waiting · min:sec'}</small>
      </div>
      <button class="${order.readyAt?'secondary':'primary'}" data-status="${order.readyAt?'collected':'ready'}" data-order="${order.id}">${order.readyAt?'Collected ✓':'Ready ✓'}</button>
    </article>`).join('')||'<div class="counter-queue-empty">No waiting orders. The timer starts as soon as you tap <b>Place order</b>.</div>';
}
function syncLabel(o){const cloud=o.cloudSyncedAt>=o.updatedAt?'Live board published · ':configured()?'Live board pending · ':'';return cloud+(o.syncedAt===o.updatedAt?'Synced to Google Sheets':state.config.url?'Pending Google Sheets sync':'Saved on this device · Sheets not connected');}
function renderHistory(){const query=$('historySearch').value.toLowerCase();const date=$('historyDate').value;const orders=state.orders.filter(o=>(!date||localDay(o.createdAt)===date)&&`${o.number} ${o.customer} ${o.items.map(i=>i.name).join(' ')}`.toLowerCase().includes(query)).slice().reverse();const today=state.orders.filter(o=>localDay(o.createdAt)===localDay(Date.now())&&o.status!=='cancelled');const paid=today.filter(o=>o.payment!=='Unpaid');$('historyStats').innerHTML=stat(money(paid.reduce((s,o)=>s+o.total,0)),'Paid sales today · excludes cancellations')+stat(today.length,'Orders today · excludes cancellations')+stat(state.orders.filter(o=>o.syncedAt!==o.updatedAt).length,'Records awaiting Sheets sync');$('historyList').innerHTML=orders.map(o=>`<article class="history-row"><div class="history-line"><b>${o.number} · ${escapeHtml(o.customer||'Walk-in')}</b><span>${money(o.total)}</span><span class="status ${o.status}">${o.status}</span></div><p>${timeText(o.createdAt)} · ${escapeHtml(o.payment)} · ${o.items.map(i=>`${i.quantity} × ${escapeHtml(i.name)}`).join(', ')}</p><small>${o.readyAt?'Preparation: '+duration(o)+' · ':''}${syncLabel(o)}</small></article>`).join('')||'<div class="empty">No orders to show yet.</div>';}
function renderEditor(){ $('menuEditor').innerHTML=state.menu.map(p=>`<div class="menu-edit-row"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.category)} · ${p.offerHotIced?`Hot ${money(p.hotPrice)} / Iced ${money(p.icedPrice)}`:money(p.hotPrice??p.icedPrice??p.price)}${p.available?'':' · Unavailable'}</small></div><button class="secondary" data-edit="${escapeHtml(p.id)}">Edit</button></div>`).join('');}
function renderAll(){renderMenu();renderCart();renderQueue();renderHistory();renderEditor();const pending=state.orders.filter(o=>o.syncedAt!==o.updatedAt).length;$('connection').textContent=!state.config.url?'Local mode':pending?`${pending} pending sync`:'Sheets connected';}
function updateTimers(){document.querySelectorAll('[data-timer]').forEach(el=>{const o=state.orders.find(o=>o.id===el.dataset.timer);if(!o)return;el.textContent=duration(o);el.classList.toggle('late',!o.readyAt&&(Date.now()-o.createdAt)>state.config.lateMinutes*60000);});$('clock').textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date());}
function placeOrder(){if(!cart.length)return;const total=subtotal(),payment=$('payment').value,cash=payment==='Cash'?Math.round(Number($('cash').value)*100):null;if(payment==='Cash'&&(!$('cash').value||!Number.isFinite(cash)||cash<total)){toast('Enter enough cash received to complete checkout.');$('cash').focus();return;}const stamp=Date.now();const day=localDay(stamp);const count=state.orders.filter(o=>localDay(o.createdAt)===day).length+1;const order={id:newId(),number:`PG-${day.replaceAll('-','')}-${String(count).padStart(3,'0')}`,customer:$('customer').value.trim(),notes:$('notes').value.trim(),items:structuredClone(cart),total,payment,cash,change:cash===null?null:cash-total,status:'queued',createdAt:stamp,updatedAt:stamp,readyAt:null,collectedAt:null,cancelledAt:null,syncedAt:null};const next=structuredClone(state);next.orders.push(order);if(!commit(next))return;cart=[];['customer','notes','cash'].forEach(id=>$(id).value='');renderAll();toast(`${order.number} saved. Waiting timer started.`);syncOrders();syncLiveOrders();}
/* Sheets adapter: send a full snapshot of each changed order.
 * Only an explicit acknowledgement marks a record synced. Timeout retries are
 * safe because the Apps Script upserts by UUID and rejects older revisions.
 */
async function syncOrders(){if(syncing||!state.config.url||!state.config.key||!navigator.onLine)return;syncing=true;$('syncMessage').textContent='Syncing saved orders…';const pending=state.orders.filter(o=>o.syncedAt!==o.updatedAt).map(o=>structuredClone(o));let succeeded=0;try{for(const order of pending){const response=await fetch(state.config.url,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({key:state.config.key,order}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Sheets returned an error.');const result=await response.json();if(!result.ok||result.id!==order.id||result.updatedAt!==order.updatedAt)throw Error(result.error||'Sheets did not confirm this record.');const next=structuredClone(state);const current=next.orders.find(o=>o.id===order.id);if(current.updatedAt===order.updatedAt)current.syncedAt=order.updatedAt;if(!commit(next))throw Error('Could not save sync acknowledgement.');succeeded++;}$('syncMessage').textContent=pending.length?`${succeeded} order records synced successfully.`:'No pending records. Place an order to verify the connection.';}catch(error){$('syncMessage').textContent=`Sync not confirmed. Your records remain saved for retry. Check URL, key, access settings, and internet. ${error.name==='TimeoutError'?'Request timed out.':''}`;}finally{syncing=false;renderQueue();renderHistory();const pendingCount=state.orders.filter(o=>o.syncedAt!==o.updatedAt).length;$('connection').textContent=pendingCount?`${pendingCount} pending sync`:'Sheets connected';}}
/* Staff sign-in is required; customers can only read the sanitized queue.
 * Local orders remain saved until the database acknowledges their revision.
 */
async function syncLiveOrders(){
  if(cloudSyncing||!configured()||!signedIn()||!navigator.onLine)return;
  cloudSyncing=true;
  $('cloudMessage').textContent='Publishing pending order changes…';
  try {
    const pending=state.orders.filter(order=>!(order.cloudSyncedAt>=order.updatedAt)).map(order=>structuredClone(order));
    for(const order of pending){
      const result=await publishOrder(order);
      if(result?.id!==order.id||Number(result.revision)<order.updatedAt)throw Error('Database did not confirm the order.');
      const next=structuredClone(state), current=next.orders.find(item=>item.id===order.id);
      if(current.updatedAt===order.updatedAt)current.cloudSyncedAt=order.updatedAt;
      if(!commit(next))throw Error('Could not save publication acknowledgement.');
    }
    $('cloudMessage').textContent='Customer live board is up to date.';
  } catch(error){
    $('cloudMessage').textContent='Not published yet: '+error.message+' Your order remains saved on this device.';
  } finally {cloudSyncing=false;renderQueue();renderHistory();renderCloudStatus();}
}
function renderCloudStatus(){
  $('cloudSetupStatus').textContent=!configured()?'Setup needed: add Supabase details to config.js.':signedIn()?'Staff signed in. Orders publish after checkout and status changes.':'Sign in as approved staff to publish customer orders.';
  $('staffLogin').hidden=signedIn();
  $('staffSignOut').disabled=!signedIn();
}
function toggleTemperatureFields(){const enabled=$('editHotIced').checked;$('temperaturePrices').hidden=!enabled;$('singlePriceFields').hidden=enabled;}
function addProductToCart(product,temperature,price){const key=product.id+'::'+(temperature||'');const item=cart.find(i=>i.cartKey===key);if(item){if(item.quantity>=99){toast('Maximum 99 of an item per order.');return;}item.quantity++;}else cart.push({id:product.id,cartKey:key,name:product.name,temperature:temperature||'',price:Number(price??product.price),quantity:1});renderCart();}
async function syncSharedMenu({quiet=false}={}){if(menuSyncing||!configured()||!navigator.onLine)return;menuSyncing=true;try{const rows=await fetchSharedMenu();if(Array.isArray(rows)&&rows.length){const remote=rows.map(fromDbMenu);const next=structuredClone(state);next.menu=remote; if(commit(next)){menuLastLoadedAt=Date.now();renderAll();if($('menuSyncStatus'))$('menuSyncStatus').textContent='Shared menu loaded from Supabase · '+remote.length+' items.';if(!quiet)toast('Shared menu loaded from Supabase.');}}else if(!quiet)toast('Supabase menu is empty. Add menu items in Settings.'); }catch(error){if($('menuSyncStatus'))$('menuSyncStatus').textContent='Could not load shared menu: '+error.message;if(!quiet)toast('Could not load shared menu: '+error.message);}finally{menuSyncing=false;}}
function openEditor(id){editingId=id;const p=state.menu.find(p=>p.id===id);$('editorTitle').textContent=p?'Edit menu item':'Add menu item';$('editName').value=p?.name||'';$('editCategory').value=p?.category||'Coffee';$('editDescription').value=p?.description||'';$('editPrice').value=p?(p.price/100):'';$('editHotIced').checked=p?.offerHotIced??false;$('editHotPrice').value=p?.hotPrice!=null?p.hotPrice/100:'';$('editIcedPrice').value=p?.icedPrice!=null?p.icedPrice/100:'';$('editAvailable').checked=p?.available??true;toggleTemperatureFields();$('productDialog').showModal();}
function exportCsv(){const headers=['Order ID','Order number','Placed at (Manila)','Customer','Type','Table','Items','Total PHP','Payment','Cash PHP','Change PHP','Status','Ready at (Manila)','Wait seconds','Notes','Sheet sync'];const rows=state.orders.map(o=>[o.id,o.number,new Date(o.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}),o.customer,o.type,o.table,o.items.map(i=>`${i.quantity} x ${i.name} @ ${i.price/100}`).join('; '),o.total/100,o.payment,o.cash===null?'':o.cash/100,o.change===null?'':o.change/100,o.status,o.readyAt?new Date(o.readyAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'',Math.floor(((o.readyAt||o.cancelledAt||Date.now())-o.createdAt)/1000),o.notes,syncLabel(o)]);const safe=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const blob=new Blob(['\uFEFF'+[headers,...rows].map(row=>row.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`promised-grounds-orders-${localDay(Date.now())}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// Event delegation keeps generated menu and queue markup simple and editable.
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('categories').onclick=e=>{const button=e.target.closest('[data-category]');if(button){category=button.dataset.category;renderMenu();}};
$('products').onclick=e=>{const button=e.target.closest('[data-product]');if(!button)return;const product=state.menu.find(p=>p.id===button.dataset.product);if(!product)return;if(product.offerHotIced){$('variationTitle').textContent=product.name;$('variationHot').textContent=`Hot · ${money(product.hotPrice)}`;$('variationIced').textContent=`Iced · ${money(product.icedPrice)}`;$('variationHot').disabled=product.hotPrice==null;$('variationIced').disabled=product.icedPrice==null;$('variationDialog').dataset.product=product.id;$('variationDialog').showModal();}else{const temp=product.hotPrice!=null?'Hot':product.icedPrice!=null?'Iced':'';addProductToCart(product,temp,temp==='Hot'?product.hotPrice:temp==='Iced'?product.icedPrice:product.price);}};
$('cart').onclick=e=>{const button=e.target.closest('[data-quantity]');if(!button)return;const item=cart.find(i=>(i.cartKey||i.id)===button.dataset.id);if(!item)return;item.quantity=Math.min(99,item.quantity+Number(button.dataset.quantity));cart=cart.filter(i=>i.quantity>0);renderCart();};
$('clearCart').onclick=()=>{if(cart.length&&confirm('Clear the current cart?')){cart=[];renderCart();}};
$('search').oninput=renderMenu;$('cash').oninput=renderPayment;$('payment').onchange=renderPayment;$('placeOrder').onclick=placeOrder;
$('openFullQueue').onclick=()=>switchView('queue');
$('counterQueueList').onclick=e=>{const button=e.target.closest('[data-status]');if(button)updateOrder(button.dataset.order,button.dataset.status);};
$('queueList').onclick=e=>{const button=e.target.closest('[data-status]');if(button)updateOrder(button.dataset.order,button.dataset.status);};
$('historySearch').oninput=renderHistory;$('historyDate').onchange=renderHistory;$('resetHistory').onclick=()=>{$('historyDate').value='';$('historySearch').value='';renderHistory();};$('exportCsv').onclick=exportCsv;
$('lateMinutes').value=state.config.lateMinutes;$('lateMinutes').onchange=()=>{const n=Number($('lateMinutes').value);if(Number.isInteger(n)&&n>=1&&n<=120){const next=structuredClone(state);next.config.lateMinutes=n;commit(next);updateTimers();}else $('lateMinutes').value=state.config.lateMinutes;};
$('sheetUrl').value=state.config.url;$('sheetKey').value=state.config.key;
$('saveConnection').onclick=()=>{const url=$('sheetUrl').value.trim(),key=$('sheetKey').value.trim();if(url&&!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)){toast('Use the Google Apps Script deployment URL ending in /exec.');return;}if(url&&!key){toast('Enter the matching sync key.');return;}const next=structuredClone(state);next.config.url=url;next.config.key=key;if(commit(next)){toast(url?'Connection saved. Checking pending records…':'Local mode saved.');renderAll();syncOrders();syncLiveOrders();}};
$('syncNow').onclick=()=>{if(!state.config.url)toast('Save a Sheets connection first.');else syncOrders();};
$('refreshMenu').onclick=()=>syncSharedMenu();
$('menuEditor').onclick=e=>{const button=e.target.closest('[data-edit]');if(button)openEditor(button.dataset.edit);};$('addProduct').onclick=()=>openEditor(null);$('closeEditor').onclick=()=>$('productDialog').close();
$('editHotIced').onchange=toggleTemperatureFields;
$('variationHot').onclick=()=>{const p=state.menu.find(p=>p.id===$('variationDialog').dataset.product);if(p){addProductToCart(p,'Hot',p.hotPrice);$('variationDialog').close();}};
$('variationIced').onclick=()=>{const p=state.menu.find(p=>p.id===$('variationDialog').dataset.product);if(p){addProductToCart(p,'Iced',p.icedPrice);$('variationDialog').close();}};
$('closeVariation').onclick=()=>$('variationDialog').close();
$('productForm').onsubmit=async e=>{e.preventDefault();const name=$('editName').value.trim(),cat=$('editCategory').value.trim();const offerHotIced=$('editHotIced').checked;const hotPrice=$('editHotPrice').value===''?null:Math.round(Number($('editHotPrice').value)*100);const icedPrice=$('editIcedPrice').value===''?null:Math.round(Number($('editIcedPrice').value)*100);const legacyPrice=$('editPrice').value===''?null:Math.round(Number($('editPrice').value)*100);if(!name||!cat||(offerHotIced&&(hotPrice==null||icedPrice==null||hotPrice<0||icedPrice<0))||(!offerHotIced&&hotPrice==null&&icedPrice==null&&(!legacyPrice||legacyPrice<=0))){toast('Enter a name, category, and valid price for each available option.');return;}const price=offerHotIced?icedPrice:(icedPrice??hotPrice??legacyPrice);const product={id:editingId||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||newId(),name,category:cat,description:$('editDescription').value.trim(),price,offerHotIced,hotPrice:offerHotIced?hotPrice:(hotPrice??null),icedPrice:offerHotIced?icedPrice:(icedPrice??null),available:$('editAvailable').checked};const next=structuredClone(state);const index=next.menu.findIndex(p=>p.id===editingId);if(index<0)next.menu.push(product);else next.menu[index]=product;if(!signedIn()){toast('Sign in as approved staff in Settings before saving shared menu changes.');return;}if(!commit(next))return;$('productDialog').close();renderAll();try{await saveSharedMenuItem(toDbMenu(product));toast('Menu saved to Supabase and shared with other devices.');}catch(err){toast('Menu saved locally, but Supabase sync failed: '+err.message);}};
window.addEventListener('online',()=>{syncOrders();syncLiveOrders();});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY&&event.newValue){try{const saved=JSON.parse(event.newValue);if(Array.isArray(saved.orders)&&Array.isArray(saved.menu)&&saved.config){state=saved;renderAll();}}catch{toast('Could not load changes from another tab.');}}});
$('staffLogin').onsubmit=async event=>{
  event.preventDefault();$('staffSignIn').disabled=true;
  try{await signIn($('staffEmail').value.trim(),$('staffPassword').value);$('staffPassword').value='';renderCloudStatus();await syncLiveOrders();}
  catch(error){$('cloudMessage').textContent=error.message;}
  finally{$('staffSignIn').disabled=false;}
};
$('staffSignOut').onclick=async()=>{try{await signOut();}catch{}renderCloudStatus();$('cloudMessage').textContent='Signed out. Existing published orders stay on the customer board.';};
$('cloudRetry').onclick=()=>{if(!configured()||!signedIn())toast('Complete setup and sign in as staff first.');else syncLiveOrders();};
renderAll();renderCloudStatus();updateTimers();syncSharedMenu({quiet:true});setInterval(()=>syncSharedMenu({quiet:true}),30000);setInterval(updateTimers,1000);setInterval(syncOrders,30000);setInterval(syncLiveOrders,10000);syncOrders();syncLiveOrders();
