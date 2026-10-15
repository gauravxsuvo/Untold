"use client";

import { Camera, Crop, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { compressProfilePhoto, openProfilePhoto } from "@/lib/profile/prepare-photo";
import { PhotoCropper } from "./photo-cropper";
import { ProfilePhotoError } from "@/lib/profile/photos";
import {
  removeProfilePhoto,
  updateProfilePhoto,
  userFacingError,
} from "@/lib/messaging/api-client";

export function ProfilePhotoEditor({
  hasPhoto,
  image,
  onChange,
  onUpload = updateProfilePhoto,
  onRemove = removeProfilePhoto,
}: {
  hasPhoto: boolean;
  image?: string | null;
  onChange: (image: string | null) => void;
  onUpload?: (photo: Blob, signal?: AbortSignal) => Promise<string>;
  onRemove?: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const operationRef = useRef<AbortController | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [busy, setBusy] = useState<"opening" | "saving" | "removing" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [cropReady, setCropReady] = useState(false);
  useEffect(() => () => operationRef.current?.abort(), []);
  useEffect(() => () => bitmap?.close(), [bitmap]);

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
    await preparePhoto(file);
  }

  async function preparePhoto(file: File) {
    operationRef.current?.abort();
    const operation = new AbortController();
    operationRef.current = operation;
    setBusy("opening");
    setFeedback("");
    setIsError(false);
    setBitmap(null);
    setCropReady(false);
    try {
      const next = await openProfilePhoto(file, operation.signal);
      if (operation.signal.aborted) {
        next.close();
        return;
      }
      setBitmap(next);
    } catch (error) {
      if (!operation.signal.aborted) showError(error);
    } finally {
      if (!operation.signal.aborted) setBusy(null);
    }
  }

  async function cropCurrent() {
    if (!image || busy) return;
    const operation = new AbortController();
    operationRef.current?.abort();
    operationRef.current = operation;
    setBusy("opening");
    setFeedback("");
    try {
      const response = await fetch(image, {
        cache: "no-store",
        credentials: "same-origin",
        signal: operation.signal,
      });
      if (!response.ok) throw new Error("Photo unavailable");
      const blob = await response.blob();
      if (operation.signal.aborted) return;
      await preparePhoto(new File([blob], "profile.webp", { type: blob.type }));
    } catch (error) {
      if (!operation.signal.aborted) showError(error);
    } finally {
      if (operationRef.current === operation) setBusy(null);
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
      const image = await onUpload(photo, operation.signal);
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
      await onRemove();
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
          <>
            <button
              disabled={Boolean(busy) || !image}
              onClick={() => void cropCurrent()}
              type="button"
            >
              <Crop aria-hidden="true" size={15} />
              Crop photo
            </button>
            <button
              className="profile-photo-editor__remove"
              disabled={Boolean(busy)}
              onClick={() => void remove()}
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
              {busy === "removing" ? "Removing…" : "Remove"}
            </button>
          </>
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
          <legend>Crop your photo</legend>
          <PhotoCropper
            key={`${bitmap.width}:${bitmap.height}`}
            bitmap={bitmap}
            output={canvasRef}
            disabled={Boolean(busy)}
            onReady={setCropReady}
          />
          <div className="profile-photo-crop__controls">
            <div className="profile-photo-editor__actions">
              <button
                disabled={Boolean(busy) || !cropReady}
                onClick={() => void save()}
                type="button"
              >
                <Upload size={14} aria-hidden="true" />
                {busy === "saving" ? "Saving…" : "Save photo"}
              </button>
              <button
                disabled={Boolean(busy)}
                onClick={() => {
                  setBitmap(null);
                  setCropReady(false);
                }}
                type="button"
              >
                <X size={14} aria-hidden="true" />
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
