import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const refresh=vi.hoisted(()=>vi.fn(async(token:string)=>({access_token:`access:${token}`,expires_in:7200})));
vi.mock("@/lib/ebay/oauth",()=>({refreshAccessToken:refresh}));
const state=vi.hoisted(()=>({users:new Map<string,{id:string,email:string}>(),members:new Map<string,{user_id:string,disabled:boolean,sealed_credentials?:string}>()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({
 auth:{getUser:vi.fn(async(token:string)=>({data:{user:state.users.get(token) ?? null},error:null})),refreshSession:vi.fn(async()=>({data:{session:null}}))},
 from:()=>{let id="";const query={select:()=>query,eq:(name:string,value:string)=>{if(name==="user_id")id=value;return query;},maybeSingle:async()=>({data:state.members.get(id) ?? null,error:null})};return query;}
})}));
import {NextRequest,NextResponse} from "next/server";
import {withAccount,authenticatedAccount} from "@/lib/accounts/server";
import {accountsEnabled,accountScope,currentAccount,providerKey} from "@/lib/accounts/context";
import {sealConnection,sellerAccessToken} from "@/lib/ebay/session";
import {isSharedEbayConfigured,sharedAccessToken} from "@/lib/ebay/shared-connection";
import {guardApiRequest} from "@/lib/api-guard";
import {cloudEnabled} from "@/lib/cloud/store";
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const ctx=(id:string,owner=false,secrets:Record<string,string>={})=>({id,email:`${id}@example.com`,owner,secrets});
function request(token?:string,method="GET",origin="https://snaplist.example",pageId=a){return new NextRequest("https://snaplist.example/api/test",{method,headers:{...(token?{cookie:`snaplist_access=${token}`} : {}),origin,"x-snaplist-account":pageId}});}
beforeEach(()=>{vi.stubEnv("SNAPLIST_ACCOUNTS_ENABLED","true");vi.stubEnv("APP_URL","https://snaplist.example");vi.stubEnv("SNAPLIST_OWNER_USER_ID",a);vi.stubEnv("SUPABASE_EU_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_EU_SECRET_KEY","server-only");vi.stubEnv("EBAY_TOKEN_ENCRYPTION_KEY","legacy");vi.stubEnv("SESSION_SECRET","test-session-secret-at-least-32-characters");vi.stubEnv("GEMINI_API_KEY","owner-global-key");vi.stubEnv("ANTHROPIC_API_KEY","owner-global-claude");state.users.clear();state.members.clear();for(const [id,token] of [[a,"a-token"],[b,"b-token"]]){state.users.set(token,{id,email:`${id}@example.com`});state.members.set(id,{user_id:id,disabled:false});}});
afterEach(()=>vi.unstubAllEnvs());
describe("account isolation",()=>{
 it("rejects anonymous callers before the handler runs",async()=>{const h=vi.fn(async()=>NextResponse.json({ok:true}));expect((await withAccount(h)(request())).status).toBe(401);expect(h).not.toHaveBeenCalled();});
 it("does not trust registration or user metadata without active membership",async()=>{state.members.delete(b);expect(await authenticatedAccount("b-token")).toBeNull();state.members.set(b,{user_id:b,disabled:true});expect(await authenticatedAccount("b-token")).toBeNull();});
 it("derives identity from verified auth, never request identifiers",async()=>{const h=withAccount(async()=>NextResponse.json({id:currentAccount()!.id,owner:currentAccount()!.owner}));const res=await h(request("b-token"));expect(await res.json()).toEqual({id:b,owner:false});});
 it("blocks wrong origins and stale-account writes",async()=>{const h=vi.fn(async()=>NextResponse.json({ok:true}));expect((await withAccount(h)(request("a-token","POST","https://evil.example"))).status).toBe(403);expect((await withAccount(h)(request("b-token","POST","https://snaplist.example",a))).status).toBe(403);expect(h).not.toHaveBeenCalled();expect((await withAccount(h)(request("b-token","POST","https://snaplist.example",b))).status).toBe(200);});
 it("runs verified members without the shared APP_SECRET",async()=>{expect(await accountScope.run(ctx(b),()=>guardApiRequest(request("b-token","POST","https://snaplist.example",b)))).toBeNull();});
 it("never lends global KI keys or legacy eBay connections to members",async()=>{await accountScope.run(ctx(b),async()=>{expect(providerKey("google")).toBe("");expect(providerKey("anthropic")).toBe("");expect(isSharedEbayConfigured()).toBe(false);expect(await sellerAccessToken("legacy-cookie")).toBeNull();await expect(sharedAccessToken()).rejects.toThrow();expect(cloudEnabled()).toBe(false);});});
 it("uses only a member's own encrypted eBay grant, ignoring a valid old seller cookie",async()=>{
  const old=await sealConnection({refreshToken:"owner-refresh",refreshExpiresAt:Date.now()+100000});
  const own=await sealConnection({refreshToken:"member-refresh",refreshExpiresAt:Date.now()+100000});
  refresh.mockClear();
  expect(await accountScope.run(ctx(b),()=>sellerAccessToken(old))).toBeNull();expect(refresh).not.toHaveBeenCalled();
  expect(await accountScope.run(ctx(b,false,{ebay:own}),()=>sellerAccessToken(old))).toBe("access:member-refresh");
  expect(refresh).toHaveBeenCalledWith("member-refresh");
 });
 it("isolates provider keys across interleaved asynchronous requests",async()=>{const values=await Promise.all([accountScope.run(ctx(a,true,{google:"a-key"}),async()=>{await new Promise(r=>setTimeout(r,5));return providerKey("google");}),accountScope.run(ctx(b,false,{google:"b-key"}),async()=>{await Promise.resolve();return providerKey("google");})]);expect(values).toEqual(["a-key","b-key"]);});
 it("fails closed if a server call loses its account context",()=>{expect(()=>providerKey("google")).toThrow();expect(()=>isSharedEbayConfigured()).toThrow();});
 it("preserves existing single-owner behavior while rollout is disabled",()=>{vi.stubEnv("SNAPLIST_ACCOUNTS_ENABLED","false");expect(accountsEnabled()).toBe(false);expect(providerKey("google")).toBe("owner-global-key");expect(isSharedEbayConfigured()).toBe(true);});
});
