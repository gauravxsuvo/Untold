"use client";

import { useState } from "react";
import { Check, Download } from "lucide-react";
import { useInstallPrompt } from "@/components/pwa/install-prompt-provider";

export function InstallAppButton({
  placement = "header",
}: {
  placement?: "header" | "mobile" | "settings";
}) {
  const { isInstalled, isInstalling, install } = useInstallPrompt();
  const [showHelp, setShowHelp] = useState(false);

  if (isInstalled) {
    return placement === "settings" ? (
      <span className="pwa-install__installed">
        <Check aria-hidden="true" size={14} strokeWidth={2} />
        Installed
      </span>
    ) : null;
  }

  async function handleInstall() {
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    const outcome = await install();
    setShowHelp(outcome !== "accepted");
  }

  const helpId = `install-app-help-${placement}`;

  return (
    <div className={`pwa-install pwa-install--${placement}`}>
      <button
        aria-describedby={showHelp ? helpId : undefined}
        aria-expanded={showHelp}
        aria-label={placement === "mobile" ? "Install Untold app" : undefined}
        className="pwa-install__button"
        disabled={isInstalling}
        onClick={handleInstall}
        type="button"
      >
        <Download aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{isInstalling ? "Opening…" : "Install app"}</span>
      </button>
      {showHelp ? (
        <p className="pwa-install__help" id={helpId} role="status">
          In Chrome, open the browser menu and choose its install option. On Android, it may
          be listed as <strong>Add to Home screen</strong>.
        </p>
      ) : null}
    </div>
  );
}
