# Live-Foto: Entwicklung und Pilot

Ausgangspunkt ist GitHub `main` bei `9c8bca2` (PR #59). Der Re-Lister liegt in
[Draft #46](https://github.com/thestevemachine/snaplist/pull/46) und ist auf diesem
Branch nicht enthalten. Weder dessen Branch noch die uncommitteten Änderungen in
der separaten Snaplist-Arbeitskopie wurden übernommen.

## Ablauf und Schnittstelle

- `/live-foto` nutzt eine durchgehende Rückkamera, wenn verfügbar. Der Auslöser
  reserviert die Foto-ID und die Artikelrevision, bevor die Bildverarbeitung
  startet. IndexedDB speichert JPEG, Thumbnail und Manifest in einer
  Transaktion. Web Locks verhindern konkurrierende Änderungen derselben lokalen
  Sitzung. Hochgeladen wird erst nach dem Commit. Zwei Übertragungen sind
  parallel möglich; Fehler lassen das Foto lokal, temporäre Fehler werden
  wiederholt und nach Neuladen aus dem Journal fortgesetzt. Die Kamera muss
  nach Neuladen wieder geöffnet werden.
- `POST /api/live-foto`: `authorize` setzt vor Schreibzugriff das Browser-Cookie;
  `session` → `open` → `upload` → `seal` übergibt
  genau eine Artikelrevision. `list`, `result` und `image` liefern Status,
  geprüften Entwurf und dessen Manifestfotos. `code`/`pair` geben einem
  anderen Browser zehn Minuten Zeit zur Kopplung. Der Code ist innerhalb
  der Frist erneut einlösbar und vertraulich zu behandeln. Das HttpOnly-Cookie
  erlaubt 12 Stunden ausschließlich lesenden Zugriff auf diese Sitzung. Beide
  Geräte benötigen den vorhandenen App-Zugangscode. Es gibt kein geräteübergreifendes
  Bearbeiten der lokalen Snaplist-Entwürfe und keine Übertragung des eBay-Cookies.
- Bestehende `lister_*`-Tabellen und private Buckets, mit separaten
  `settings.source`-Markern für Live-Foto. Pro Artikelrevision eine Cloud-Batch,
  mit einem unveränderlichen Manifest. Der vorhandene Inngest-Auftrag verwendet
  `analyzePhotos`, `prepareListing` und `researchListing`. Der eindeutige
  Jobschlüssel und dieselbe Inngest-Ereignis-ID machen Wiederholungen sicher;
  der bestehende Dispatcher übernimmt unzugestellte Aufträge. Eine Revision
  speichert nur ihr eigenes Resultat. Neue Revisionen bereits übergebener
  Artikel referenzieren unveränderte, geprüfte Fotos der Vorgängerrevision;
  bei einer noch nicht übergebenen Vorgängerrevision kann ein Foto erneut
  übertragen werden. Ältere Entwürfe sind nach Abschluss einer neueren Revision
  nicht erneut importierbar.
- Snaplist zeigt fertige Ergebnisse unter **Live-Foto-Entwürfe**. „Entwurf
  übernehmen“ speichert denselben `ItemGroup`- und `Photo`-Typ wie der
  normale Entwurfsablauf in dessen IndexedDB. Ein bereits importierter
  Entwurf wird durch eine neue Revision nicht überschrieben. Die
  Veröffentlichung ist weiterhin eine gesonderte, manuelle Aktion in Snaplist.
- ZIP-Export im Aufnahmebrowser pro Brille und pro Sitzung, einschließlich
  noch nicht hochgeladener Fotos. Ordner enthalten SKU, Artikelkürzel und
  Revision. Bis zu 300 Fotos pro ZIP. Der Download speichert eine ZIP-Datei über den Browser. Kein
  automatischer Zugriff auf die Mediathek; kein serverseitiges ZIP-Archiv.

## Bildweg und Sicherheit

Pro Aufnahme liegt serverseitig ein geprüftes JPEG (höchstens 2 MB / 2400 px
lange Kante). Der Server dekodiert mit begrenzter Pixelzahl, richtet aus und
entfernt Metadaten. Neue Dateien haben serverseitig abgeleitete Pfade; eine
bestehende Datei wird nicht überschrieben. Erst Storage-`info` und der
anschließende Datenbank-Commit bestätigen den Upload. Analysedateien werden
aus dem JPEG zur Laufzeit auf maximal 1600 px verkleinert. Thumbnails bleiben
lokal. Kein Base64 in Datenbankspalten.

Bewusste Pilotentscheidung: JPEG über den geschützten App-Endpunkt statt eines
direkten Browser-Uploads. So ist jeder Upload vor Ablage vollständig validiert,
ohne Quarantäneobjekt oder überschreibbare Upload-URL. Der Transport enthält
temporär Base64 (unter 2,7 MB); keine privilegierten Storage-Schlüssel im
Browser. Bei diesen Größen startet der Retry nur die einzelne Aufnahme neu.
[Supabase empfiehlt TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
insbesondere ab 6 MB und bei unzuverlässigem Netz. Direkter Upload in einen
isolierten Quarantänepfad und TUS sind erst nach Pilotmessung zu bewerten.

## Kamera und Messung

[MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
setzt einen sicheren Kontext und Berechtigung voraus.
[`ImageCapture.takePhoto()`](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)
wird nur verwendet, wenn verfügbar und erfolgreich. [WebKit führt die API
ab Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/),
[Chrome ab Version 59 auf Android](https://developer.chrome.com/blog/imagecapture/).
Sonst ist die tatsächliche
Videoauflösung die Obergrenze. Die App skaliert nicht hoch. Android/Chrome
und iOS/Safari können unterschiedliche Auflösungen, Fokus und Zoom liefern.
In der normalen Ansicht und im Vollbild steht ein digitaler Zoom von 1× bis
3× zur Verfügung. Oberhalb von 1× speichert die App den mittleren Ausschnitt
des Videobilds in seiner tatsächlichen Pixelauflösung. Der Zoom vergrößert
die Ansicht, liefert aber keine zusätzlichen Bilddetails. Im Vollbild bleiben
Auslöser, Artikelabschluss und Kameraschließen direkt verfügbar. Beim
Artikelabschluss bleibt der Stream aktiv. Makro-Autofokus, Linsenwechsel
und die Qualität der nativen Kamera-App hängen vom Gerät ab.
Bei unscharfen Bügelbeschriftungen Abstand, Licht und Kamerawinkel ändern oder
den gekennzeichneten Datei-Upload verwenden.

Messpunkte: Aufnahme inkl. Verarbeitung, IndexedDB-Commit, Upload-Anfrage bis
Antwort, serverseitige Validierung, Transfer in den Objektspeicher und
Empfangsprüfung; Job-Zeit von Einreihung bis fertigem Entwurf. Browserprobe
mit Chrome 156.0.8078.80 auf macOS, 393 × 852, simuliertem 640 × 480-Videostream:
41–43 ms Aufnahme und Aufbereitung, 1–3 ms IndexedDB, 4 ms simulierte
Upload-Anfrage und Antwort (12 ms inklusive Sitzungsaufbau), am lokal
gebauten Release-Artefakt. In dieser
Probe war Aufnahme/Aufbereitung der längste gemessene Einzelschritt.
Die Testantworten liefen lokal; das misst weder Mobilfunk, Supabase,
produktive KI noch eine Verbesserung gegenüber dem bisherigen Workflow.
Keine physischen iOS- oder Android-Geräte getestet.

## Aufbewahrung und Bereinigung

Snaplist übernimmt beim Import eine eigene lokale Kopie. Der Live-Foto-Cloud-
Speicher bleibt Eigentümer der serverseitigen Fotos und der Referenzen in
unveränderlichen Manifesten. Bilder mit Manifestreferenz bleiben erhalten.
Der bisherige Snaplist-Ablauf für alte Cloud-Batches behält seine Löschregeln;
Live-Foto ist explizit von dessen pauschalem Ablauf ausgenommen.

- Neuer Inngest-Probelauf `sweep-live-photo-orphans`: höchstens 50 markierbare
  Fotos je Lauf, mindestens sieben Tage alt, aus seit sieben Tagen
  abgeschlossenen Live-Foto-Batches und außerhalb ihrer Manifeste. Es werden
  nur IDs gemeldet. `LIVE_FOTO_ORPHAN_SWEEP=apply` ist ausschließlich in
  Nicht-Produktionsumgebungen wirksam. Vor Löschung wird das unveränderliche
  Manifest erneut geprüft und der Fotoeintrag als gelöscht markiert. Erst nach
  Bestätigung des Storage-Löschaufrufs fällt der Dateiverweis weg. Ein Fehler
  lässt den markierten Datensatz für erneuten Versuch bestehen. Analysebilder
  und Exportarchive haben keine dauerhaften Serverobjekte.
- Offene Batches älter als 30 Tage sind lediglich Prüfkandidaten. Offline
  pausierte Sitzungen lassen sich serverseitig nicht sicher von abgebrochenen
  Sitzungen unterscheiden. Vor einer späteren Aktivierung sind eine sichtbare
  Warnfrist, Verlängerung und ein gegen Weiterbearbeitung abgesicherter
  Übergang nötig. Keine Anwendung auf vorhandene Snaplist-Daten.
- Automatische Löschung nach eBay-Veröffentlichung ist gesperrt.
  Der bestehende Weg lädt über
  [UploadSiteHostedPictures](https://developer.ebay.com/DevZone/XML/docs/Reference/eBay/UploadSiteHostedPictures.html)
  und veröffentlicht mit den dabei gelieferten URLs. Die Dokumentation nennt
  den 30.09.2026 als Abschalttermin und empfiehlt die Media API. Die derzeitige
  Implementierung liefert für Live-Foto keine belastbare unabhängige Prüfung,
  die sämtliche Bilder dem tatsächlich aktiven Angebot zuordnet. Auch ein
  HTTP-Erfolg oder ein eBay-CDN-Hostname allein reichen dafür nicht.
  `scheduledDeletion` testet die vorbereitete Regel: 24 Stunden ab Prüfung,
  auf gültigen Wunsch später (z. B. sieben Tage); fehlende Bildübernahme,
  Fehler, unklarer Ausgang oder aktive Referenz sperren die Löschung.
  Diese Regel ist bewusst noch an keinen Veröffentlichungs- oder Löschhook
  angeschlossen. Deshalb gibt es aktuell kein angezeigtes Löschdatum.
- Browserkopien und bereits heruntergeladene ZIPs bleiben unter Kontrolle
  des Nutzers. Die App kann einen geschlossenen Browser nicht bereinigen.
  Die Vorschau hat keine geprüften Zusagen zur physischen Löschung aus
  Backups oder eventueller Storage-Versionierung. eBay und Mediathek werden
  von keiner Bereinigung berührt.

## Lokale Generalprobe

```sh
npm ci
npm test
npm run typecheck
npm run build
# Separates Terminal, keine echten Zugangsdaten:
APP_SECRET=local-browser-only ANTHROPIC_API_KEY=not-real npm run dev -- --hostname 127.0.0.1 --port 3191
# Chromium installieren oder LIVE_TEST_CHROME mit lokalem Chrome setzen:
LIVE_TEST_EXTERNAL_SERVER=1 npm run test:browser:live
```

Der Servicetest nutzt echten Route- und Worker-Code mit simuliertem
Supabase-Storage, Datenbank, Inngest-Transport und KI. Der Browsertest
simuliert Kamera und API-Antworten; er prüft reale IndexedDB, Neuladen,
ZIP-Integrität sowie Übernahme und Wiederherstellung im separaten
Browserprofil. Ein zusätzlicher Test öffnet Chromes simuliertes Gerät über
die echte Browser-API und prüft, dass die Kamera auf der Snaplist-Hauptseite
gesperrt bleibt. Veröffentlichungsnachweise und Löschfehler werden ohne
eBay-Zugriff geprüft. Kein echter Storage-, KI- oder eBay-Lauf.

## Pilot und Zusammenführung

1. Isolierte Vorschau mit privaten Test-Buckets und Inngest einrichten.
   Vorhandene Cloud-Migrationen genügen; keine neue Datenbank nötig.
   `LIVE_FOTO_ENABLED=true` zusätzlich zur bestehenden Cloud-Konfiguration
   setzen, Orphan-Sweep im Probelauf belassen. Keine produktiven Daten nutzen.
2. Je zwei bis drei Brillen auf iPhone/Safari und Android/Chrome: Front,
   Bügelinschrift und Schaden, Hoch-/Querformat, ein Netzwechsel und
   Bildschirm sperren. Auflösung und Lesbarkeit im exportierten JPEG gegen
   native Kamera vergleichen. Zeiten und Fehler je Phase erfassen.
3. Computer koppeln, Entwürfe und Export prüfen. eBay-Veröffentlichung und
   Bildübernahme nur mit getrennt freigegebenen Testzugängen prüfen; zuerst
   den tatsächlich verwendeten Medien-Endpunkt verifizieren. Keine
   Aufbewahrungsregel ohne nachweisbare vollständige Bildübernahme aktivieren.
4. Beim Zusammenführen von PR #46 Navigation in `app/layout.tsx` zu drei
   Links zusammenführen; in `app/api/inngest/route.ts` Funktionslisten
   additiv kombinieren. Live-Foto verwendet keine Re-Lister-Module. Die
   getrennte Re-Lister-Arbeitskopie enthält zusätzlich eine Supabase-Anmeldung.
   Falls diese mitgeführt wird, vor einem gemeinsamen Release Live-Foto
   ebenfalls an `withAccount` und die verifizierte Konto-ID binden; in
   einer Account-Installation darf der alte Zugangscode kein Ersatz für
   die Anmeldung sein.
   Die Änderungen der anderen lokalen Snaplist-Arbeitskopie getrennt
   integrieren und insbesondere Fotoimport, API-Guard und Draft-Storage erneut
   testen.
