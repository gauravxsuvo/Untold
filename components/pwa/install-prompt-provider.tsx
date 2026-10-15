"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type InstallChoice = "accepted" | "dismissed";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallChoice; platform: string }>;
};

type InstallPromptContextValue = {
  isInstalled: boolean;
  isInstalling: boolean;
  platform: "apple-mobile" | "safari-mac" | "other";
  install: () => Promise<InstallChoice | "unavailable">;
};

const InstallPromptContext = createContext<InstallPromptContextValue | null>(null);

function isRunningAsInstalledApp() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const isAppleStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isStandalone || isAppleStandalone;
}

export function InstallPromptProvider({ children }: { children: React.ReactNode }) {
  const deferredPrompt = useRef<DeferredInstallPrompt | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [platform, setPlatform] = useState<InstallPromptContextValue["platform"]>("other");

  useEffect(() => {
    setIsInstalled(isRunningAsInstalledApp());
    const agent = navigator.userAgent;
    const isAppleMobile = /iPad|iPhone|iPod/.test(agent) ||
      (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
    const isSafariMac = /Macintosh/.test(agent) && /Safari/.test(agent) &&
      !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(agent);
    setPlatform(isAppleMobile ? "apple-mobile" : isSafariMac ? "safari-mac" : "other");

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as DeferredInstallPrompt;
    };

    const handleAppInstalled = () => {
      deferredPrompt.current = null;
      setIsInstalled(true);
    };

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = () => setIsInstalled(isRunningAsInstalledApp());

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    displayMode.addEventListener("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      displayMode.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  const install = useCallback(async (): Promise<InstallChoice | "unavailable"> => {
    const promptEvent = deferredPrompt.current;
    if (!promptEvent || isInstalling) return "unavailable";

    deferredPrompt.current = null;
    setIsInstalling(true);

    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") setIsInstalled(true);
      return outcome;
    } catch {
      return "unavailable";
    } finally {
      setIsInstalling(false);
    }
  }, [isInstalling]);

  const value = useMemo(
    () => ({ isInstalled, isInstalling, platform, install }),
    [isInstalled, isInstalling, platform, install],
  );

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}

export function useInstallPrompt() {
  const context = useContext(InstallPromptContext);
  if (!context) {
    throw new Error("useInstallPrompt must be used inside InstallPromptProvider");
  }
  return context;
}
