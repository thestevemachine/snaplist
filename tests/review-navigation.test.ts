import {it,expect} from "vitest";
import {issueField} from "@/lib/review-navigation";
it("finds the exact aspect in required/invalid-value warnings without confusing short words",()=>{
 expect(issueField("Enter Rahmenfarbe",["Farbe","Rahmenfarbe"])).toBe("Rahmenfarbe");
 expect(issueField("Choose an allowed value for Frame Color",["Frame","Frame Color"])).toBe("Frame Color");
 expect(issueField("Bitte Rahmenbedingungen und Artikelstandort auswählen.",["Art","Form"])).toBe("Versand");
 expect(issueField("Bitte einen Preis größer als null eingeben.",[])).toBe("Preis");
 expect(issueField("Bitte 1–24 Fotos für diesen Artikel auswählen.",[])).toBe("Fotos");
});
