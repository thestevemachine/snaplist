import {afterEach,beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({vault:new Map<string,string>()}));
const member='22222222-2222-4222-8222-222222222222',owner='11111111-1111-4111-8111-111111111111';
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{getUser:async(token:string)=>({data:{user:['owner','member'].includes(token)?{id:token==='owner'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',email:token+'@example.com',app_metadata:{snaplist:{active:true}}}:null},error:null})},storage:{from:()=>({download:async(path:string)=>state.vault.has(path)?{data:{text:async()=>state.vault.get(path)!},error:null}:{data:null,error:{statusCode:'404'}},upload:async(path:string,text:string)=>{state.vault.set(path,text);return {error:null}}})}})}));
import {NextRequest} from "next/server";
import {GET,POST} from "@/app/api/account/route";
const fixture='sk-fixture-member-only-123456789';
function req(token='member',body?:unknown,pageId=member){return new NextRequest('https://snaplist.example/api/account',{method:body?'POST':'GET',headers:{origin:'https://snaplist.example',cookie:'snaplist_access='+token,'x-snaplist-account':pageId,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(()=>{state.vault.clear();vi.stubEnv('SNAPLIST_ACCOUNTS_ENABLED','true');vi.stubEnv('APP_URL','https://snaplist.example');vi.stubEnv('SNAPLIST_OWNER_USER_ID',owner);vi.stubEnv('SUPABASE_EU_URL','https://fixture.supabase.co');vi.stubEnv('SUPABASE_EU_SECRET_KEY','server-only-fixture');vi.stubEnv('SESSION_SECRET','fixture-session-secret-at-least-32-characters');vi.stubEnv('OPENAI_API_KEY','owner-global-fixture-key');});
afterEach(()=>vi.unstubAllEnvs());
it('stores member keys encrypted only under that member and returns booleans without raw keys',async()=>{
 expect((await (await GET(req())).json()).providers.openai).toBe(false);
 const response=await POST(req('member',{action:'key',provider:'openai',key:fixture}));expect(response.status).toBe(200);expect(await response.text()).not.toContain(fixture);
 expect([...state.vault.keys()]).toEqual([member+'/credentials.json']);expect(state.vault.get(member+'/credentials.json')).not.toContain(fixture);
 const data=await (await GET(req())).json();expect(data.providers.openai).toBe(true);expect(JSON.stringify(data)).not.toContain(fixture);
 const other=await (await GET(req('owner',undefined,owner))).json();expect(other.providers.openai).toBe(true);expect(state.vault.has(owner+'/credentials.json')).toBe(false);
});
it('denies anonymous and stale-account writes and validates provider and key format',async()=>{
 expect((await POST(req('unknown',{action:'key',provider:'openai',key:fixture}))).status).toBe(401);
 expect((await POST(req('member',{action:'key',provider:'openai',key:fixture},owner))).status).toBe(403);
 expect((await POST(req('member',{action:'key',provider:'qwen',key:fixture}))).status).toBe(400);
 expect((await POST(req('member',{action:'key',provider:'openai',key:'short'}))).status).toBe(400);expect(state.vault.size).toBe(0);
});
it('removes only the selected personal provider and never falls back to owner keys',async()=>{
 await POST(req('member',{action:'key',provider:'google',key:'fixture-google-key-123456789'}));await POST(req('member',{action:'key',provider:'openai',key:fixture}));await POST(req('member',{action:'key',provider:'openai',key:''}));
 const data=await (await GET(req())).json();expect(data.providers.openai).toBe(false);expect(data.providers.google).toBe(true);expect(process.env.OPENAI_API_KEY).toBe('owner-global-fixture-key');
});
