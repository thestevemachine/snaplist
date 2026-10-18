# Gespeicherten eBay-Zugang prüfen

Diese erste Integrationsstufe prüft den bestehenden Zugang aus `ebay-ki-tools`.
Sie aktiviert weder die Angebotsveröffentlichung noch die bisherige
Cookie-Verbindung von SNAPLIST.

## Server-Einstellungen in SNAPLIST

- `SUPABASE_EU_URL`: HTTPS-Adresse der vorhandenen EU-Datenbank.
- `SUPABASE_EU_SECRET_KEY`: ausschließlich serverseitiger Supabase-Schlüssel.
- `EBAY_TOKEN_ENCRYPTION_KEY`: derselbe 64-stellige Hex-Schlüssel wie im Quellprojekt.
- `EBAY_CLIENT_ID` und `EBAY_CLIENT_SECRET`: App ID und Cert ID desselben
  **Production-Schlüsselpaars, das den gespeicherten Refresh-Token erzeugt hat**.
  Ein Token einer anderen eBay-App lässt sich damit nicht erneuern.
- `APP_SECRET`: bestehender Zugangscode für geschützte SNAPLIST-Funktionen.

Keine dieser Einstellungen darf mit `NEXT_PUBLIC_` beginnen. Geheimnisse nicht
in Git, Browsercode, Protokolle oder Chatnachrichten kopieren. In Vercel müssen
die Einstellungen für die Umgebung des Deployments vorliegen. Die vorhandenen
Einstellungen sind ausschließlich für Production hinterlegt; eine normale
Preview-Veröffentlichung kann deshalb keinen echten Verbindungstest ausführen.

## Test

SNAPLIST öffnen und **eBay-Verbindung testen** wählen. Falls gefragt, den
bestehenden SNAPLIST-Zugangscode direkt in der Anwendung eingeben.

Der geschützte `POST /api/ebay/test-connection` führt ausschließlich Folgendes aus:

1. `ebay_oauth_tokens`, Zeile `id = 1`, Spalte `refresh_token_encrypted` lesen.
2. Das vorhandene Format `v1:iv:tag:ciphertext` mit AES-256-GCM im Server entschlüsseln.
3. Den Refresh-Token am Production-OAuth-Endpunkt gegen einen kurzlebigen Zugang tauschen.
   Ohne neue Scope-Anforderung bleiben die ursprünglichen Freigaben maßgeblich.
4. Versandrichtlinien für `EBAY_MARKETPLACE_ID` lesend abfragen.

Erfolg wird erst nach Schritt 4 gemeldet. Leere Richtlinienlisten sind erlaubt.
Es werden keine Datenbankänderungen, Foto-Uploads, Bestandsänderungen, Angebote
oder Veröffentlichungen ausgelöst. Der Test setzt keine Verbindungscookies.
Schlüssel und Kontodaten erscheinen nicht in der Antwort; Antworten werden
nicht zwischengespeichert.

Bei einem Fehler nennt die Anwendung den betroffenen Schritt. App-Zugangsdaten
müssen zum ursprünglichen Token gehören. Wird nur das Lesen abgelehnt, die
ursprünglichen eBay-Freigaben sowie den konfigurierten Marktplatz prüfen.

Nach erfolgreichem echten Test kann in einem eigenen nächsten Schritt die
Verwendung dieses Zugangs für die weiteren SNAPLIST-Funktionen erfolgen.
`ebay-ki-tools` und seine Datenbankzeile bleiben dabei unverändert.
