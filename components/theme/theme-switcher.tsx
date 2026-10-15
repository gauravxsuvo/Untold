"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Circle, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";

const options = [
  { value: "light", label: "Light", description: "Clean and bright", Icon: Sun },
  { value: "dark", label: "Dark", description: "Soft, darker tones", Icon: Moon },
  { value: "amoled", label: "AMOLED", description: "True black backgrounds", Icon: Circle },
] as const;

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const id = useId();
  if (compact) {
    return <CompactThemeMenu />;
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

function CompactThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex(({ value }) => value === theme);
  const { Icon, label } = options[current] ?? options[0];
  useEffect(() => {
    if (!open) return;
    items.current[current]?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const focused = (event: FocusEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focused);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focused);
    };
  }, [open, current]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      items.current[next]?.focus();
    }
  }
  return (
    <div className="theme-menu" ref={container}>
      <button
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Appearance: ${label}`}
        className="theme-menu__trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        ref={trigger}
        type="button"
      >
        <Icon aria-hidden="true" size={15} />
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className="theme-menu__chevron" size={13} />
      </button>
      {open ? (
        <div
          aria-label="Appearance"
          className="theme-menu__options"
          id={id}
          onBlur={(event) => {
            if (!container.current?.contains(event.relatedTarget)) setOpen(false);
          }}
          onKeyDown={keyDown}
          role="menu"
        >
          {options.map(({ value, label: text, description, Icon: ItemIcon }, index) => (
            <button
              aria-checked={theme === value}
              className="theme-menu__option"
              key={value}
              onClick={() => {
                setTheme(value);
                setOpen(false);
                trigger.current?.focus();
              }}
              ref={(element) => {
                items.current[index] = element;
              }}
              role="menuitemradio"
              tabIndex={-1}
              type="button"
            >
              <ItemIcon aria-hidden="true" size={17} />
              <span>
                <strong>{text}</strong>
                <small>{description}</small>
              </span>
              {theme === value ? <Check aria-hidden="true" size={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
