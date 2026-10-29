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
export const VAULT_BUCKET="snaplist-account-vault";
export function isOwner(user:{id:string;email?:string}) {
 return process.env.SNAPLIST_OWNER_USER_ID ? user.id===process.env.SNAPLIST_OWNER_USER_ID : Boolean(process.env.SNAPLIST_OWNER_EMAIL && user.email?.toLowerCase()===process.env.SNAPLIST_OWNER_EMAIL.toLowerCase());
}
export async function ensureVault() {
 const db=accountDb();
 const {data,error}=await db.storage.getBucket(VAULT_BUCKET);
 if(data) {if(data.public)throw new Error("Account vault must be private.");return;}
 if(error && !["400","404"].includes(String((error as {statusCode?:string}).statusCode)))throw new Error("Account vault unavailable.");
 const created=await db.storage.createBucket(VAULT_BUCKET,{public:false,fileSizeLimit:32768,allowedMimeTypes:["application/json"]});
 if(created.error && String((created.error as {statusCode?:string}).statusCode)!=="409")throw new Error("Account vault could not be initialized.");
}
export async function authenticatedAccount(access?:string):Promise<AccountContext|null> {
 if(!access) return null;
 const db=accountDb();
 const {data,error}=await db.auth.getUser(access);
 if(error || !data.user) return null;
 // app_metadata is writable only by the trusted Auth admin API, never by a user.
 const membership=data.user.app_metadata?.snaplist;
 if(!membership?.active) return null;
 const result=await db.storage.from(VAULT_BUCKET).download(`${data.user.id}/credentials.json`);
 let secrets:Record<string,string>={};
 if(result.error) {
  if(!["400","404"].includes(String((result.error as {statusCode?:string}).statusCode)))throw new Error("Account vault unavailable.");
 } else {
  const sealed=await result.data.text();const opened=await openConnection(sealed);
  if(!opened)throw new Error("Account credentials could not be decrypted.");
  secrets=JSON.parse(opened.refreshToken);
 }
 return {id:data.user.id,email:data.user.email ?? "",owner:isOwner(data.user),secrets};
}
export async function saveCredentials(next:Record<string,string>) {
 const user=currentAccount();if(!user) throw new Error("Sign in required.");
 const sealed=await sealConnection({refreshToken:JSON.stringify(next),refreshExpiresAt:0});
 const {error}=await accountDb().storage.from(VAULT_BUCKET).upload(`${user.id}/credentials.json`,sealed,{upsert:true,contentType:"application/json",cacheControl:"0"});
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
