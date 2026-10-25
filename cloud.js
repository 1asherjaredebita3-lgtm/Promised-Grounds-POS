import { CLOUD_CONFIG } from './config.js';
const SESSION_KEY='promised-grounds-staff-session';
let session=null;
try {session=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{}
export const configured=()=>/^https:\/\/[\w-]+\.supabase\.co$/.test(CLOUD_CONFIG.url)&&Boolean(CLOUD_CONFIG.publishableKey);
export const signedIn=()=>Boolean(session?.access_token);
export const getAccessToken=()=>session?.access_token||null;
export async function fetchSharedMenu(){
  return request('/rest/v1/menu_items?select=id,name,category,description,price,offer_hot_iced,hot_price,iced_price,available,updated_at&order=category.asc,name.asc');
}
export async function deleteSharedMenuItem(id){
  if(!session?.access_token)throw Error('Sign in as approved staff before editing the shared menu.');
  return request('/rest/v1/menu_items?id=eq.'+encodeURIComponent(id),{method:'DELETE',staff:true});
}
export async function saveSharedMenuItem(item){
  if(!session?.access_token)throw Error('Sign in as approved staff before editing the shared menu.');
  return request('/rest/v1/menu_items?on_conflict=id',{
    method:'POST',staff:true,prefer:'resolution=merge-duplicates,return=minimal',
    body:{...item,updated_at:new Date().toISOString()},
  });
}
async function request(path,{method='GET',body,staff=false,prefer}={}){
  if(!configured())throw Error('Complete config.js with your Supabase project URL and publishable key.');
  if(staff&&session?.expires_at<Date.now()/1000+30)await refreshSession();
  if(staff&&!session?.access_token)throw Error('Sign in to publish customer orders.');
  const headers={apikey:CLOUD_CONFIG.publishableKey,'Content-Type':'application/json'};
  if(staff)headers.Authorization=`Bearer ${session.access_token}`;
  if(prefer)headers.Prefer=prefer;
  const response=await fetch(CLOUD_CONFIG.url+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.msg||data?.message||data?.error_description||`Connection failed (${response.status}).`);
  return data;
}
function saveSession(data){session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Date.now()/1000+data.expires_in};sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));}
async function refreshSession(){
  const old=session;session=null;
  try{const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:old.refresh_token}});saveSession(data);}catch(error){sessionStorage.removeItem(SESSION_KEY);throw error;}
}
export async function signIn(email,password){
  const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  saveSession(data);
  try {const allowed=await request('/rest/v1/staff_users?select=user_id&limit=1',{staff:true});if(!allowed?.length)throw Error('This account is not approved as café staff.');}
  catch(error){session=null;sessionStorage.removeItem(SESSION_KEY);throw error;}
}
export async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST',staff:true});}finally{session=null;sessionStorage.removeItem(SESSION_KEY);}}
export async function publishOrder(order){
  return request('/rest/v1/rpc/save_cafe_order',{method:'POST',staff:true,body:{p_order:order}});
}
export async function readLiveOrders(){
  return request('/rest/v1/live_orders?select=id,number,first_name,status,created_at,ready_at&order=created_at.asc&limit=250');
}
export const refreshDelay=()=>Math.max(10,CLOUD_CONFIG.refreshSeconds||10)*1000;
