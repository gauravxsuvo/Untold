// Budgets are payload targets, not a promise about total network overhead.
export const callMedia = {
  cameraBitrate: 1_200_000,
  screenBitrate: 2_500_000,
  audioBitrate: 32_000,
  camera: {
    facingMode: "user",
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  } satisfies MediaTrackConstraints,
  audio: {
    channelCount: { ideal: 1, max: 1 },
    sampleRate: { ideal: 48_000 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } satisfies MediaTrackConstraints,
};

export async function limitCallSenders(pc: RTCPeerConnection, sharing: boolean, peers = 1) {
  const videoBudget = Math.floor(
    (sharing ? callMedia.screenBitrate : callMedia.cameraBitrate) / Math.max(1, peers),
  );
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const video = sender.track.kind === "video";
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) {
      if (pc.connectionState === "connected") throw new Error("Call media limits unavailable");
      continue;
    }
    // A single encoding is created for each sender. Divide defensively if the
    // browser supplies several, so their combined target stays in budget.
    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = Math.floor(
        (video ? videoBudget : callMedia.audioBitrate) / parameters.encodings.length,
      );
      if (video) {
        encoding.maxFramerate = sharing ? 60 : 30;
        const settings = sender.track.getSettings();
        encoding.scaleResolutionDownBy = Math.max(
          1,
          (settings.width ?? 1280) / 1280,
          (settings.height ?? 720) / 720,
        );
      }
    }
    try {
      await sender.setParameters(parameters);
    } catch (error) {
      if (!video) throw error;
      // Some browsers omit these optional encoder controls. Capture already
      // caps dimensions/fps; keep the bitrate limit mandatory in the fallback.
      const compatible = sender.getParameters();
      if (!compatible.encodings?.length) throw error;
      for (const encoding of compatible.encodings) {
        encoding.maxBitrate = Math.floor(videoBudget / compatible.encodings.length);
        delete encoding.maxFramerate;
        delete encoding.scaleResolutionDownBy;
      }
      await sender.setParameters(compatible);
    }
  }
}

export function preferSpeechCodec(pc: RTCPeerConnection) {
  const codecs = RTCRtpSender.getCapabilities?.("audio")?.codecs;
  if (!codecs) return;
  const ordered = [...codecs].sort(
    (a, b) =>
      Number(b.mimeType.toLowerCase() === "audio/opus") -
      Number(a.mimeType.toLowerCase() === "audio/opus"),
  );
  for (const transceiver of pc.getTransceivers())
    if (transceiver.sender.track?.kind === "audio" && transceiver.setCodecPreferences)
      transceiver.setCodecPreferences(ordered);
}

// Call getDisplayMedia directly from a click: browsers require a fresh user
// gesture and show their own chooser every time. Do not request system audio.
export function chooseCallScreen() {
  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
}

export async function constrainCallScreen(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Screen sharing isn’t available here.");
  track.contentHint = "motion";
  await track.applyConstraints({
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 60, max: 60 },
  });
  return track;
}
