"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldPlus } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import {
  AuthenticatorQr,
  SavedRecoveryCodes,
  SecurityCodeField,
  securityError,
} from "@/components/auth/security-controls";
import { authClient } from "@/lib/auth/client";

type Step = "idle" | "password" | "setup" | "codes" | "regenerate" | "disable";

export function MfaSettings() {
  const { session, refreshSession } = useAccountSession();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const enabled = session?.twoFactorEnabled === true;
  const isManagement = step === "regenerate" || step === "disable";
  const setupKey = uri ? new URL(uri).searchParams.get("secret") : null;

  function close() {
    setStep("idle");
    setPassword("");
    setCode("");
    setBackup(false);
    setUri("");
    setCodes([]);
    setFeedback("");
  }
  function open(nextStep: Step) {
    close();
    setStep(nextStep);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setBusy(true);
    try {
      if (step === "password") {
        const result = await authClient.twoFactor.enable({ password, method: "totp" });
        if (result.error || result.data?.method !== "totp") {
          setFeedback(securityError(result.error?.status, result.error?.code));
          return;
        }
        setUri(result.data.totpURI);
        setCodes(result.data.backupCodes);
        setStep("setup");
      } else if (step === "setup") {
        const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
        if (result.error) {
          setFeedback(securityError(result.error.status, result.error.code));
          return;
        }
        setUri("");
        setStep("codes");
        await refreshSession();
      } else if (isManagement) {
        const response = await fetch("/api/security/mfa", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password,
            code,
            method: backup ? "backup" : "totp",
            action: step,
          }),
        });
        if (!response.ok) {
          setFeedback(securityError(response.status));
          return;
        }
        if (step === "disable") {
          close();
          await authClient.signOut();
          router.replace("/auth/sign-in?status=signed-out");
          router.refresh();
        } else {
          const result: { backupCodes?: string[] } = await response.json();
          if (!result.backupCodes) {
            setFeedback("We couldn’t load your new codes. Please try again.");
            return;
          }
          setCodes(result.backupCodes);
          setStep("codes");
        }
      }
    } catch {
      setFeedback("We couldn’t connect to Untold. Please try again.");
    } finally {
      setPassword("");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <article className="account-security">
      <div className="security-heading">
        <div>
          <p className="messaging-kicker">Protect your account</p>
          <h2>Two-factor authentication</h2>
          <p>
            Scan a QR code with your authenticator app to set up an extra sign-in check. Setting
            this up also lets you reset a forgotten password with a saved recovery code.
          </p>
        </div>
        <span className="security-status">
          {enabled ? (
            <ShieldCheck aria-hidden="true" size={16} />
          ) : (
            <ShieldPlus aria-hidden="true" size={16} />
          )}
          {enabled ? "On" : "Off"}
        </span>
      </div>
      {step === "idle" ? (
        <div className="security-actions">
          {enabled ? (
            <>
              <button
                className="security-button security-button--secondary"
                onClick={() => open("regenerate")}
                type="button"
              >
                Replace recovery codes
              </button>
              <button
                className="security-text-button"
                onClick={() => open("disable")}
                type="button"
              >
                Turn off MFA
              </button>
            </>
          ) : (
            <button
              className="security-button"
              disabled={!session}
              onClick={() => open("password")}
              type="button"
            >
              <ShieldPlus aria-hidden="true" size={16} />
              Set up MFA with QR code
            </button>
          )}
        </div>
      ) : null}
      {step === "codes" ? (
        <SavedRecoveryCodes codes={codes} onDone={close} />
      ) : step !== "idle" ? (
        <form className="auth-form security-form" onSubmit={submit}>
          <h3>
            {step === "password"
              ? "Confirm it’s you"
              : step === "setup"
                ? "Add Untold to your authenticator"
                : step === "disable"
                  ? "Turn off two-factor authentication?"
                  : "Create new recovery codes"}
          </h3>
          {step === "setup" ? (
            <>
              <p>
                Scan this code with your authenticator app, then enter its 6-digit code below. You
                can also enter the setup key manually.
              </p>
              <AuthenticatorQr uri={uri} />
              <a className="security-text-button" href={uri}>
                Open an authenticator app on this device
              </a>
              <p className="auth-field__hint">
                Using one phone? Open your authenticator with the link above, or copy the setup key
                below. After adding Untold, return here to verify a code.
              </p>
              <div className="auth-field">
                <label htmlFor="mfa-setup-key">Setup key</label>
                <input
                  autoComplete="off"
                  className="security-code-input"
                  id="mfa-setup-key"
                  readOnly
                  spellCheck={false}
                  value={setupKey ?? ""}
                />
              </div>
              <p className="auth-field__hint">
                If you enter it manually, choose time-based codes with 6 digits and a 30-second
                interval. Keep this key private.
              </p>
            </>
          ) : (
            <>
              <p>
                {step === "password"
                  ? "Enter your current password to start. MFA stays off until you verify a code."
                  : step === "disable"
                    ? "You’ll lose password recovery and the extra sign-in check. This signs you out on every device and invalidates your recovery codes."
                    : "Your old codes will stop working, and other devices will be signed out. You’ll need to save the new codes."}
              </p>
              <div className="auth-field">
                <label htmlFor="mfa-password">Current password</label>
                <input
                  autoComplete="current-password"
                  id="mfa-password"
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </div>
            </>
          )}
          {step === "setup" || isManagement ? (
            <SecurityCodeField backup={isManagement && backup} code={code} onChange={setCode} />
          ) : null}
          {isManagement ? (
            <button
              className="security-text-button"
              onClick={() => {
                setBackup(!backup);
                setCode("");
                setFeedback("");
              }}
              type="button"
            >
              {backup ? "Use an authenticator code" : "Use a recovery code instead"}
            </button>
          ) : null}
          <p aria-live="polite" className="security-feedback" role="status">
            {feedback}
          </p>
          <div className="security-actions">
            <button className="security-button" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : step === "setup"
                  ? "Verify and turn on MFA"
                  : step === "disable"
                    ? "Turn off MFA and sign out"
                    : step === "regenerate"
                      ? "Replace codes"
                      : "Continue"}
            </button>
            <button className="security-text-button" disabled={busy} onClick={close} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
