"use client";

import { useId, useState } from "react";
import { Check, Download, KeyRound } from "lucide-react";
import { QrCode } from "@/components/ui/qr-code";

export function SecurityCodeField({
  code,
  onChange,
  backup = false,
}: {
  code: string;
  onChange: (value: string) => void;
  backup?: boolean;
}) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{backup ? "Recovery code" : "Authenticator code"}</label>
      <input
        autoCapitalize="none"
        autoComplete="one-time-code"
        autoCorrect="off"
        className="security-code-input"
        id={id}
        inputMode={backup ? "text" : "numeric"}
        maxLength={backup ? 64 : 12}
        spellCheck={false}
        onChange={(event) =>
          onChange(
            backup
              ? event.target.value.replace(/\s/g, "").toLowerCase().slice(0, 35)
              : event.target.value.replace(/\D/g, "").slice(0, 6),
          )
        }
        required
        value={code}
        aria-describedby={`${id}-hint`}
      />
      <span className="auth-field__hint" id={`${id}-hint`}>
        {backup
          ? "Enter one of the unused codes saved when you set up MFA."
          : "Enter the 6-digit code from your authenticator app."}
      </span>
    </div>
  );
}

export function AuthenticatorQr({ uri }: { uri: string }) {
  return <QrCode value={uri} label="Scan with your authenticator app to add Untold" />;
}

export function SavedRecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const id = useId();
  function download() {
    const content = [
      "Untold recovery codes",
      "",
      "Keep these private and away from this device. Each code can be used once, to sign in or reset your password. New codes replace all previous codes.",
      "",
      ...codes,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "untold-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="security-stack">
      <div className="security-callout">
        <KeyRound aria-hidden="true" size={20} />
        <div>
          <h3>Save your recovery codes</h3>
          <p>
            Each code works once. Use one to sign in without your authenticator or to reset your
            password. Keep them somewhere private, such as a password manager.
          </p>
        </div>
      </div>
      <p className="auth-field__hint">
        These codes are only shown now. Download or save them before you continue.
      </p>
      <ul aria-label="Your recovery codes" className="security-recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button
        className="security-button security-button--secondary"
        onClick={download}
        type="button"
      >
        <Download aria-hidden="true" size={16} />
        Download codes
      </button>
      <label className="security-checkbox" htmlFor={id}>
        <input
          checked={saved}
          id={id}
          onChange={(event) => setSaved(event.target.checked)}
          type="checkbox"
        />
        I’ve saved my recovery codes somewhere safe.
      </label>
      <button className="security-button" disabled={!saved} onClick={onDone} type="button">
        <Check aria-hidden="true" size={16} />
        Done
      </button>
    </div>
  );
}

export function securityError(status?: number, code?: string): string {
  if (status === 429) return "Too many attempts. Please wait a while before trying again.";
  if (status && status >= 500)
    return "Untold isn’t available right now. Please try again in a moment.";
  if (code === "CODE_ALREADY_USED")
    return "This code was already used. Wait for a new code in your authenticator and try again.";
  if (code === "SIGN_IN_RESTART_REQUIRED")
    return "Your account changed while signing in. Go back to sign in and try again.";
  if (code === "INVALID_TWO_FACTOR_COOKIE" || code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE")
    return "Your sign-in has expired. Go back to sign in and try again.";
  return "We couldn’t verify those details. Check your password or code and try again.";
}
