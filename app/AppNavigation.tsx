"use client";
import { usePathname } from "next/navigation";
export default function AppNavigation() {
  const pathname = usePathname();
  if (pathname === "/reseller-checker") return null;
  return (
    <nav className="app-nav" aria-label="Anwendungsbereiche">
      <a href="/">Snaplist</a>
      <a href="/relister">Re-Lister</a>
      <a href="/checker">Checker</a>
    </nav>
  );
}
