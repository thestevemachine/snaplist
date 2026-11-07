import { list } from "../ebay/trading";
import type { Regulatory, RegulatoryContact } from "./domain";
const fields = [
  "CityName",
  "CompanyName",
  "ContactURL",
  "Country",
  "Email",
  "Phone",
  "PostalCode",
  "StateOrProvince",
  "Street1",
  "Street2",
];
function object(value: any, allowed: string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`Ungültige Regulierungsstruktur: ${label}.`);
  const unsupported = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unsupported.length)
    throw Error(
      `Nicht unterstützte Regulierungsfelder: ${label}.${unsupported.join(", ")}.`,
    );
  return value;
}
function contact(
  value: any,
  person = false,
): RegulatoryContact & { Types?: { Type: string[] } } {
  const raw = object(
    value,
    [...fields, ...(person ? ["Types"] : [])],
    "Kontakt",
  );
  const result: RegulatoryContact & { Types?: { Type: string[] } } = {};
  for (const field of fields)
    if (raw[field] !== undefined) {
      if (typeof raw[field] !== "string")
        throw Error("Ungültiger Kontaktfeldtyp.");
      (result as any)[field] = raw[field];
    }
  if (raw.Types !== undefined) {
    object(raw.Types, ["Type"], "Types");
    const types = list<string>(raw.Types.Type);
    if (!types.length || types.some((t) => t !== "EUResponsiblePerson"))
      throw Error("Nicht unterstützter Verantwortlichentyp.");
    result.Types = { Type: [...types] };
  }
  return result;
}
export function regulatoryPayload(value: any): Regulatory | undefined {
  if (value === undefined || value === "") return undefined;
  const raw = object(
      value,
      ["Manufacturer", "ResponsiblePersons"],
      "Regulatory",
    ),
    result: Regulatory = {};
  if (raw.Manufacturer !== undefined)
    result.Manufacturer = contact(raw.Manufacturer);
  if (raw.ResponsiblePersons !== undefined) {
    object(raw.ResponsiblePersons, ["ResponsiblePerson"], "ResponsiblePersons");
    const people = list(raw.ResponsiblePersons.ResponsiblePerson);
    if (!people.length) throw Error("Verantwortlichenangaben fehlen.");
    result.ResponsiblePersons = {
      ResponsiblePerson: people.map((p) => contact(p, true)),
    };
  }
  return result;
}
