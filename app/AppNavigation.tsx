"use client";

import { usePathname } from "next/navigation";

const sections = [
  { href: "/", label: "Snaplist" },
  { href: "/relister", label: "Re-Lister" },
  { href: "/checker", label: "Checker" },
];

export default function AppNavigation() {
  const pathname = usePathname();
  return (
    <header className="app-chrome">
      <nav className="app-nav" aria-label="Anwendungsbereiche">
        {sections.map(({ href, label }) => (
          <a key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
