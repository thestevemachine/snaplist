# Maße aus dem vorhandenen Frontfoto

Neue Brillenanalysen erkennen Konturpunkte im ohnehin ausgewählten Listingmodell. Es gibt keinen zusätzlichen KI-Aufruf, keinen Modellwechsel, keine automatische Neuanalyse bestehender Entwürfe und keine neue Bildanforderung. Die zusätzliche strukturierte Ausgabe verursacht zusätzliche Ausgabe-Token innerhalb desselben Aufrufs; sie wird im vorhandenen Token-/Kostenprotokoll erfasst. Alte Entwürfe bleiben unverändert.

Die Geometrie verwendet genau ein Frontfoto. Bügel-/Brückenaufdrucke aus der bestehenden Aufdruckerkennung liefern ausschließlich die bekannte Scheibenbreite als Referenz. Fehlende oder widersprüchliche Referenzen werden nicht erraten. Brillengröße, Modellnummer und Shop-Vorgaben werden nicht als Maßstab verwendet.

Die KI meldet normierte Konturpunkte, keine Millimeterwerte. Der Server liest die tatsächliche JPEG-/PNG-/WebP-Bildgröße aus dem Header und berechnet daraus Pixelspannen. So werden unterschiedliche Bildseitenverhältnisse korrekt berücksichtigt, ohne Bilddekodierung oder weitere Abhängigkeiten. Nicht sicher unterstützte Bildausrichtungen und ungültige Header ergeben unbekannte Maße; die Listinganalyse funktioniert weiter.

- Scheibenbreite/-höhe: maximale horizontale/vertikale Nut-zu-Nut-Spanne, ohne Fassungsrand (Boxing-System, keine diagonalen Punktabstände).
- Gesamtbreite: äußerster linker bis äußerster rechter Punkt einschließlich Scharnieren und sichtbaren Bügelteilen.
- mm je Pixel = aufgedruckte Scheibenbreite / Scheibenbreite in Pixeln.
- Scheibenhöhe bzw. Gesamtbreite in mm = jeweilige Pixelspanne × mm je Pixel. Erst das Ergebnis wird mit `Math.round` auf ganze Millimeter gerundet.

Beide Gläser dienen der Konsistenzprüfung. Abweichende Größen, Perspektive, unklare Nuten, abgeschnittene Außenkonturen, geringe Auflösung/Konfidenz und Bügel außerhalb der Messebene werden markiert. Unplausible/ungültige Daten liefern keine Millimeterwerte. Die Schwellenwerte sind konservative Softwareprüfungen, keine kalibrierte physikalische Genauigkeitsgarantie. Die Nut kann bei eingebauten Gläsern oder dicken Rändern verborgen sein; dann muss die Erkennung unsicher melden. Keine perspektivische 3D-Rekonstruktion.

Die Prüfkarte „Erkannte Bügelaufdrucke und Maße“ zeigt Referenzaufdruck und Quellfotos, Pixelwerte, Formel, gerundete Ergebnisse und Unsicherheitsgründe. Die Ergebnisse werden als Schätzung gespeichert, auch im Cloud-Ergebnis und beim Modellvergleich über denselben Analysepfad. Sie überschreiben keine manuellen/aufgedruckten Maße und werden nicht automatisch als gesicherte eBay-Merkmale übertragen. Die editierbare Messnotiz bleibt erhalten. Änderungen am Referenzaufdruck nach der Analyse ändern das gespeicherte Analyseergebnis nicht; Referenz und Rechenstand bleiben sichtbar.

Die Rechnung ist automatisiert getestet. Die tatsächliche Erkennungsgenauigkeit ist ohne Vergleich echter Frontfotos mit unabhängig gemessenen Brillen noch nicht belegt. Vor produktiver Übernahme mit mehreren bekannten Brillen überprüfen; ein Neukalkulieren bestehender Entwürfe erfordert die bestehende ausdrückliche kostenpflichtige Analysebestätigung. Keine echten eBay-Veröffentlichungen zur Prüfung.
