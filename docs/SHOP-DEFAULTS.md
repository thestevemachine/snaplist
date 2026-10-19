# Shop- und Batch-Vorgaben

Die Einstellungen werden unter einem Hash des verbundenen eBay.de-Benutzernamens in localStorage gespeichert. Sie gelten für zukünftige lokale Entwürfe in diesem Browser. Es gibt noch keine geräteübergreifende Synchronisierung oder Mehrbenutzer-Anmeldung. Die Website verwendet weiterhin den konfigurierten Verkäuferzugang; ein eigenes Profil ersetzt keinen eigenen OAuth-Zugang.

Unter „Shop- und Batch-Vorgaben“ das Konto laden, Versand/Zahlung/Rückgabe/Artikelstandort auswählen (oder aus einer vorhandenen Karte übernehmen) und speichern. Nur IDs aus den aktuell geladenen Kontovorlagen werden übernommen. Entfernte Vorlagen müssen neu gewählt werden. Die echte Übertragung prüft die IDs erneut.

Neue Entwürfe erhalten NEW_NO_TAGS / NEW_OTHER und EAN „Nicht zutreffend“. Die Kategorievorbereitung prüft, ob der Zustand unterstützt wird. Andernfalls bleibt die eBay-Zustandsauswahl offen. Kein stiller Wechsel auf einen anderen Zustand. Detailkarten bleiben editierbar; beim Veröffentlichen werden deren Werte verwendet.

Die optionale Beschreibungsvorlage kann beliebigen DE/EN-Text enthalten. `{{beschreibung}}` fügt den individuellen ursprünglichen Text ein; `{{titel}}` den Titel. Ohne Platzhalter ersetzt die Vorlage die generierte Beschreibung. Stefans bereitgestellter Text steht über einen Einsetzen-Knopf zur Verfügung. Bestehende Karten werden erst über „Vorgaben auf aktuellen Batch anwenden“ geändert; live veröffentlichte oder gerade verarbeitete Karten bleiben unverändert. Wiederholtes Anwenden verdoppelt den Vorlagentext nicht. Individuelle Änderungen sollten vor erneutem Anwenden geprüft werden.

Veröffentlichung bleibt eine Einzelaktion mit sichtbarer Bestätigung. Speichern und Batch-Anwendung senden keine Angebote an eBay.

## Besonderheiten: Wasserfest

Auf ausdrücklichen Verkäuferwunsch wird bei Brillen ein leeres Feld „Besonderheiten“ einmalig mit „Wasserfest“ gefüllt, sofern die aktuelle eBay-Kategorie genau diesen Wert anbietet. Bereits erkannte oder manuell gewählte Besonderheiten bleiben erhalten. Die Oberfläche kennzeichnet dies als Shop-Vorgabe, nicht als durch Fotos geprüfte Eigenschaft. Der Verkäufer kann die Auswahl ändern oder entfernen; die gespeicherte Versionsmarkierung verhindert erneutes Auffüllen nach einer manuellen Entfernung. Bestehende unveröffentlichte Entwürfe mit geladenen Kategorien werden ohne neue KI-Analyse ergänzt; bereits veröffentlichte bzw. gerade übertragene Entwürfe bleiben unberührt. Neue und im Hintergrund vorbereitete Entwürfe verwenden dieselbe Regel serverseitig. Fehlt die zulässige Kategorieauswahl, wird kein Ersatzmerkmal erfunden.
