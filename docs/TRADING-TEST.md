# Ein Brillenangebot über die Trading API testen

## Verhalten

`POST /api/ebay/verify` prüft das konkrete Angebot mit `VerifyAddFixedPriceItem`.
Dabei entsteht weder ein aktives Angebot noch ein Seller-Hub-Entwurf. Die Fotos
werden vorher über eBay Picture Services hochgeladen. Entwürfe bleiben lokal
im Browser gespeichert. „Entwurf speichern“ sichert den aktuellen Arbeitsstand
auf diesem Gerät, auch wenn noch Pflichtfelder fehlen oder eBay nicht verbunden
ist. Zusätzlich bleibt die automatische Speicherung aktiv. Der Knopf erstellt
keinen Entwurf im eBay Seller Hub.

`POST /api/ebay/publish` benötigt `confirmed: true`, prüft erneut mit
`VerifyAddFixedPriceItem` und erstellt genau ein Festpreisangebot mit
`AddFixedPriceItem`. Es wird sofort aktiv (GTC, Menge 1, Preis in EUR,
Preisvorschläge ausgeschaltet). Die Oberfläche zeigt davor Titel, SKU, Preis
und eine ausdrückliche Bestätigung. Sammelveröffentlichung ist für diesen
Einzeltest nicht verfügbar. Ein hoher Preis verhindert einen Kauf nicht sicher.

Der aktive Übertragungsweg erstellt keine Inventory-Items/Offers und migriert
keine bestehenden Angebote. Alte Inventory-Hilfen in `publish.ts` sind nicht an
die neue Route angebunden. Die zurückgegebene ItemID öffnet das Angebot auf
eBay.de. Die Bearbeitbarkeit im Seller Hub muss beim ersten echten Test noch
manuell bestätigt werden.

## Voraussetzungen

- Vorhandene serverseitige Zugangsdaten laut `SHARED-EBAY-CONNECTION.md`.
- `EBAY_MARKETPLACE_ID=EBAY_DE`, `EBAY_CATEGORY_TREE_ID=77`, `EBAY_CURRENCY=EUR`.
  Andere Einstellungen werden vor der Übertragung abgewiesen.
- Ein vorbereiteter Entwurf mit gültiger Kategorie, Zustand, Pflichtmerkmalen,
  vollständigen Bildern, positivem Preis und drei bestehenden eBay.de-Policies.
- Artikelstandort: Die eBay-Kontoadresse wird als ausdrücklich bezeichnete
  Auswahl angeboten. Nur wählen, wenn sie tatsächlich der Versandstandort ist.
  Fehlt sie oder stimmt sie nicht, noch nicht veröffentlichen. Es wird keine
  Inventory-Lageradresse erstellt oder geraten.

## Manueller Ablauf nach Bereitstellung

1. Bestehende SNAPLIST-Seite im selben Browser neu laden. Keinen neuen Batch
   starten; die gespeicherten Fotos/Entwürfe behalten.
2. `eBay.de-Zugang prüfen` anklicken. Der Test liest nur Kontodaten/Policies.
3. Genau eine Brille in `Detailed cards` öffnen. Kategorie vorbereiten, Zustand,
   Pflichtmerkmale, Rahmenbedingungen, tatsächlichen Artikelstandort und Preis
   bewusst kontrollieren. Die vorhandenen Texte/Preise werden nicht automatisch
   übersetzt oder umgerechnet.
4. `Bei eBay prüfen · nicht veröffentlichen` anklicken. Fehler zuerst beheben;
   angezeigte Gebühren und Warnungen prüfen.
5. Nur wenn gewünscht: `Auf eBay.de veröffentlichen…` anklicken und den konkreten
   Preis bestätigen. Ein hoher Preis ist keine Verkaufssperre.
6. Die zurückgegebene Angebotsnummer im Seller Hub unter aktiven Angeboten
   öffnen, `Bearbeiten` testen und das Ergebnis prüfen. Das Ende des Tests und
   eventuelles Beenden des Angebots bestimmt der Nutzer.

## Fehler und Wiederholungen

Gleiche SKU → gleiche 32-stellige UUID, auch nach Neuladen/Preisänderung.
Trading-SKU-Tracking verhindert gleichzeitig aktive gleiche SKUs; UUID verhindert
wiederholtes Anlegen einer bereits erfolgreichen Anfrage. Es gibt keine
automatischen Add-Wiederholungen, keine automatische Revision und keine
Änderungen an anderen Angeboten. Bei Timeout oder Duplikatfehler zuerst im
Seller Hub nachsehen und die SKU nicht ändern, um erneut zu versuchen.

## Nachweise und Grenzen

Automatisierte Tests verwenden simulierte eBay-Antworten: XML-Escaping,
Deutschland/EUR, richtige Policies und Zustand, Prüfung ohne Add, Bestätigung,
Duplikate, Timeout und keine Inventory-Aufrufe im neuen Weg. Ein erfolgreicher
Build und diese Tests ersetzen keinen echten eBay-Verifikationstest.
`ebay-ki-tools` und `ebay_oauth_tokens.id=1` werden nicht verändert.

Referenzen:
- https://developer.ebay.com/devzone/xml/docs/Reference/ebay/VerifyAddFixedPriceItem.html
- https://developer.ebay.com/devzone/xml/docs/Reference/ebay/AddFixedPriceItem.html
- https://developer.ebay.com/api-docs/sell/inventory/overview.html
