"use client";
import {useEffect,useState} from "react";
type Account={enabled:boolean;email:string;owner:boolean;providers:Record<string,boolean>};
export function AccountSettings(){
 const [account,setAccount]=useState<Account|null>(null),[message,setMessage]=useState(""),[provider,setProvider]=useState("google"),[key,setKey]=useState(""),[email,setEmail]=useState(""),[url,setUrl]=useState(""),[password,setPassword]=useState("");
 async function refresh(){const r=await fetch("/api/account",{cache:"no-store"});if(r.ok)setAccount(await r.json());}
 useEffect(()=>{void refresh();window.addEventListener("ai-credentials-changed",refresh);return()=>window.removeEventListener("ai-credentials-changed",refresh);},[]);
 async function action(body:Record<string,string>){setMessage("");try{const r=await fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json","x-snaplist-account":document.body.dataset.account ?? ""},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error || "Aktion fehlgeschlagen");return data;}catch(e){setMessage(e instanceof Error ? e.message : "Aktion fehlgeschlagen");return null;}}
 if(!account?.enabled)return null;
 return <details className="panel"><summary>Mein Konto · {account.email}</summary>
 <p>KI-Schlüssel werden verschlüsselt auf dem Server gespeichert. Es werden ausschließlich deine eigenen KI-Zugänge verwendet.</p>
 <label>Anbieter<select value={provider} onChange={e=>{setProvider(e.target.value);setKey("");}}><option value="google">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Claude</option></select></label>
 <p>{account.providers[provider] ? "Eigener Schlüssel gespeichert" : "Noch kein eigener Schlüssel"}</p>
 <form onSubmit={async e=>{e.preventDefault();if(await action({action:"key",provider,key})){setKey("");setMessage("Gespeichert. Verbindungstest unter KI-Einstellungen starten.");window.dispatchEvent(new Event("ai-credentials-changed"));void refresh();}}}><label>Dein API-Schlüssel<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required/></label><button className="btn" type="submit">Schlüssel speichern</button></form>
 <button className="btn" onClick={async()=>{if(confirm("Eigenen KI-Schlüssel entfernen?")){if(await action({action:"key",provider,key:""})){window.dispatchEvent(new Event("ai-credentials-changed"));void refresh();}}}}>Schlüssel entfernen</button>
 <form onSubmit={async e=>{e.preventDefault();if(await action({action:"password",password})){setPassword("");setMessage("Passwort gespeichert.");}}}><label>Neues Passwort (mindestens 12 Zeichen)<input type="password" minLength={12} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="btn">Passwort speichern</button></form>
 {account.owner && <form onSubmit={async e=>{e.preventDefault();const result=await action({action:"invite",email});if(result)setUrl(result.url);}}><label>Person einladen · E-Mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><button className="btn">Persönlichen Einladungslink erstellen</button>{url && <label>Einmaligen Link privat weitergeben<textarea readOnly value={url}/></label>}</form>}
 {message && <p role="status">{message}</p>}<button className="btn" onClick={async()=>{if(await action({action:"logout"}))location.replace("/login");}}>Abmelden</button>
 </details>;
}
