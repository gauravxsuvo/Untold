"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, MessageSquareText, Settings2, UserRound, UsersRound } from "lucide-react";

const navigationItems = [
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/conversations", label: "Conversations", icon: MessageSquareText },
  { href: "/app/contacts", label: "Contacts", icon: UsersRound },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
  { href: "/app/profile", label: "Profile", icon: UserRound },
] as const;

export function ApplicationNavigation({ placement }: { placement: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={placement === "sidebar" ? "Workspace" : "Mobile workspace"}
      className={`app-navigation app-navigation--${placement}`}
    >
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const isCurrent =
          pathname === item.href ||
          (item.href === "/app/conversations" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            aria-current={isCurrent ? "page" : undefined}
            className={`app-navigation__link${isCurrent ? " is-current" : ""}`}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
