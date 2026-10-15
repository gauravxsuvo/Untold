"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, Ellipsis, Share, X } from "lucide-react";
import { useInstallPrompt } from "@/components/pwa/install-prompt-provider";

export function InstallAppButton({
  placement = "header",
}: {
  placement?: "header" | "mobile" | "settings";
}) {
  const { isInstalled, isInstalling, platform, install } = useInstallPrompt();
  const [showHelp, setShowHelp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const helpId = useId();

  useEffect(() => {
    if (!showHelp) return;
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setShowHelp(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowHelp(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showHelp]);

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

  return (
    <div className={`pwa-install pwa-install--${placement}`} ref={containerRef}>
      <button
        aria-describedby={showHelp ? helpId : undefined}
        aria-expanded={showHelp}
        aria-label={placement === "mobile" ? "Install Untold app" : undefined}
        className="pwa-install__button"
        disabled={isInstalling}
        onClick={handleInstall}
        ref={buttonRef}
        type="button"
      >
        <Download aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{isInstalling ? "Opening…" : "Install app"}</span>
      </button>
      {showHelp ? (
        <div className="pwa-install__help" id={helpId}>
          <div className="pwa-install__help-heading">
            <strong>Install Untold</strong>
            <button aria-label="Close install instructions" onClick={() => { setShowHelp(false); buttonRef.current?.focus(); }} type="button">
              <X aria-hidden="true" size={15} />
            </button>
          </div>
          {platform === "apple-mobile" ? (
            <>
              <p>Use Safari’s menu to add Untold to your Home Screen.</p>
              <ol>
                <li>Open this website in <strong>Safari</strong>.</li>
                <li>Tap <Ellipsis aria-hidden="true" size={14} /> <strong>More</strong>, then <Share aria-hidden="true" size={14} /> <strong>Share</strong>. If Share is already visible, tap it directly.</li>
                <li>Scroll down the actions and tap <strong>Add to Home Screen</strong>.</li>
                <li>Turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
              </ol>
              <p><strong>Can’t find Add to Home Screen?</strong> Scroll to the bottom of the Share menu, tap <strong>Edit Actions</strong>, and add it to the list.</p>
              <p>If you opened Untold inside another app, open the same address in Safari first.</p>
            </>
          ) : platform === "safari-mac" ? (
            <>
              <ol>
                <li>Open Safari’s <strong>File</strong> menu or click <Share aria-hidden="true" size={14} /> <strong>Share</strong>.</li>
                <li>Choose <strong>Add to Dock</strong>, then click <strong>Add</strong>.</li>
              </ol>
              <p>If that option is missing, update Safari and macOS. Add to Dock needs macOS Sonoma or later.</p>
            </>
          ) : (
            <p>Open your browser’s menu and choose <strong>Install Untold</strong> or <strong>Install app</strong>. On Android, look for <strong>Add to Home screen</strong>.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
