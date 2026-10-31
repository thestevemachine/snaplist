# Fortlaufende SKU und echte Kategorie-Merkmale

Oberhalb der Angebote kann eine erste SKU eingegeben werden, etwa `5-23001`. Die Vorschau zeigt Anfang, Ende und Anzahl. Erst „SKU fortlaufend übernehmen“ nummeriert alle offenen Artikel in Stapelreihenfolge, einschließlich momentan ausgeblendeter Artikel. Die letzte Zahl wird erhöht; führende Nullen und Präfix bleiben erhalten. Die bestehenden Entwürfe speichern die zugewiesenen SKU automatisch.

Bereits veröffentlichte, gerade verarbeitete oder schon zur Veröffentlichung gesendete Artikel werden nicht umnummeriert. Bei einer Kollision mit einer geschützten SKU dieses Stapels wird die gesamte Änderung abgelehnt. Es findet keine Suche nach weltweit freien SKU statt; Verkäufer sollen einen unverbrauchten Nummernbereich wählen. Alte Einzel-SKU bleiben in den Karten editierbar, soweit sie noch nicht für eine Veröffentlichung verwendet wurden.

Die Detailkarte bietet nur Merkmale der geladenen eBay-Kategorie an. Bei zwei Kategorien gilt die gemeinsam geprüfte Metadatenmenge. EAN bleibt als reguläres Trading-Produktkennzeichen verfügbar. Der freie Knopf „Merkmal hinzufügen“ entfällt. Unbekannte KI-Felder wie Hinge Type, Nose Pad Type, Temple Tip Material und Lens Treatment werden beim Vorbereiten und vor der Trading-Übertragung entfernt, sofern sie nicht in der Kategorie-Metadatenmenge vorkommen.

Bei MULTI-Merkmalen mit angebotenen Werten stehen Checkboxen bereit, zum Beispiel Metall und Kunststoff. Die strengere Kardinalität beider Kategorien gilt; ein SINGLE-Feld wird nicht künstlich mehrwertig gemacht. Deutsche Farb- und Materiallisten werden über beide Kategorien geschnitten.

Fehlendes Gläsermaterial bei Sonnenbrillen erhält die Verkäufer-Vorgabe Kunststoff nur dann, wenn das echte eBay-Merkmal diesen Wert anbietet. Bestehende gültige Werte bleiben erhalten. Die Vorgabe wird pro Entwurf einmal angewendet; spätere Änderungen oder Leeren des Feldes bleiben erhalten. Sie wird nicht als KI-Fotobeleg ausgegeben.

Veröffentlichte Angebote bleiben unverändert. Es wird nichts automatisch veröffentlicht.
