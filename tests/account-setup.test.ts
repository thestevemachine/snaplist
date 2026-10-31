import {beforeEach,afterEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),login:vi.fn(),vault:vi.fn(),setSession:vi.fn()}));
vi.mock("@/lib/accounts/server",()=>({accountDb:()=>({auth:{admin:{createUser:mocks.create},signInWithPassword:mocks.login}}),ensureVault:mocks.vault,sameOrigin:(r:Request)=>r.headers.get("origin")==="https://snaplist.example",setSession:mocks.setSession}));
import {NextRequest} from "next/server";
import {POST} from "@/app/api/account/setup/route";
const req=(body:unknown,origin="https://snaplist.example")=>new NextRequest("https://snaplist.example/api/account/setup",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("SNAPLIST_ACCOUNTS_ENABLED","true");vi.stubEnv("SNAPLIST_OWNER_EMAIL","owner@example.com");vi.stubEnv("APP_SECRET","existing-owner-code");mocks.vault.mockResolvedValue(undefined);mocks.create.mockResolvedValue({data:{user:{id:"owner-id"}},error:null});mocks.login.mockResolvedValue({data:{session:{access_token:"fixture",refresh_token:"fixture-refresh",expires_in:3600}}});});
afterEach(()=>vi.unstubAllEnvs());
it("requires the previous owner credential and same origin before provisioning anything",async()=>{
 expect((await POST(req({password:"my-new-password",code:"wrong"}))).status).toBe(403);
 expect((await POST(req({password:"my-new-password",code:"existing-owner-code"},"https://evil.example"))).status).toBe(403);
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.vault).not.toHaveBeenCalled();
});
it("never lets the request choose the owner email or role",async()=>{
 const r=await POST(req({password:"my-new-password",code:"existing-owner-code",email:"attacker@example.com",role:"owner"}));
 expect(r.status).toBe(200);expect(mocks.create).toHaveBeenCalledWith({email:"owner@example.com",password:"my-new-password",email_confirm:true,app_metadata:{snaplist:{active:true}}});expect(mocks.setSession).toHaveBeenCalled();
});
it("does not reset or overwrite any existing Auth account",async()=>{
 mocks.create.mockResolvedValue({data:{user:null},error:{message:"already exists"}});
 expect((await POST(req({password:"my-new-password",code:"existing-owner-code"}))).status).toBe(409);expect(mocks.login).not.toHaveBeenCalled();expect(mocks.setSession).not.toHaveBeenCalled();
});
it("rejects weak passwords and stops when private storage cannot initialize",async()=>{
 expect((await POST(req({password:"short",code:"existing-owner-code"}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
 mocks.vault.mockRejectedValue(new Error("storage unavailable"));expect((await POST(req({password:"my-new-password",code:"existing-owner-code"}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
});
