import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAuthForm, type AuthFormValues } from "../lib/auth/validation";

const validSignUp: AuthFormValues = {
  name: "Mira Chen",
  email: "mira@example.test",
  password: "A sample passphrase that is long",
  confirmation: "A sample passphrase that is long",
};

describe("authentication form validation", () => {
  it("accepts a complete sign-up preview with a long passphrase", () => {
    assert.deepEqual(validateAuthForm("sign-up", validSignUp), {});
  });

  it("reports missing name, malformed email, and short password fields", () => {
    const errors = validateAuthForm("sign-up", {
      name: " ",
      email: "not-an-email",
      password: "short",
      confirmation: "short",
    });

    assert.match(errors.name ?? "", /at least two characters/);
    assert.match(errors.email ?? "", /format name@example\.com/);
    assert.match(errors.password ?? "", /at least 15 characters/);
  });

  it("counts Unicode code points for sign-up password length", () => {
    const errors = validateAuthForm("sign-up", {
      name: "Mira",
      email: "mira@example.test",
      password: "🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂",
      confirmation: "🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂",
    });

    assert.match(errors.password ?? "", /at least 15 characters/);
  });

  it("requires confirmation to match without requiring sign-in password rules", () => {
    const mismatch = validateAuthForm("sign-up", {
      ...validSignUp,
      confirmation: "A different sample passphrase",
    });
    const signIn = validateAuthForm("sign-in", {
      ...validSignUp,
      password: "existing",
      confirmation: "",
    });

    assert.match(mismatch.confirmation ?? "", /do not match/);
    assert.deepEqual(signIn, {});
  });

  it("rejects passwords longer than the configured account limit", () => {
    const password = "x".repeat(129);
    const errors = validateAuthForm("sign-up", {
      ...validSignUp,
      password,
      confirmation: password,
    });

    assert.match(errors.password ?? "", /no more than 128 characters/);
  });
});
