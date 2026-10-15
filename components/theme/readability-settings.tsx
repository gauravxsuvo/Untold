"use client";

import { RotateCcw, Type, ZoomIn } from "lucide-react";
import { useReadability } from "@/components/theme/readability-provider";
import { fontSizes, interfaceZooms } from "@/lib/ui/readability";

const fontLabels = {
  small: "Small",
  default: "Default",
  large: "Large",
  "extra-large": "Extra large",
};
export function ReadabilitySettings() {
  const { fontSize, zoom, update } = useReadability();
  return (
    <article className="readability-settings">
      <div>
        <p className="messaging-kicker">Easy on your eyes</p>
        <h2>Text and display size</h2>
        <p>Adjust text on its own, or resize the whole interface. Saved on this device.</p>
      </div>
      <fieldset className="preference-options">
        <legend>
          <Type aria-hidden="true" size={16} />
          Font size
        </legend>
        <div>
          {fontSizes.map((size) => (
            <label key={size}>
              <input
                checked={fontSize === size}
                name="font-size"
                onChange={() => update({ fontSize: size, zoom })}
                type="radio"
                value={size}
              />
              <span>{fontLabels[size]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="preference-options">
        <legend>
          <ZoomIn aria-hidden="true" size={16} />
          Interface zoom
        </legend>
        <div>
          {interfaceZooms.map((value) => (
            <label key={value}>
              <input
                checked={zoom === value}
                name="interface-zoom"
                onChange={() => update({ fontSize, zoom: value })}
                type="radio"
                value={value}
              />
              <span>{value}%</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="readability-sample">
        <strong>A little space to catch up.</strong>
        <p>
          This is how conversations and controls will look. You can still pinch to zoom in your
          browser.
        </p>
      </div>
      <button
        className="security-text-button"
        onClick={() => update({ fontSize: "default", zoom: "100" })}
        type="button"
      >
        <RotateCcw aria-hidden="true" size={15} />
        Reset text and zoom
      </button>
    </article>
  );
}
