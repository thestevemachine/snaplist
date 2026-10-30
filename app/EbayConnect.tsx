"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadAccountOptions,
  clearAccountOptions,
} from "@/lib/account-options-client";
import { apiPost } from "@/lib/api-client";

interface Status {
  configured: boolean;
  connected: boolean;
  sharedConfigured?: boolean;
  personalConnectionReady?: boolean;
}

export function EbayConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );
  const [sellerName, setSellerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [pasteValue, setPasteValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/ebay/status", { cache: "no-store" });
      setStatus((await r.json()) as Status);
    } catch {
      setStatus({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Surface the result of an OAuth round-trip (?ebay=connected|declined|error).
    const params = new URLSearchParams(window.location.search);
    const e = params.get("ebay");
    if (e === "connected")
      setNotice({ ok: true, msg: "eBay account connected!" });
    else if (e === "declined")
      setNotice({ ok: false, msg: "eBay connection was declined." });
    else if (e === "error")
      setNotice({
        ok: false,
        msg: params.get("msg") || "eBay connection failed.",
      });
    if (e) window.history.replaceState({}, "", window.location.pathname);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setSellerName("");
      if (!status?.connected) return;
      try {
        const account = await loadAccountOptions();
        if (active)
          setSellerName(account.sellerName || "Kontoname nicht verfügbar");
      } catch {
        if (active) setSellerName("Konto nicht bestätigt – Zugang prüfen");
      }
    };
    void load();
    window.addEventListener("ebay-connection-changed", load);
    return () => {
      active = false;
      window.removeEventListener("ebay-connection-changed", load);
    };
  }, [status?.connected]);

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiPost("/api/ebay/disconnect", {});
      clearAccountOptions();
      window.dispatchEvent(new Event("ebay-connection-changed"));
      await refresh();
      setNotice({ ok: true, msg: "Disconnected from eBay." });
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiPost("/api/ebay/auth", {});
      const data = (await r.json()) as {
        ok: boolean;
        url?: string;
        error?: string;
      };
      if (!data.ok || !data.url)
        throw new Error(data.error || "Couldn't start eBay authorization.");
      setAuthorizeUrl(data.url);
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const finishConnect = async () => {
    if (!pasteValue.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiPost("/api/ebay/connect", { url: pasteValue.trim() });
      const data = (await r.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Couldn't connect.");
      setPasteValue("");
      clearAccountOptions();
      window.dispatchEvent(new Event("ebay-connection-changed"));
      await refresh();
      setNotice({ ok: true, msg: "eBay account connected!" });
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testStoredConnection = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiPost("/api/ebay/readiness", {});
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "Der Verbindungstest ist fehlgeschlagen.",
        );
      setNotice({
        ok: true,
        msg: result.message || "eBay-Verbindung bestätigt.",
      });
    } catch (error) {
      setNotice({ ok: false, msg: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Stored credentials are used server-side for preparation and Trading calls.
  if (status?.sharedConfigured)
    return (
      <div className="ebay-bar">
        <span className="ebay-label">
          Gespeicherter eBay-Zugang: {sellerName || "Konto wird geladen…"} ·
          eBay.de · EUR
        </span>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={testStoredConnection}
        >
          {busy ? "Verbindung wird geprüft…" : "eBay.de-Zugang prüfen"}
        </button>
        {notice && (
          <span
            role="status"
            className={`ebay-notice${notice.ok ? "" : " err"}`}
          >
            {notice.msg}
          </span>
        )}
      </div>
    );

  if(status && !status.connected && status.personalConnectionReady===false)
    return <div className="ebay-bar"><span className="ebay-dot" aria-hidden="true"/><span>Dein SNAPLIST-Konto ist eingerichtet. Die persönliche eBay-Verbindung muss Stefan noch freischalten.</span></div>;

  // If eBay isn't configured on the server, show nothing (the writing flow
  // still works fine without it).
  if (!status?.configured) return null;

  return (
    <div className={`ebay-bar${status.connected ? " connected" : ""}`}>
      <span className="ebay-dot" aria-hidden="true" />
      {status.connected ? (
        <>
          <span className="ebay-label">
            eBay-Konto: {sellerName || "Konto wird geladen…"}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={disconnect}
            disabled={busy}
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <span className="ebay-label">
            <strong>Step 1:</strong> authorize on eBay
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={startConnect}
            disabled={busy}
          >
            Open eBay ↗
          </button>
          {authorizeUrl && (
            <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">
              Continue to eBay ↗
            </a>
          )}
          <div className="ebay-paste">
            <label htmlFor="ebay-paste">
              <strong>Step 2:</strong> after you click <em>Agree</em>, copy the
              URL from eBay&rsquo;s page and paste it here:
            </label>
            <div className="ebay-paste-row">
              <input
                id="ebay-paste"
                type="text"
                placeholder="https://auth2.ebay.com/oauth2/…?code=…"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={finishConnect}
                disabled={busy || !pasteValue.trim()}
              >
                {busy ? "Connecting…" : "Finish connecting"}
              </button>
            </div>
          </div>
        </>
      )}
      {notice && (
        <span className={`ebay-notice${notice.ok ? "" : " err"}`}>
          {notice.msg}
        </span>
      )}
    </div>
  );
}
