export const fontSizes = ["small", "default", "large", "extra-large"] as const;
export const interfaceZooms = ["90", "100", "110", "120"] as const;
export type FontSize = (typeof fontSizes)[number];
export type InterfaceZoom = (typeof interfaceZooms)[number];
export const fontSizeCookie = "untold-font-size";
export const zoomCookie = "untold-interface-zoom";
export function isFontSize(value: unknown): value is FontSize {
  return fontSizes.some((item) => item === value);
}
export function isInterfaceZoom(value: unknown): value is InterfaceZoom {
  return interfaceZooms.some((item) => item === value);
}
