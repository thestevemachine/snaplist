import {createClient} from "@supabase/supabase-js";
import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
import {accountScope,accountsEnabled,currentAccount,type AccountContext} from "./context";
import {sealConnection,openConnection} from "../ebay/session";
export const ACCESS="snaplist_access",REFRESH="snaplist_refresh";
export function accountDb() {
 const url=process.env.SUPABASE_EU_URL, key=process.env.SUPABASE_EU_SECRET_KEY;
 if(!url || !key) throw new Error("Account database is not configured.");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function sameOrigin(req:NextRequest) {
 const origin=req.headers.get("origin");
 return origin===new URL(process.env.APP_URL || req.url).origin;
}
export async function authenticatedAccount(access?:string):Promise<AccountContext|null> {
 if(!access) return null;
 const db=accountDb();
 const {data,error}=await db.auth.getUser(access);
 if(error || !data.user) return null;
 const {data:row,error:readError}=await db.from("snaplist_accounts").select("user_id,disabled,sealed_credentials").eq("user_id",data.user.id).maybeSingle();
 if(readError) throw new Error("Account storage is not available.");
 if(!row || row.disabled) return null;
 const opened=row.sealed_credentials ? await openConnection(row.sealed_credentials) : null;
 if(row.sealed_credentials && !opened) throw new Error("Account credentials could not be decrypted.");
 return {id:data.user.id,email:data.user.email ?? "",owner:data.user.id===process.env.SNAPLIST_OWNER_USER_ID,secrets:opened ? JSON.parse(opened.refreshToken) : {}};
}
export async function saveCredentials(next:Record<string,string>) {
 const user=currentAccount();if(!user) throw new Error("Sign in required.");
 const sealed=await sealConnection({refreshToken:JSON.stringify(next),refreshExpiresAt:0});
 const {error}=await accountDb().from("snaplist_accounts").update({sealed_credentials:sealed}).eq("user_id",user.id).eq("disabled",false);
 if(error) throw new Error("Credentials could not be saved.");
 user.secrets=next;
}
export function setSession(res:NextResponse,session:{access_token:string;refresh_token:string;expires_in:number}) {
 const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/"};
 res.cookies.set(ACCESS,session.access_token,{...options,maxAge:session.expires_in});
 res.cookies.set(REFRESH,session.refresh_token,{...options,maxAge:30*86400});
}
export async function pageAccount() {
 if(!accountsEnabled()) return null;
 const jar=await cookies();return authenticatedAccount(jar.get(ACCESS)?.value);
}
export function withAccount(handler:(req:NextRequest)=>Promise<Response>) {
 return async function(req:NextRequest):Promise<Response> {
  if(!accountsEnabled()) return handler(req);
  try {
   let session;
   let account=await authenticatedAccount(req.cookies.get(ACCESS)?.value);
   if(!account && req.cookies.get(REFRESH)?.value) {
    const result=await accountDb().auth.refreshSession({refresh_token:req.cookies.get(REFRESH)!.value});
    session=result.data.session;
    if(session) account=await authenticatedAccount(session.access_token);
   }
   if(!account) return NextResponse.json({ok:false,code:"SIGN_IN_REQUIRED",error:"Bitte bei SNAPLIST anmelden."},{status:401});
   if(!["GET","HEAD","OPTIONS"].includes(req.method) && (!sameOrigin(req) || req.headers.get("x-snaplist-account")!==account.id)) return NextResponse.json({ok:false,error:"Ungültige Anfrage."},{status:403});
   const response=await accountScope.run(account,()=>handler(req));
   const res=new NextResponse(response.body,{status:response.status,headers:response.headers});
   res.headers.set("Cache-Control","private, no-store");
   if(session) setSession(res,session);
   return res;
  } catch {
   return NextResponse.json({ok:false,error:"Kontozugriff vorübergehend nicht verfügbar."},{status:503});
  }
 };
}
