# KI-Anbieter, Modellvergleich und Kosten

Stand der offiziellen Modell-/Preisprüfung: 19.10.2026. Bestehende Claude-Modelle,
Prompts, Fotoprüfung, deutsche Brillenregeln und manuelle Bearbeitung bleiben
erhalten. Eine kleine Nachrichtenadapter-Grenze verwendet dieselbe Pipeline.
Keine zusätzlichen Anbieter-SDKs und kein Qwen, Gateway oder automatischer Fallback.

## Einrichtung

In Vercel → Projekt **snaplist** → Settings → Environment Variables:

| Anbieter | Serverseitige Einstellung | Zugang |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` (bestehend) | Anthropic Console |
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/api-keys |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |

Als **Secret** für Production speichern und neu bereitstellen. Preview braucht
eigene Einstellungen. Niemals `NEXT_PUBLIC_` verwenden oder Werte in Chat, Git
oder Browserformularen speichern. Die Anwendung zeigt nur, ob eine Einstellung
vorhanden ist. ChatGPT-Abonnements ersetzen kein OpenAI-API-Guthaben.

**KI-Einstellungen** öffnen. Fotosortierung und Listing-Erstellung unabhängig
auswählen. Die vorhandenen gerätebezogenen Einstellungen werden wiederverwendet;
ein Modellwechsel startet keine Analyse. Nicht verfügbare gespeicherte Modelle
bleiben sichtbar und werden nicht still durch teurere Modelle ersetzt.

Die Schaltflächen **Verbindung testen (kostenpflichtig)** starten nach Bestätigung
je einen kurzen Textaufruf. Das prüft Schlüssel und Modellzugriff. Die Bildqualität
wird separat mit einer Brille verglichen. Ohne Schlüssel stoppen die Anbieter vor
dem Netzwerkaufruf. Keine API-Schlüssel werden im Browser angefordert.

## Geprüfte Bildmodelle und Standardpreise

USD pro 1 Million Token, kein Batch-/Flex-Rabatt; keine Rechnungsbeträge:

| Modell | Eingabe | Gecachte Eingabe | Ausgabe inkl. Denken |
|---|---:|---:|---:|
| Gemini 3.8 Flash | 0,75 | 0,075 | 3,75 |
| Gemini 3.5 Flash-Lite | 0,30 | 0,03 | 2,50 |
| Gemini 2.5 Flash-Lite | 0,10 | 0,01 | 0,40 |
| GPT-6 Luna | 0,10 | 0,01 | 0,50 |
| GPT-5.4 mini | 0,75 | 0,075 | 4,50 |

Gemini 3.8 Flash: Aktionspreis bis 31.12.2026; ab 01.01.2027 werden die
angekündigten 1,50 / 0,15 / 7,50 verwendet. GPT-6 Luna: Eingabe/Cache über
272.000 Eingabe-Token doppelt, Ausgabe 1,5-fach; Cache-Schreiben 0,125/M.
Die API-Abrechnung kann durch Steuern, Guthaben, Freikontingent oder neue Preise
abweichen. Die Preistabelle muss bei Preisänderungen erneut geprüft werden.
GPT-5.4 nano wird wegen des Deprecation-Hinweises nicht neu angeboten.

Offizielle Quellen:

- Google Preise: https://ai.google.dev/gemini-api/docs/pricing
- Google Bildfähigkeiten: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
  und https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- Google API/Tokenfelder/JSON-Schema: https://ai.google.dev/api/generate-content
- OpenAI: https://developers.openai.com/api/docs/models/gpt-6-luna
  und https://developers.openai.com/api/docs/models/gpt-5.4-mini
- OpenAI Bildverarbeitung: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI JSON-Schema: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Cache-Abrechnung: https://developers.openai.com/api/docs/guides/prompt-caching

## Verbrauch und Vergleich

Jeder gemeldete Aufruf erhält eine Kennung, Zeitpunkt, Anbieter, angefordertes
und tatsächlich gemeldetes Modell, Eingabe-, Cache- und Ausgabe-Token.
Gemini-Denktoken werden zur Ausgabe addiert. OpenAI-Denktoken sind bereits in
den Ausgabe-Token enthalten und werden nicht doppelt berechnet. Kosten werden
mit dem Preis zum Aufrufzeitpunkt berechnet und mit dem Entwurf gespeichert.

Die Kostenanzeige pro Brille umfasst Analyse/Profilrouting/Vorbereitung;
gemeinsame Sortierkosten erscheinen separat. Die Fotoserie summiert alle
Brillen, Sortieraufrufe und Vergleiche nach Modell. Sortierkosten werden nicht
willkürlich als exakter Einzelpreis auf Brillen verteilt. Verbindungstests
werden separat gespeichert. Der Durchschnitt pro Brille inklusive Sortierung
ist ausdrücklich eine geschätzte Zuordnung und schließt Vergleiche aus.
Fehlende Nutzungsdaten heißen **unbekannt**, nicht
kostenlos. USD werden nicht mit Euro gleichgesetzt; eine Euro-Umrechnung wäre
eine zusätzliche Schätzung. Das Ziel unter 3 Eurocent ist noch nicht empirisch
bestätigt und erfordert einen Vergleich mit echten Brillen.

Unter den eBay-Details einer Brille **Modelle vergleichen** öffnen. Ein Modell
auswählen und die Kosten bestätigen. Der Vergleich verwendet dieselben
gespeicherten Analysefotos (einschließlich des hochauflösenden letzten Fotos)
und dieselben Regeln. Ergebnisse und Verbrauch werden als separate Varianten
im vorhandenen lokalen Entwurfsspeicher gespeichert; ursprünglicher Entwurf,
SKU, manuelle Änderungen und eBay-Status bleiben erhalten.

Keine automatische Wiederholung einer bezahlten Analyse, kein Wechsel auf
andere Modelle bei Fehlern. Auch Hintergrundjobs wiederholen Analysen nicht
mehr selbständig. Neuanalyse bestehender Entwürfe verlangt Bestätigung.
Sortierung bleibt der vorhandene mehrstufige Ablauf mit gewähltem Modell.

Praktischer Qualitätscheck: dieselben Brillen und Fotos mit Claude und den
Sparmodellen vergleichen, insbesondere Beschriftungen, Maße, Material,
Brillenart und manuelle Korrekturen prüfen. Keine automatische Veröffentlichung.
