"use client";
import {useEffect,useState,type FormEvent} from "react";
export default function Login(){
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[invite,setInvite]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{const token=new URLSearchParams(location.hash.slice(1)).get("invite");if(token){setInvite(token);history.replaceState(null,"","/login");}else void fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json","x-snaplist-account":document.body.dataset.account ?? ""},body:JSON.stringify({action:"resume"})}).then(r=>{if(r.ok)location.replace("/");});},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");try{
 const r=await fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json","x-snaplist-account":document.body.dataset.account ?? ""},body:JSON.stringify(invite ? {action:"accept-invite",token:invite} : {action:"login",email,password})});const data=await r.json();if(!r.ok)throw new Error(data.error);location.assign("/");
 }catch(e){setMessage(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen.");}finally{setBusy(false);}}
 return <main className="wrap"><section className="panel"><h1>Bei SNAPLIST anmelden</h1><p>Dein Arbeitsbereich, dein eBay-Konto und deine eigenen KI-Zugänge.</p><form onSubmit={submit}>
 {invite ? <p>Persönliche Einladung annehmen. Lege danach unter „Mein Konto“ dein Passwort fest. Teile deinen Einladungslink nicht mit anderen.</p> : <><label>E-Mail<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label></>}
 <button className="btn btn-primary" disabled={busy}>{busy ? "Bitte warten…" : invite ? "Einladung annehmen" : "Anmelden"}</button>{message && <p role="alert">{message}</p>}</form><p>Zugang nur mit persönlicher Einladung des Betreibers. <a href="/privacy">Datenschutz und Datenverarbeitung</a></p></section></main>;
}
