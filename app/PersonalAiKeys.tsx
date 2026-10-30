"use client";
import {useEffect,useId,useState} from "react";
import {apiPost} from "@/lib/api-client";
const labels:Record<string,string>={openai:"OpenAI",google:"Google Gemini",anthropic:"Claude"};
type Availability={enabled:boolean;providers:Record<string,boolean>};
export function PersonalAiKeys(){
 const id=useId();const [account,setAccount]=useState<Availability|null>(null),[provider,setProvider]=useState("openai"),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{let active=true;const refresh=async()=>{try{const r=await fetch("/api/account",{cache:"no-store"});if(!r.ok)throw Error();const data=await r.json();if(data.enabled && (!data.providers || typeof data.providers!=="object"))throw Error();if(active)setAccount(data);}catch{if(active)setMessage("KI-Zugänge konnten nicht geladen werden. Bitte erneut bei SNAPLIST anmelden.");}};void refresh();window.addEventListener("ai-credentials-changed",refresh);return()=>{active=false;window.removeEventListener("ai-credentials-changed",refresh);};},[]);
 async function save(remove=false){
  if(busy)return;setBusy(true);setMessage("");
  try{const r=await apiPost("/api/account",{action:"key",provider,key:remove ? "" : key.trim()});const data=await r.json();if(!r.ok || !data.ok)throw Error(data.error || "Schlüssel konnte nicht gespeichert werden.");setKey("");setMessage(remove ? `${labels[provider]}-Schlüssel entfernt.` : `${labels[provider]}-Schlüssel sicher gespeichert. Jetzt unten ein Modell auswählen und bei Bedarf die Verbindung testen.`);window.dispatchEvent(new Event("ai-credentials-changed"));}
  catch(e){setMessage(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");}finally{setBusy(false);}
 }
 return <section className="personal-ai-keys" aria-labelledby={id+"-heading"}>
 <h3 id={id+"-heading"}>Deine KI-Zugänge</h3>
 {account?.enabled && <>
 <p>Hier deinen eigenen API-Schlüssel eingeben. Er wird verschlüsselt in deinem Konto auf dem Server gespeichert und danach nicht angezeigt.</p>
 <form onSubmit={e=>{e.preventDefault();void save();}}>
 <label htmlFor={id+"-provider"}>KI-Anbieter</label><select id={id+"-provider"} value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setKey("");setMessage("");}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
 <small>{account.providers[provider] ? "Zugang eingerichtet" : "Noch kein eigener Schlüssel gespeichert"}</small>
 <label htmlFor={id+"-key"}>API-Schlüssel</label><input id={id+"-key"} type="password" autoComplete="off" spellCheck={false} maxLength={512} value={key} disabled={busy} onChange={e=>setKey(e.target.value)} required/>
 <div><button type="submit" className="btn btn-primary" disabled={busy || key.trim().length<16}>{busy ? "Wird gespeichert…" : "API-Schlüssel speichern"}</button> <button type="button" className="btn-ghost" disabled={busy || !account.providers[provider]} onClick={()=>{if(window.confirm(`${labels[provider]}-Schlüssel aus deinem Konto entfernen?`))void save(true);}}>Schlüssel entfernen</button></div>
 </form>
 {provider==="openai" && <p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI-API-Schlüssel erstellen ↗</a> · OpenAI-API-Zugang mit eigenem Guthaben erforderlich.</p>}
 </>}
 {account && !account.enabled && <p>Persönliche KI-Zugänge benötigen ein angemeldetes SNAPLIST-Konto.</p>}
 {!account && !message && <p>Zugänge werden geladen…</p>}
 {message && <p role="status">{message}</p>}
 </section>;
}
