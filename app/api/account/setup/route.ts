import {NextRequest,NextResponse} from "next/server";
import {createHash,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {rateLimitRequest} from "@/lib/api-guard";
import {accountsEnabled} from "@/lib/accounts/context";
import {accountDb,ensureVault,sameOrigin,setSession} from "@/lib/accounts/server";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest) {
 if(!accountsEnabled() || !process.env.SNAPLIST_OWNER_EMAIL || !process.env.APP_SECRET)return NextResponse.json({ok:false},{status:404});
 const limited=rateLimitRequest(req);if(limited)return limited;
 if(!sameOrigin(req))return NextResponse.json({ok:false},{status:403});
 try {
  const body=z.object({password:z.string().min(12).max(256),code:z.string().max(512)}).parse(await req.json());
  const hash=(value:string)=>createHash("sha256").update(value).digest();
  if(!timingSafeEqual(hash(body.code),hash(process.env.APP_SECRET)))return NextResponse.json({ok:false,error:"Der bisherige SNAPLIST-Zugangscode stimmt nicht."},{status:403});
  const db=accountDb();await ensureVault();
  // Unique Auth email prevents second claims. Never overwrite an existing user
  // or reset a password in this shared Supabase project.
  const result=await db.auth.admin.createUser({email:process.env.SNAPLIST_OWNER_EMAIL.toLowerCase(),password:body.password,email_confirm:true,app_metadata:{snaplist:{active:true}}});
  if(result.error || !result.data.user)return NextResponse.json({ok:false,error:"Das Besitzerkonto besteht möglicherweise bereits. Bitte mit E-Mail und Passwort anmelden; bestehende Konten werden hier nicht verändert."},{status:409});
  const login=await db.auth.signInWithPassword({email:process.env.SNAPLIST_OWNER_EMAIL.toLowerCase(),password:body.password});
  if(!login.data.session)throw new Error("Owner login failed");
  const res=NextResponse.json({ok:true});setSession(res,login.data.session);return res;
 } catch {return NextResponse.json({ok:false,error:"Einrichtung fehlgeschlagen. Passwort muss mindestens 12 Zeichen haben; bitte erneut versuchen."},{status:400});}
}
