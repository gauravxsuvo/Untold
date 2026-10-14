"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/app/inbox", label: "Inbox", icon: "inbox" },
  { href: "/app/conversations", label: "Conversations", icon: "conversation" },
  { href: "/app/contacts", label: "Contacts", icon: "contacts" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
  { href: "/app/profile", label: "Profile", icon: "profile" },
] as const;

function NavigationIcon({ name }: { name: (typeof navigationItems)[number]["icon"] }) {
  const shared = {
    "aria-hidden": true as const,
    fill: "none",
    height: 20,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
    viewBox: "0 0 24 24",
    width: 20,
  };

  switch (name) {
    case "inbox":
      return (
        <svg {...shared}>
          <title>Inbox</title>
          <path d="M4 5.5h16l1 9.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4l1-9.5Z" />
          <path d="M3 15h5l1.5 2h5L16 15h5M8 5.5V3h8v2.5" />
        </svg>
      );
    case "conversation":
      return (
        <svg {...shared}>
          <title>Conversations</title>
          <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
          <path d="M7.5 10h9m-9 3.5h6" />
        </svg>
      );
    case "contacts":
      return (
        <svg {...shared}>
          <title>Contacts</title>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...shared}>
          <title>Settings</title>
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path
            d="m19.2 13.7 1.2.9-1.8 3.1-1.4-.6a8 8 0 0 1-1.6.9l-.2 1.5h-3.6l-.2-1.5a8 8 0 0 1-1.6-.9l-1.4.6-1.8-3.1 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.8-3.1 1.4.6a8 8 0 0 1 1.6-.9l.2-1.5h3.6l.2 1.5a8 8 0 0 1 1.6.9l1.4-.6 1.8 3.1-1.2.9a7 7 0 0 1 0 1.8Z"
            transform="translate(-1 -1)"
          />
        </svg>
      );
    case "profile":
      return (
        <svg {...shared}>
          <title>Profile</title>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
  }
}

export function ApplicationNavigation({ placement }: { placement: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={placement === "sidebar" ? "Workspace" : "Mobile workspace"}
      className={`app-navigation app-navigation--${placement}`}
    >
      {navigationItems.map((item) => {
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
            <NavigationIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
