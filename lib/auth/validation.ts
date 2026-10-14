export type AuthFormMode = "sign-in" | "sign-up";

export type AuthFormValues = {
  name: string;
  email: string;
  password: string;
  confirmation: string;
};

export type AuthFieldErrors = Partial<Record<keyof AuthFormValues, string>>;

export function validateAuthForm(mode: AuthFormMode, values: AuthFormValues): AuthFieldErrors {
  const errors: AuthFieldErrors = {};

  if (mode === "sign-up" && values.name.trim().length < 2) {
    errors.name = "Enter a name with at least two characters.";
  }

  const email = values.email.trim();
  if (!email) {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter an email address in the format name@example.com.";
  }

  const passwordLength = Array.from(values.password).length;
  if (!values.password) {
    errors.password = "Enter a password to continue.";
  } else if (mode === "sign-up" && passwordLength < 15) {
    errors.password = "Use at least 15 characters. A memorable passphrase is fine.";
  } else if (mode === "sign-up" && passwordLength > 128) {
    errors.password = "Use a password with no more than 128 characters.";
  }

  if (mode === "sign-up" && values.password !== values.confirmation) {
    errors.confirmation = "These passwords do not match.";
  }

  return errors;
}
