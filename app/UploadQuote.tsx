"use client";
import {useEffect,useState} from "react";
const quotes=[
 "Some of the money, all of the time.",
 "Sell that shit!",
 "We do the eBay dance!",
 "Someone makes you an offer on an XS? Accept it in a split second!",
 "You sold an XS? Call your wife and tell her to buy lottery tickets. Today’s your lucky day!",
 "Liquidität vor Rentabilität.",
 "Der erste Käufer ist oft der beste Käufer.",
 "Der erste Verlust ist der beste Verlust.",
 "Der Gewinn liegt im Einkauf.",
 "Dein Einkaufspreis interessiert den Käufer nicht.",
 "Dein Lager ist kein Museum.",
 "Einkaufen ist Hobby. Verkaufen ist Geschäft.",
 "Ein schlechter Einkauf wird durchs Lagern nicht besser.",
 "Dein Kontostand lügt weniger als dein Warenbestand.",
 "Der Markt schuldet dir keinen Gewinn.",
 "Rechthaben zahlt kein Porto.",
 "Ein Preisvorschlag auf einen Ladenhüter? Das ist keine Verhandlung. Das ist ein Geschenk.",
 "Ein Ladenhüter hat keine Gefühle. Reduziere ihn.",
 "Wenn du den Karton beim Vornamen kennst, liegt er zu lange.",
 "Der Käufer macht ein Angebot, keine Beleidigung.",
 "Wenn nach drei Jahren etwas verkauft wird, ist das keine Bestellung. Das ist eine Befreiung.",
 "Your death pile is not a retirement plan.",
 "Stop shopping. Start listing.",
 "List it or it doesn't exist.",
 "Listing isn't sexy. Sales are.",
];
export function UploadQuote({revision}:{revision:number}) {
 const [index,setIndex]=useState<number|null>(null);
 useEffect(()=>{setIndex(previous=>previous===null ? Math.floor(Math.random()*quotes.length) : (previous+1+Math.floor(Math.random()*(quotes.length-1)))%quotes.length);},[revision]);
 return <p className="upload-quote" aria-label="Spruch zum Hochladen">{index===null ? "\u00a0" : `„${quotes[index]}“`}</p>;
}
