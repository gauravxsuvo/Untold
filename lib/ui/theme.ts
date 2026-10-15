export const themeCookieName = "untold-theme";
export const themes = ["light", "dark", "amoled"] as const;
export type Theme = (typeof themes)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && themes.some((theme) => theme === value);
}

export const themeColors: Record<Theme, string> = {
  light: "#f7f8f4",
  dark: "#151719",
  amoled: "#000000",
};
