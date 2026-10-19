/** PROMISED GROUNDS → GOOGLE SHEETS
 * Paste in Extensions → Apps Script in your reporting spreadsheet.
 * Replace only the two configuration values, then deploy as a Web app.
 * Execute as: Me. Who has access: Anyone.
 * The shared key is required for every write. Never share it publicly.
 */
const CONFIG = {
  SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE',
  SYNC_KEY: 'REPLACE_WITH_A_LONG_RANDOM_PRIVATE_KEY',
  TAB_NAME: 'Orders'
};
const HEADERS = ['Order ID','Order number','Placed at','Customer','Order type','Table / label','Items','Total PHP','Payment','Cash received PHP','Change PHP','Status','Ready at','Collected at','Cancelled at','Wait seconds','Notes','Revision'];
function doPost(e) {
  let lock;
  try {
    const body = JSON.parse(e.postData.contents);
    if (CONFIG.SYNC_KEY === 'REPLACE_WITH_A_LONG_RANDOM_PRIVATE_KEY' || body.key !== CONFIG.SYNC_KEY) throw new Error('Invalid sync key.');
    const o = body.order;
    const statuses = ['queued','preparing','ready','collected','cancelled'];
    if (!o || !/^[a-f0-9-]{36}$/.test(o.id) || !Array.isArray(o.items) || o.items.length < 1 || o.items.length > 200 || !statuses.includes(o.status) || !Number.isSafeInteger(o.total) || o.total < 0 || !Number.isSafeInteger(o.createdAt) || !Number.isSafeInteger(o.updatedAt)) throw new Error('Invalid order.');
    if (!o.items.every(i => typeof i.name==='string' && Number.isSafeInteger(i.price) && i.price>0 && Number.isInteger(i.quantity) && i.quantity>0 && i.quantity<=99) || o.items.reduce((sum,i)=>sum+i.price*i.quantity,0)!==o.total) throw new Error('Invalid line items.');
    lock = LockService.getScriptLock(); lock.waitLock(25000);
    const book = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    book.setSpreadsheetTimeZone('Asia/Manila');
    const sheet = book.getSheetByName(CONFIG.TAB_NAME) || book.insertSheet(CONFIG.TAB_NAME);
    if (sheet.getLastRow()===0) { sheet.appendRow(HEADERS); sheet.setFrozenRows(1); sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#2e241a').setFontColor('#f7f5ed'); }
    const ids=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().flat():[];
    const index=ids.indexOf(o.id), row=index<0?sheet.getLastRow()+1:index+2;
    // A delayed retry must never overwrite a newer order status.
    if(index>=0 && Number(sheet.getRange(row,18).getValue())>o.updatedAt) return json({ok:true,id:o.id,updatedAt:o.updatedAt});
    const safe = value => { const s=String(value||'').slice(0,2000); return /^[=+@\-\t\r]/.test(s)?"'"+s:s; };
    const stamp=value=>value?new Date(value):'';
    const values=[o.id,safe(o.number),stamp(o.createdAt),safe(o.customer),safe(o.type),safe(o.table),safe(o.items.map(i=>`${i.quantity} × ${i.name} @ PHP ${i.price/100}`).join('; ')),o.total/100,safe(o.payment),o.cash==null?'':o.cash/100,o.change==null?'':o.change/100,o.status,stamp(o.readyAt),stamp(o.collectedAt),stamp(o.cancelledAt),o.readyAt?Math.floor((o.readyAt-o.createdAt)/1000):o.cancelledAt?Math.floor((o.cancelledAt-o.createdAt)/1000):'',safe(o.notes),o.updatedAt];
    sheet.getRange(row,1,1,HEADERS.length).setValues([values]);
    [3,13,14,15].forEach(col=>sheet.getRange(row,col).setNumberFormat('yyyy-mm-dd hh:mm:ss'));
    sheet.getRange(row,8,1,4).setNumberFormat('0.00');
    SpreadsheetApp.flush();
    return json({ok:true,id:o.id,updatedAt:o.updatedAt});
  } catch(error) { return json({ok:false,error:String(error.message||error)}); }
  finally { if(lock && lock.hasLock())lock.releaseLock(); }
}
function json(value) {return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
