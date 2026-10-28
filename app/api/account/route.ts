import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {accountDb,ACCESS,REFRESH,authenticatedAccount,saveCredentials,sameOrigin,setSession,withAccount,ensureVault,isOwner} from "@/lib/accounts/server";
import {accountsEnabled,currentAccount,providerKey} from "@/lib/accounts/context";
import {rateLimitRequest} from "@/lib/api-guard";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
 if(!accountsEnabled()) return NextResponse.json({enabled:false});
 return withAccount(async()=>{const u=currentAccount()!;return NextResponse.json({enabled:true,id:u.id,email:u.email,owner:u.owner,providers:Object.fromEntries(["google","openai","anthropic"].map(p=>[p,Boolean(providerKey(p))]))});})(req);
}
export async function POST(req:NextRequest) {
 if(!accountsEnabled()) return NextResponse.json({ok:false,error:"Kontenanmeldung noch nicht aktiviert."},{status:503});
 const limited=rateLimitRequest(req);if(limited)return limited;
 if(!sameOrigin(req))return NextResponse.json({ok:false},{status:403});
 try {
  const body=await req.json();
  if(body.action==="logout") {
   const token=req.cookies.get(ACCESS)?.value;
   if(token) await accountDb().auth.admin.signOut(token,"local");
   const res=NextResponse.json({ok:true});res.cookies.delete(ACCESS);res.cookies.delete(REFRESH);return res;
  }
  if(body.action==="login" || body.action==="accept-invite") {
   const db=accountDb();
   const result=body.action==="login" ? await db.auth.signInWithPassword(z.object({email:z.string().email().max(254),password:z.string().min(1).max(256)}).parse(body)) : await db.auth.verifyOtp({token_hash:z.string().min(20).max(512).parse(body.token),type:"invite"});
   const session=result.data.session;
   if(result.error || !session || !await authenticatedAccount(session.access_token)) return NextResponse.json({ok:false,error:"Anmeldung fehlgeschlagen. Einladung oder Zugangsdaten prüfen."},{status:401});
   const res=NextResponse.json({ok:true});setSession(res,session);return res;
  }
  if(body.action==="resume") {
   const db=accountDb();const refresh=req.cookies.get(REFRESH)?.value;
   if(!refresh)return NextResponse.json({ok:false},{status:401});
   const result=await db.auth.refreshSession({refresh_token:refresh});const session=result.data.session;
   if(!session || !await authenticatedAccount(session.access_token))return NextResponse.json({ok:false},{status:401});
   const res=NextResponse.json({ok:true});setSession(res,session);return res;
  }
  return withAccount(async()=>{
   const u=currentAccount()!;
   if(body.action==="key") {
    const provider=z.enum(["google","openai","anthropic"]).parse(body.provider);
    const key=z.string().max(512).parse(body.key).trim();
    if(key && (key.length<16 || /\s/.test(key))) return NextResponse.json({ok:false,error:"Bitte einen gültigen API-Schlüssel eingeben."},{status:400});
    const next={...u.secrets};if(key || u.owner)next[provider]=key;else delete next[provider];
    await saveCredentials(next);return NextResponse.json({ok:true});
   }
   if(body.action==="password") {
    const password=z.string().min(12).max(256).parse(body.password);
    const db=accountDb();const {error}=await db.auth.admin.updateUserById(u.id,{password});
    if(error)throw error;return NextResponse.json({ok:true});
   }
   if(body.action==="disable-member" && u.owner) {
    const id=z.string().uuid().parse(body.id);
    if(id===u.id)return NextResponse.json({ok:false,error:"Das Besitzerkonto kann hier nicht gesperrt werden."},{status:400});
    const db=accountDb();const target=await db.auth.admin.getUserById(id);
    if(!target.data.user?.app_metadata?.snaplist || isOwner(target.data.user))return NextResponse.json({ok:false},{status:403});
    const {error}=await db.auth.admin.updateUserById(id,{app_metadata:{...target.data.user.app_metadata,snaplist:{active:false}}});
    if(error)throw error;return NextResponse.json({ok:true});
   }
   if(body.action==="invite" && u.owner) {
    const email=z.string().email().max(254).parse(body.email).toLowerCase();
    const db=accountDb();const {data,error}=await db.auth.admin.generateLink({type:"invite",email});
    if(error || !data.user || !data.properties?.hashed_token)throw new Error("Invite failed");
    const activated=await db.auth.admin.updateUserById(data.user.id,{app_metadata:{...data.user.app_metadata,snaplist:{active:true}}});
    if(activated.error)throw activated.error;
    const url=new URL("/login",process.env.APP_URL || req.url);url.hash=`invite=${encodeURIComponent(data.properties.hashed_token)}`;
    return NextResponse.json({ok:true,url:url.toString()});
   }
   return NextResponse.json({ok:false,error:"Aktion nicht erlaubt."},{status:403});
  })(req);
 } catch {return NextResponse.json({ok:false,error:"Aktion fehlgeschlagen. Eingaben und Kontoeinrichtung prüfen."},{status:400});}
}
