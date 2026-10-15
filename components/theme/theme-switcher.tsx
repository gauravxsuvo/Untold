"use client";

import { useId } from "react";
import { Circle, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { isTheme } from "@/lib/ui/theme";

const options = [
  { value: "light", label: "Light", description: "Clean and bright", Icon: Sun },
  { value: "dark", label: "Dark", description: "Soft, darker tones", Icon: Moon },
  { value: "amoled", label: "AMOLED", description: "True black backgrounds", Icon: Circle },
] as const;

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const id = useId();
  if (compact) {
    const Icon = options.find(({ value }) => value === theme)?.Icon ?? Sun;
    return (
      <label className="theme-select">
        <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
        <span className="sr-only">Appearance</span>
        <select
          onChange={(event) => {
            if (isTheme(event.target.value)) setTheme(event.target.value);
          }}
          value={theme}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <fieldset className="theme-options">
      <legend className="sr-only">Choose an appearance</legend>
      {options.map(({ value, label, description, Icon }) => (
        <label className="theme-option" key={value}>
          <input
            checked={theme === value}
            name={id}
            onChange={() => setTheme(value)}
            type="radio"
            value={value}
          />
          <span className={`theme-option__card theme-option__card--${value}`}>
            <span aria-hidden="true" className="theme-option__preview">
              <span />
              <span />
              <span />
            </span>
            <span className="theme-option__label">
              <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
              {label}
            </span>
            <span className="theme-option__description">{description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
