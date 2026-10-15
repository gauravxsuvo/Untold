"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import {
  acceptDeviceApproval,
  createContactVerification,
  deviceLinkSecret,
  legacyAccountVerified,
  pinAccountRoot,
  pinnedAccountRoot,
  sameAccountIdentity,
  saveContactVerification,
  type LinkSecret,
} from "@/crypto/src/account-trust";
import {
  classifyDeviceTrust,
  loadOrCreateLocalDevice,
  type LocalDevice,
} from "@/crypto/src/protocol";
import {
  ApiError,
  fetchDeviceSecurity,
  registerDevice,
  syncContactVerification,
  userFacingError,
  type DeviceSecuritySnapshot,
} from "@/lib/messaging/api-client";

type DeviceContext = {
  device: LocalDevice | null;
  state: "loading" | "ready" | "error";
  approved: boolean;
  error: string;
  security: DeviceSecuritySnapshot | null;
  link: LinkSecret | null;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};
const Context = createContext<DeviceContext | null>(null);
function deviceName() {
  const ua = navigator.userAgent;
  const appleTouch = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const platform =
    /iPhone/.test(ua) || (appleTouch && Math.min(screen.width, screen.height) < 600)
      ? "iPhone"
      : /iPad/.test(ua) || appleTouch
        ? "iPad"
        : /Android/.test(ua)
          ? /Mobile/.test(ua)
            ? "Android phone"
            : "Android tablet"
          : /Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : "Computer";
  const browser = /Edg/.test(ua)
    ? "Edge"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome|CriOS/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "Browser";
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  return `${platform} · ${installed ? "Untold app" : browser}`;
}
export function MessagingDeviceProvider({ children }: { children: ReactNode }) {
  const { session } = useAccountSession();
  const accountId = session?.id ?? "";
  const [device, setDevice] = useState<LocalDevice | null>(null);
  const [state, setState] = useState<DeviceContext["state"]>("loading");
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [security, setSecurity] = useState<DeviceSecuritySnapshot | null>(null);
  const [link, setLink] = useState<LinkSecret | null>(null);
  const activeAccount = useRef(accountId);
  activeAccount.current = accountId;
  const busy = useRef("");
  const approvedAccount = useRef("");
  approvedAccount.current = approved && device?.accountId === accountId ? accountId : "";
  const setup = useCallback(
    async (register: boolean) => {
      if (!accountId || busy.current === accountId) return;
      busy.current = accountId;
      try {
        const local = await loadOrCreateLocalDevice(accountId);
        const pending = await deviceLinkSecret(local);
        if (activeAccount.current !== accountId) return;
        setDevice((current) =>
          current?.deviceId === local.deviceId && current.accountId === accountId ? current : local,
        );
        if (register)
          await registerDevice({
            deviceId: local.deviceId,
            name: deviceName(),
            agreementKey: local.agreementKey,
            signingKey: local.signingKey,
            linkHash: pending.requestHash,
          });
        const snapshot = await fetchDeviceSecurity(local.deviceId);
        if (activeAccount.current !== accountId) return;
        const identity = snapshot.identity;
        const current = snapshot.devices.find(
          (d) => d.deviceId === local.deviceId && d.userId === accountId,
        );
        if (
          !identity ||
          !current ||
          current.revoked ||
          current.agreementKey !== local.agreementKey ||
          current.signingKey !== local.signingKey
        )
          throw new Error("This device is no longer available.");
        let pinned = await pinnedAccountRoot(accountId);
        if (
          identity.deviceId === local.deviceId &&
          identity.agreementKey === local.agreementKey &&
          identity.signingKey === local.signingKey
        ) {
          await pinAccountRoot(accountId, identity);
          pinned = identity;
        } else if (!pinned && current.approval && snapshot.sealedApproval) {
          await acceptDeviceApproval(
            local,
            identity,
            current.approval,
            snapshot.sealedApproval,
            snapshot.devices,
          );
          pinned = await pinnedAccountRoot(accountId);
        }
        if (pinned && !sameAccountIdentity(pinned, identity))
          throw new Error(
            "Your account safety identity changed. Open Settings to recover this device.",
          );
        const ready = Boolean(current.approved && sameAccountIdentity(pinned, identity));
        if (ready) {
          for (const proof of snapshot.verifications) {
            try {
              await saveContactVerification(proof, snapshot.devices);
            } catch {
              /* Invalid proofs never become trusted. */
            }
          }
          let migrated = 0;
          for (const contact of snapshot.contacts) {
            if (migrated >= 8 || activeAccount.current !== accountId) break;
            if (snapshot.verifications.some((proof) => proof.contact.userId === contact.userId))
              continue;
            if (!(await legacyAccountVerified(accountId, contact))) continue;
            const existing = await classifyDeviceTrust(accountId, [
              ...snapshot.devices,
              {
                ...contact,
                userName: "",
                deviceName: "",
                revoked: false,
                accountIdentity: contact,
              },
            ]);
            if (existing.some((d) => d.userId === contact.userId && d.trust !== "new")) continue;
            try {
              const proof = await createContactVerification(local, contact);
              await syncContactVerification(proof);
              await saveContactVerification(proof, snapshot.devices);
              snapshot.verifications.push(proof);
              migrated++;
            } catch {
              break;
            }
          }
        }
        if (activeAccount.current !== accountId) return;
        setLink(pending);
        setSecurity(snapshot);
        setApproved(ready);
        setState("ready");
        setError("");
      } catch (caught) {
        if (activeAccount.current !== accountId) return;
        if (
          approvedAccount.current === accountId &&
          caught instanceof ApiError &&
          (caught.status === 0 || caught.status === 429 || caught.status >= 500)
        ) {
          setError(
            "Your saved device approval is kept. We couldn’t refresh it just now. Try again when connected.",
          );
          return;
        }
        setApproved(false);
        setError(
          userFacingError(caught, "This device couldn’t be prepared. Open Settings or try again."),
        );
        setState("error");
      } finally {
        if (busy.current === accountId) busy.current = "";
      }
    },
    [accountId],
  );
  const refresh = useCallback(() => setup(false), [setup]);
  const retry = useCallback(() => setup(true), [setup]);
  useEffect(() => {
    setDevice(null);
    setSecurity(null);
    setLink(null);
    setApproved(false);
    setState("loading");
    setError("");
    void retry();
  }, [retry]);
  useEffect(() => {
    if (!accountId) return;
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(resume, approved ? 30_000 : 4000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [accountId, approved, refresh]);
  const currentDevice = device?.accountId === accountId ? device : null;
  return (
    <Context.Provider
      value={{
        device: currentDevice,
        state: currentDevice ? state : "loading",
        approved: Boolean(currentDevice && approved),
        error,
        security: currentDevice ? security : null,
        link: currentDevice ? link : null,
        refresh,
        retry,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useMessagingDevice() {
  const context = useContext(Context);
  if (!context) throw new Error("Messaging device provider is missing.");
  return context;
}
export function DeviceApprovalNotice() {
  const local = useMessagingDevice();
  const pending = local.security?.devices.some(
    (d) =>
      !d.revoked &&
      !d.approved &&
      d.linkHash &&
      d.linkExpiresAt &&
      Date.parse(d.linkExpiresAt) > Date.now(),
  );
  if (local.state === "loading" || (local.approved && !pending)) return null;
  return (
    <aside className="device-approval-notice" aria-label="Device approval">
      <ShieldCheck aria-hidden="true" size={20} />
      <span>
        {local.state === "error"
          ? local.error
          : local.approved
            ? "A new device is waiting for your approval."
            : "Approve this device to start messaging. Your contacts won’t need to compare codes again."}
      </span>
      <Link href="/app/settings#your-devices">
        {local.approved ? "Review devices" : "Set up device"}
      </Link>
    </aside>
  );
}
