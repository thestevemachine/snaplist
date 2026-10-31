# Maße aus dem vorhandenen Frontfoto

Neue Brillenanalysen erkennen Konturpunkte im ohnehin ausgewählten Listingmodell. Es gibt keinen zusätzlichen KI-Aufruf, keinen Modellwechsel, keine automatische Neuanalyse bestehender Entwürfe und keine neue Bildanforderung. Die zusätzliche strukturierte Ausgabe verursacht zusätzliche Ausgabe-Token innerhalb desselben Aufrufs; sie wird im vorhandenen Token-/Kostenprotokoll erfasst. Alte Entwürfe bleiben unverändert.

Die Geometrie verwendet genau ein Frontfoto. Bügel-/Brückenaufdrucke aus der bestehenden Aufdruckerkennung liefern ausschließlich die bekannte Scheibenbreite als Referenz. Fehlende oder widersprüchliche Referenzen werden nicht erraten. Brillengröße, Modellnummer und Shop-Vorgaben werden nicht als Maßstab verwendet.

Die KI meldet normierte Konturpunkte, keine Millimeterwerte. Der Server liest die tatsächliche JPEG-/PNG-/WebP-Bildgröße aus dem Header und berechnet daraus Pixelspannen. So werden unterschiedliche Bildseitenverhältnisse korrekt berücksichtigt, ohne Bilddekodierung oder weitere Abhängigkeiten. Nicht sicher unterstützte Bildausrichtungen und ungültige Header ergeben unbekannte Maße; die Listinganalyse funktioniert weiter.

- Scheibenbreite/-höhe: maximale horizontale/vertikale Nut-zu-Nut-Spanne, ohne Fassungsrand (Boxing-System, keine diagonalen Punktabstände).
- Gesamtbreite: äußerster linker bis äußerster rechter Punkt einschließlich Scharnieren und sichtbaren Bügelteilen.
- mm je Pixel = aufgedruckte Scheibenbreite / Scheibenbreite in Pixeln.
- Scheibenhöhe bzw. Gesamtbreite in mm = jeweilige Pixelspanne × mm je Pixel. Erst das Ergebnis wird mit `Math.round` auf ganze Millimeter gerundet.

Beide Gläser dienen der Konsistenzprüfung. Abweichende Größen, Perspektive, unklare Nuten, abgeschnittene Außenkonturen, geringe Auflösung/Konfidenz und Bügel außerhalb der Messebene werden markiert. Unplausible/ungültige Daten liefern keine Millimeterwerte. Die Schwellenwerte sind konservative Softwareprüfungen, keine kalibrierte physikalische Genauigkeitsgarantie. Die Nut kann bei eingebauten Gläsern oder dicken Rändern verborgen sein; dann muss die Erkennung unsicher melden. Keine perspektivische 3D-Rekonstruktion.

Die Prüfkarte „Erkannte Bügelaufdrucke und Maße“ zeigt Referenzaufdruck und Quellfotos, Pixelwerte, Formel, gerundete Ergebnisse und Unsicherheitsgründe. Die Ergebnisse werden als Schätzung gespeichert, auch im Cloud-Ergebnis und beim Modellvergleich über denselben Analysepfad. Sie überschreiben keine manuellen/aufgedruckten Maße und werden in leere passende eBay-Maßfelder ausschließlich als gekennzeichnete Schätzung übernommen. Vorhandene Werte sowie ausdrücklich manuell geleerte Maßfelder bleiben erhalten. Die editierbare Messnotiz bleibt erhalten. Änderungen am Referenzaufdruck nach der Analyse ändern das gespeicherte Analyseergebnis nicht; Referenz und Rechenstand bleiben sichtbar.

Die Rechnung ist automatisiert getestet. Die tatsächliche Erkennungsgenauigkeit ist ohne Vergleich echter Frontfotos mit unabhängig gemessenen Brillen noch nicht belegt. Vor produktiver Übernahme mit mehreren bekannten Brillen überprüfen; ein Neukalkulieren bestehender Entwürfe erfordert die bestehende ausdrückliche kostenpflichtige Analysebestätigung. Keine echten eBay-Veröffentlichungen zur Prüfung.


## Reparatur der Feldübernahme und gezielter Maßtest

Eine Notiz allein füllte bisher die tatsächlichen Kategorie-Felder Glashöhe/Rahmenbreite nicht. Die gemeinsame Funktion `frontMeasurementFields` ergänzt nun fehlende bzw. noch leere Kategorie-Maße beim Vorbereiten und beim Öffnen gespeicherter Entwürfe. Sie verwendet exakt passende Dropdownwerte oder freie numerische mm-Felder. Manuelle Werte werden nicht überschrieben; manuelles Leeren wird ab dieser Version in `manual_measurement_fields` gespeichert, damit Neuladen nichts erneut ergänzt. Unsichere Ergebnisse bleiben ausdrücklich Schätzungen und sichtbar als unsicher markiert.

Bei fehlender Konturerkennung reicht Neuladen nicht: Ohne gespeicherte Geometrie lässt sich nichts neu berechnen. „Nur Brillenmaße berechnen · Entwurf behalten“ lässt ein vorhandenes Frontfoto auswählen und startet nach Kostenbestätigung genau einen Aufruf beim bisher verwendeten Modell. `/api/ai/measure` prüft Zugriffscode, Bestätigung, Modellfreigabe, Fotoheader und vorhandenen Referenzaufdruck vor dem Aufruf, erfasst Nutzung und wiederholt nie automatisch. Die Antwort enthält nur Messdaten; Titel, Beschreibung, Preis, SKU, Versand und manuelle Maße bleiben erhalten. Keine automatische Ausweichwahl auf ein teureres Modell.

Die Frontauswahl verwendet jetzt die beste vorhandene Frontansicht auch bei leichter Perspektive. Statt sämtlicher Nullkoordinaten muss das Modell verfügbare Innenkonturen mit Unsicherheitsmarkierungen zurückgeben. Unsichtbare Konturen oder unmögliche Geometrie bleiben unbekannt. Normierte Koordinaten werden im Ausgabeschema auf 0..1 begrenzt, und fehlende/ungültige Modellausgabe wird von tatsächlich ungeeigneten Fotos unterschieden.
