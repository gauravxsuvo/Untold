# MFA and password recovery

## What changed

- Settings offers authenticator app MFA with a locally rendered QR code and a manual setup key. No setup secret is sent to a QR service.
- MFA activates only after the person verifies a current code. Ten recovery codes are shown after verification, with a download option and an explicit reminder to save them. The UI holds them only in component memory.
- Sign-in with MFA requires a second step before the inbox opens. The password sign-in session is discarded by Better Auth until that step succeeds. Authenticator codes or an unused recovery code can complete it. Trusted-device bypass is disabled.
- Replacing recovery codes or disabling MFA requires an authenticated session, the current password, and an authenticator code or unused recovery code. Replacement invalidates every previous recovery code and signs other sessions out. Disabling invalidates all codes and signs every session out.
- Forgot password opens a real reset form. It accepts the account email, an unused recovery code, and a new password of 15 to 128 characters. It intentionally does not accept a short authenticator code alone and does not send email. Accounts without verified, enabled MFA cannot reset passwords.
- A successful reset consumes its recovery code, saves the password, revokes sessions and pending MFA/trusted-device grants in one database transaction. MFA stays enabled. The person must sign in again.
- Reset errors do not distinguish an unknown email, disabled MFA, an invalid code, or a used code.
- Old copy claiming resets do not exist has been replaced. The warning that lost browser encryption keys cannot be restored still applies.

## Security controls

- Better Auth's installed two-factor plugin handles encrypted TOTP secrets, encrypted recovery code storage, the pending sign-in cookie, five-minute challenges, challenge attempt limits, and account lockouts after ten failed sign-in codes for fifteen minutes.
- Recovery codes use 16 cryptographically random bytes each (128 bits), formatted as four groups of eight hexadecimal characters. They can be used once for sign-in, management, or recovery.
- An atomic, expiring fingerprint claim prevents successful TOTP codes from being reused for another sign-in or sensitive action during their acceptance window. Codes and setup secrets are not stored in that table.
- Recovery and sensitive management use database-backed limits per client IP and account, ten attempts per fifteen minutes. Keys are HMAC fingerprints, without raw email addresses or IPs. The production ingress must continue overwriting `cf-connecting-ip` with the actual visitor IP.
- Sensitive custom routes require the configured browser origin, an at-most 4 KiB request body, bounded values, and no-store responses. Two-factor auth request bodies are also capped at 4 KiB. The general auth response is no-store.
- Standard email-reset, password-change, secret-retrieval, password-only MFA disable, password-only recovery-code-generation, and unconfigured email/SMS code endpoints are blocked. Password updates use the custom MFA recovery route. Custom routes enforce the stronger recovery and management policy.
- Security transactions lock the user and factor, re-check MFA eligibility, and serialize single-use recovery code changes. Management re-checks the current session inside the transaction. Better Auth's conditional backup-code update also prevents reuse against a concurrent custom reset or management request.
- Session cookie caching is disabled so session revocation is checked against the database.
- A final auth hook runs after the MFA plugin. It checks the user revision under a shared row lock, so a sign-in racing with recovery or a security change is rejected and its new session or pending challenge is revoked. MFA enrollment also invalidates password sign-ins already in progress.
- Keep `BETTER_AUTH_SECRET` stable and backed up securely. Changing it without the auth library's key-rotation configuration prevents existing MFA data from being decrypted.

## Deployment

Migration `011-account-mfa.sql` adds `user.two_factor_enabled`, `two_factor`, and `used_totp` in the auth schema. Existing accounts start with MFA off. Startup through `npm start` applies pending migrations before serving traffic. No email provider, Redis database, or additional environment variable is required.

The migration and code must be deployed together. The development server has not been started and no live database migration or deployment has been performed from this workspace.

## Validation scope

Local lint and the webpack production build pass. No unit, integration, browser account-flow tests, live account changes, or database migration runs were performed for this change. Before release, verify enrollment, both sign-in methods, concurrent code reuse, lockout, MFA disable, recovery-code replacement, reset rejection without MFA, and session revocation against a staging database.

Static desktop and mobile previews were reviewed for recovery, the sign-in challenge, MFA setup, and the recovery-code list. These used sample data and did not exercise authentication.

Reference: [Better Auth two-factor authentication](https://better-auth.com/docs/plugins/2fa). The implementation was checked against the installed 1.7.8 plugin, including its verified flag, failure counter, lock timestamp, and conditional backup-code update.
