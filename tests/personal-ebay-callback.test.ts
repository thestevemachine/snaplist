import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({exchange:vi.fn(),save:vi.fn(),account:{id:'11111111-1111-4111-8111-111111111111',secrets:{google:'personal-key'}}}));
vi.mock("@/lib/accounts/context",()=>({accountsEnabled:()=>true,currentAccount:()=>mocks.account}));
vi.mock("@/lib/accounts/server",()=>({withAccount:(fn:unknown)=>fn,saveCredentials:mocks.save}));
vi.mock("@/lib/ebay/oauth",()=>({exchangeCode:mocks.exchange}));
vi.mock("@/lib/api-guard",()=>({rateLimitRequest:()=>null}));
import {GET} from "@/app/api/ebay/callback/route";
import {ebayState,validEbayState} from "@/lib/ebay/oauth-state";
import {openConnection} from "@/lib/ebay/session";
let state:string;
function request(query:Record<string,string>,cookie=state){return new NextRequest('https://snaplist.example/api/ebay/callback?'+new URLSearchParams(query),{headers:{cookie:'ebay_oauth_state='+cookie}});}
beforeEach(()=>{vi.stubEnv('SESSION_SECRET','fixture-session-key-with-at-least-32-characters');vi.stubEnv('APP_URL','https://snaplist.example');state=ebayState(mocks.account.id);mocks.exchange.mockReset().mockResolvedValue({refresh_token:'member-refresh',refresh_token_expires_in:5000});mocks.save.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
it('binds namespaced state to both account and browser nonce',()=>{expect(validEbayState(state,state,mocks.account.id)).toBe(true);expect(validEbayState(state,state,'22222222-2222-4222-8222-222222222222')).toBe(false);expect(validEbayState(state,state+'x',mocks.account.id)).toBe(false);});
it('saves the grant only through the current account vault and clears the nonce',async()=>{const res=await GET(request({state,code:'fixture-code'}));expect(res.headers.get('location')).toContain('ebay=connected');expect(mocks.exchange).toHaveBeenCalledOnce();expect(mocks.save).toHaveBeenCalledOnce();const saved=mocks.save.mock.calls[0][0];expect(saved.google).toBe('personal-key');expect((await openConnection(saved.ebay))?.refreshToken).toBe('member-refresh');expect(res.headers.get('set-cookie')).toContain('ebay_oauth_state=;');});
it('rejects another account, missing nonce, cancellation and duplicate state without exchange',async()=>{
 const wrong=ebayState('22222222-2222-4222-8222-222222222222');await GET(request({state:wrong,code:'x'},wrong));await GET(request({state,code:'x'},''));await GET(request({state,error:'access_denied'}));await GET(request({state,code:'x',error:'access_denied'}));const req=request({state,code:'x'});req.nextUrl.searchParams.append('state',state);await GET(req);expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it('does not store grants on eBay failure or missing refresh token',async()=>{mocks.exchange.mockRejectedValueOnce(new Error('fixture failure'));await GET(request({state,code:'x'}));mocks.exchange.mockResolvedValueOnce({access_token:'short-only'});await GET(request({state,code:'x'}));expect(mocks.save).not.toHaveBeenCalled();});
