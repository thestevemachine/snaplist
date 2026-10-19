import type { ListingResult } from "./types";
import type { CategorySuggestion } from "./ebay/taxonomy";
export function expectedDepartment(l: ListingResult): string {
  if (l.category?.startsWith("womens_")) return "Women";
  if (l.category?.startsWith("mens_")) return "Men";
  const value = l.item_specifics?.Abteilung || l.item_specifics?.Department || "";
  if (/^(damen|women|female)$/i.test(value.trim())) return "Women";
  if (/^(herren|men|male)$/i.test(value.trim())) return "Men";
  return value;
}
export function categoryMatches(
  c: CategorySuggestion,
  l: ListingResult,
): boolean {
  const department = expectedDepartment(l);
  const path = c.path.toLowerCase();
  if (isSunglasses(l) && (!/^(sonnenbrillen|sunglasses)$/i.test(c.name.trim()) || /\b(kinder|boys|girls|kids)\b/i.test(path))) return false;
  if (department === "Women")
    return /\b(women|damen)\b/.test(path) && !/\b(men|herren)\b/.test(path);
  if (department === "Men")
    return /\b(men|herren)\b/.test(path) && !/\b(women|damen)\b/.test(path);
  return true;
}

export function isSunglasses(l: ListingResult): boolean {
  return /\b(sunglasses|sonnenbrille[n]?)\b/i.test([l.title, l.item_type, l.category_hint, l.category].join(" "));
}
export function categorySearchQuery(l: ListingResult, german: boolean): string {
  const department = expectedDepartment(l);
  if (german && isSunglasses(l)) return `Sonnenbrille ${department === "Men" ? "Herren" : department === "Women" ? "Damen" : "Herren Damen"}`;
  return `${german ? department === "Men" ? "Herren" : department === "Women" ? "Damen" : department : department} ${l.category_hint || ""} ${l.title}`;
}
