"use client";

import { Camera, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { compressProfilePhoto, openProfilePhoto } from "@/lib/profile/prepare-photo";
import { ProfilePhotoError } from "@/lib/profile/photos";
import {
  removeProfilePhoto,
  updateProfilePhoto,
  userFacingError,
} from "@/lib/messaging/api-client";

export function ProfilePhotoEditor({
  hasPhoto,
  onChange,
}: {
  hasPhoto: boolean;
  onChange: (image: string | null) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const operationRef = useRef<AbortController | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [busy, setBusy] = useState<"opening" | "saving" | "removing" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [cropReady, setCropReady] = useState(false);

  useEffect(() => () => operationRef.current?.abort(), []);
  useEffect(() => () => bitmap?.close(), [bitmap]);
  useEffect(() => {
    if (!bitmap || !canvasRef.current) {
      setCropReady(false);
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      setCropReady(false);
      setIsError(true);
      setFeedback("This browser can’t prepare a photo right now. Please try another browser.");
      return;
    }
    const side = Math.min(bitmap.width, bitmap.height) / zoom;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(
      bitmap,
      ((bitmap.width - side) * (horizontal + 1)) / 2,
      ((bitmap.height - side) * (vertical + 1)) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    setCropReady(true);
  }, [bitmap, zoom, horizontal, vertical]);

  function showError(error: unknown) {
    setIsError(true);
    setFeedback(
      error instanceof ProfilePhotoError
        ? error.message
        : userFacingError(error, "We couldn’t update your photo. Please try again."),
    );
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    operationRef.current?.abort();
    const operation = new AbortController();
    operationRef.current = operation;
    setBusy("opening");
    setFeedback("");
    setIsError(false);
    setBitmap(null);
    try {
      const next = await openProfilePhoto(file, operation.signal);
      if (operation.signal.aborted) {
        next.close();
        return;
      }
      setZoom(1);
      setHorizontal(0);
      setVertical(0);
      setBitmap(next);
    } catch (error) {
      if (!operation.signal.aborted) showError(error);
    } finally {
      if (!operation.signal.aborted) setBusy(null);
    }
  }

  async function save() {
    if (!canvasRef.current || !cropReady || busy) return;
    const operation = new AbortController();
    operationRef.current = operation;
    setBusy("saving");
    setFeedback("");
    setIsError(false);
    try {
      const photo = await compressProfilePhoto(canvasRef.current);
      operation.signal.throwIfAborted();
      const image = await updateProfilePhoto(photo, operation.signal);
      if (operation.signal.aborted) return;
      onChange(image);
      setBitmap(null);
      setFeedback("Your photo has been saved.");
    } catch (error) {
      if (!operation.signal.aborted) showError(error);
    } finally {
      if (!operation.signal.aborted) setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy("removing");
    setFeedback("");
    setIsError(false);
    try {
      await removeProfilePhoto();
      onChange(null);
      setFeedback("Your photo has been removed.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="profile-photo-editor">
      <div className="profile-photo-editor__actions">
        <button disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} type="button">
          <Camera aria-hidden="true" size={15} />
          {busy === "opening" ? "Opening photo…" : hasPhoto ? "Change photo" : "Add photo"}
        </button>
        {hasPhoto && !bitmap ? (
          <button
            className="profile-photo-editor__remove"
            disabled={Boolean(busy)}
            onClick={() => void remove()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy === "removing" ? "Removing…" : "Remove"}
          </button>
        ) : null}
        <input
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose a profile photo"
          className="sr-only"
          disabled={Boolean(busy)}
          onChange={(event) => void choosePhoto(event)}
          ref={fileRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      <p className="profile-photo-editor__hint">
        JPG, PNG, or WebP. Up to 8 MB. We’ll save a smaller version.
      </p>
      {bitmap ? (
        <fieldset className="profile-photo-crop">
          <legend className="sr-only">Adjust your photo</legend>
          <canvas
            aria-label="Preview of your profile photo"
            className="profile-photo-crop__preview"
            height={512}
            ref={canvasRef}
            role="img"
            width={512}
          />
          <div className="profile-photo-crop__controls">
            <label htmlFor={`${id}-zoom`}>Zoom</label>
            <input
              disabled={Boolean(busy)}
              id={`${id}-zoom`}
              max={3}
              min={1}
              onChange={(event) => setZoom(Number(event.target.value))}
              step={0.05}
              type="range"
              value={zoom}
            />
            <label htmlFor={`${id}-horizontal`}>Move left or right</label>
            <input
              disabled={Boolean(busy)}
              id={`${id}-horizontal`}
              max={1}
              min={-1}
              onChange={(event) => setHorizontal(Number(event.target.value))}
              step={0.05}
              type="range"
              value={horizontal}
            />
            <label htmlFor={`${id}-vertical`}>Move up or down</label>
            <input
              disabled={Boolean(busy)}
              id={`${id}-vertical`}
              max={1}
              min={-1}
              onChange={(event) => setVertical(Number(event.target.value))}
              step={0.05}
              type="range"
              value={vertical}
            />
            <div className="profile-photo-editor__actions">
              <button
                disabled={Boolean(busy) || !cropReady}
                onClick={() => void save()}
                type="button"
              >
                <Upload aria-hidden="true" size={14} />
                {busy === "saving" ? "Saving…" : "Save photo"}
              </button>
              <button disabled={Boolean(busy)} onClick={() => setBitmap(null)} type="button">
                <X aria-hidden="true" size={14} />
                Cancel
              </button>
            </div>
          </div>
        </fieldset>
      ) : null}
      {feedback ? (
        <p
          aria-live="polite"
          className={isError ? "messaging-error" : "profile-photo-editor__feedback"}
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
