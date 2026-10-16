"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, MessageSquareText, Settings2, Phone, UsersRound } from "lucide-react";
import { useCallHistoryStatus } from "@/components/messaging/call-history-provider";

const navigationItems = [
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/conversations", label: "Conversations", icon: MessageSquareText },
  { href: "/app/calls", label: "Calls", icon: Phone },
  { href: "/app/contacts", label: "Contacts", icon: UsersRound },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
] as const;

export function ApplicationNavigation({ placement }: { placement: "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const { missedCount } = useCallHistoryStatus();

  return (
    <nav
      aria-label={placement === "sidebar" ? "Workspace" : "Mobile workspace"}
      className={`app-navigation app-navigation--${placement}`}
    >
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            aria-current={isCurrent ? "page" : undefined}
            className={`app-navigation__link${isCurrent ? " is-current" : ""}`}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>
              {placement === "mobile" && item.href === "/app/conversations" ? "Chats" : item.label}
            </span>
            {item.href === "/app/calls" && missedCount > 0 ? (
              <span className="calls-badge">
                <span aria-hidden="true">{missedCount > 99 ? "99+" : missedCount}</span>
                <span className="sr-only">{missedCount} missed calls</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
