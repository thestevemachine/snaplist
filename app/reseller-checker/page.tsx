import type { Metadata } from "next";
import ResellerChecker from "./ResellerChecker";
export const metadata: Metadata = {
  title: "Reseller Checker — Fotos zu Vinted-Entwürfen",
};
export default function Page() {
  return <ResellerChecker />;
}
