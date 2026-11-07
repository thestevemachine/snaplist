# Checker — privater Vinted-Assistent

Separater Entwicklungszweig: `codex/snaplist-checker`, Basis `640d4f4` (Kamera-Orientierungsfix). Dritter Navigationsbereich `/checker` neben Snaplist und Re-Lister.

Pro Artikel bis zu zwölf Fotos hochladen oder die bestehende Live-Kamera verwenden. Artikel explizit abschließen; während der Erstellung nächste Fotos aufnehmen. Aufträge werden nacheinander verarbeitet. Jede Ergebniskarte zeigt sämtliche Fotos, Speichern/Teilen sowie editierbare und einzeln kopierbare Titel, Beschreibung und EUR-Preis. Originaldateien werden zum Speichern verwendet, verkleinerte Bilder zur KI-Analyse.

Das Web kann nicht direkt in die iOS-Fotomediathek schreiben: unterstützte Geräte öffnen das Teilen-Menü, in dem der Nutzer „Bilder sichern“ wählt. Ansonsten Dateidownload, auch pro Bild. Ergebnisse und Originale werden nur im geöffneten Reiter gehalten; vor Navigation/Neuladen sichern.

Preisquelle ist ausdrücklich eine KI-Schätzung, keine Vinted-Abfrage. Es besteht kein Vinted-Datenanschluss; keine erfundenen Vergleichsangebote. Für eine spätere Recherche müssen tatsächliche Vergleichsquellen samt Datum, Artikelpassung und Kennzeichnung von Angebotspreisen ergänzt werden.

API nutzt vorhandene Kontoprüfung, Request-Guard, Modellfreigabe, persönliche Anbieter-Schlüssel und Verbrauchserfassung. Genau ein Anbieteraufruf pro bewusster Erstellung, keine automatischen Wiederholungen oder Modellwechsel. Keine eBay-Veröffentlichung.

## Prüfung am 07.11.2026

- Produktionsbuild (`next build`) erfolgreich, einschließlich Typprüfung und `/checker` sowie `/api/checker`.
- Sieben Tests erfolgreich: Ergebnisschema, Zugangssperre, Eingabegrenzen, validierte Antwort, keine automatischen Wiederholungen bei ungültigen oder abgeschnittenen KI-Antworten. Der Konten-Wrapper wird im API-Test simuliert; dies ist kein neuer Nachweis der Kontenanmeldung.
- Drei Chromium-Browsertests erfolgreich: zwei Artikel getrennt zuordnen, editierte Texte und Preis einzeln kopieren, Originalfoto herunterladen; Fehler erhalten Fotos und erlauben bewussten Neuversuch; Live-Kamera mit zwei aufeinanderfolgenden Artikeln. Kamera und KI-Antworten simuliert, keine bezahlten Anbieteraufrufe.
- Mobile Ansicht mit 390 × 844 Pixeln ohne horizontales Überlaufen geprüft, Screenshot visuell kontrolliert.
- Typprüfung und `git diff --check` erfolgreich.

Wiederholbare Befehle bei installiertem Node.js und Abhängigkeiten:

```sh
npm run build
npx vitest run tests/checker.test.ts tests/checker-route.test.ts
npx playwright test --config playwright.checker.config.ts
```

Die Browserkonfiguration verwendet einen lokal installierten Google Chrome. Die vorhandene ChatGPT-Node-Laufzeit verweigert native Module wegen macOS-Bibliothekssignaturen; mit einer separaten offiziellen Node.js-Laufzeit funktionieren die Tests.

Offen: Kamera und Teilen-Menü/Mediathek auf einem echten iPhone sowie echte Anbieterantworten prüfen. Ergebnisse sind nur im geöffneten Reiter gespeichert. Keine Live-Vinted-Recherche, kein Deployment, keine Veröffentlichung und keine bezahlten KI-Testaufrufe durch die Entwicklung.
