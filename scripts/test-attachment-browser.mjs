import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

// Exercise actual native Chrome codecs, including preservation of the audio track.
// Uses an isolated temporary browser profile and no application account or database.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".test-build", "browser");
const compilation = spawnSync(
  process.execPath,
  [
    join(root, "node_modules/typescript/bin/tsc"),
    "--ignoreConfig",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--lib",
    "es2022,dom,dom.iterable",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    output,
    "lib/messaging/prepare-attachment.ts",
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);

const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
let executable;
for (const candidate of candidates) {
  if (
    await stat(candidate).then(
      () => true,
      () => false,
    )
  ) {
    executable = candidate;
    break;
  }
}
assert.ok(executable, "Set BROWSER_PATH to a Chromium browser executable.");

const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.end("<!doctype html><title>Attachment codec checks</title>");
    return;
  }
  const path = resolve(output, `.${new URL(request.url, "http://localhost").pathname}`);
  if (!path.startsWith(output + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(path.endsWith(".js") ? path : `${path}.js`);
    response.setHeader("Content-Type", "text/javascript");
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const testUrl = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), "untold-codec-test-"));
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then(
      (text) => text.split("\n")[0],
      () => null,
    );
    if (port) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(port, "Headless browser did not start.");
  const page = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(testUrl)}`, {
    method: "PUT",
  }).then((response) => response.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let requestId = 0;
  const pending = new Map();
  socket.on("message", (message) => {
    const data = JSON.parse(String(message));
    const request = pending.get(data.id);
    if (request) {
      pending.delete(data.id);
      data.error ? request.reject(data.error) : request.resolve(data.result);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await command("Page.enable");
  await command("Page.navigate", { url: testUrl });
  await command("Page.bringToFront");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await command("Runtime.evaluate", {
    expression: `(${checkBrowserCodecs.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      browser.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // Only remove the exact temporary profile created above, after the browser exits.
  if (
    resolve(profile).startsWith(resolve(tmpdir()) + sep) &&
    basename(profile).startsWith("untold-codec-test-")
  ) {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
  }
}

async function checkBrowserCodecs() {
  const { prepareAttachment, validateAttachmentPreview } = await import("/prepare-attachment.js");
  const { decodeAttachmentBytes } = await import("/attachment-compression.js");
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const restore = (prepared) =>
    decodeAttachmentBytes(prepared.bytes, {
      ...prepared,
      size: prepared.bytes.length,
      version: prepared.compression ? 2 : 1,
    });
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  let seed = 17;
  const noise = () => {
    const image = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      image.data[index] = seed & 255;
      image.data[index + 1] = (seed >> 8) & 255;
      image.data[index + 2] = (seed >> 16) & 255;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };
  noise();
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const image = await prepareAttachment(new File([png], "Photo.png", { type: "image/png" }));
  assert(image.name === "Photo.webp" && image.bytes.length < png.size, "Image was not optimized.");
  const imageBytes = await restore(image);
  const bitmap = await createImageBitmap(new Blob([imageBytes], { type: image.contentType }));
  assert(bitmap.width === 1200 && bitmap.height === 800, "Image dimensions changed incorrectly.");
  bitmap.close();
  await validateAttachmentPreview(imageBytes, image.contentType);

  const audio = new AudioContext();
  await audio.resume();
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 440;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  const sourceStream = new MediaStream([
    ...canvas.captureStream(24).getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(sourceStream, {
    mimeType: "video/webm;codecs=vp8,opus",
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  const recorded = new Promise((resolve) => {
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });
  const animation = setInterval(noise, 40);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  recorder.stop();
  const rawVideo = await recorded;
  clearInterval(animation);
  oscillator.stop();
  await audio.close();
  for (const track of sourceStream.getTracks()) track.stop();

  const inputVideo = new File([rawVideo], "Video.webm", { type: "video/webm" });
  const probe = document.createElement("video");
  const probeUrl = URL.createObjectURL(inputVideo);
  const probed = new Promise((resolve, reject) => {
    probe.onloadedmetadata = resolve;
    probe.onerror = () => reject(new Error("Invalid generated video fixture."));
  });
  probe.src = probeUrl;
  await probed;
  const metadata = { duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight };
  probe.muted = true;
  await probe.play();
  const probeCapture = probe.captureStream();
  metadata.tracks = probeCapture.getTracks().map((track) => track.kind);
  for (const track of probeCapture.getTracks()) track.stop();
  probe.pause();
  probe.removeAttribute("src");
  probe.load();
  URL.revokeObjectURL(probeUrl);
  let lastProgress = -1;
  const video = await prepareAttachment(inputVideo, {
    onProgress: (progress) => {
      lastProgress = progress;
    },
  });
  assert(
    lastProgress > 0,
    `Video transcoding did not run (hidden=${document.hidden}, source=${inputVideo.size} bytes, metadata=${JSON.stringify(metadata)}).`,
  );
  assert(video.bytes.length < inputVideo.size, "Video was not reduced.");
  const videoBytes = await restore(video);
  await validateAttachmentPreview(videoBytes, "video/webm");
  const element = document.createElement("video");
  element.muted = true;
  const videoUrl = URL.createObjectURL(new Blob([videoBytes], { type: "video/webm" }));
  element.src = videoUrl;
  await element.play();
  const captured = element.captureStream();
  assert(captured.getAudioTracks().length === 1, "Video optimization lost its audio track.");
  const analysis = new AudioContext();
  await analysis.resume();
  const analyser = analysis.createAnalyser();
  analysis.createMediaStreamSource(captured).connect(analyser);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  assert(
    samples.some((value) => Math.abs(value - 128) > 8),
    "Optimized audio is silent.",
  );
  element.pause();
  element.removeAttribute("src");
  element.load();
  URL.revokeObjectURL(videoUrl);
  await analysis.close();
  for (const track of captured.getTracks()) track.stop();
  const cancellation = new AbortController();
  let cancelled = false;
  try {
    await prepareAttachment(inputVideo, {
      signal: cancellation.signal,
      onProgress: (progress) => {
        if (progress > 5) cancellation.abort();
      },
    });
  } catch (error) {
    cancelled = error.name === "AbortError";
  }
  assert(
    cancelled,
    "Cancelling a video must stop processing without returning a partial recording.",
  );
  const nativeRecorder = window.MediaRecorder;
  let unchanged;
  try {
    window.MediaRecorder = undefined;
    unchanged = await restore(await prepareAttachment(inputVideo));
  } finally {
    window.MediaRecorder = nativeRecorder;
  }
  const originalVideo = new Uint8Array(await inputVideo.arrayBuffer());
  assert(
    unchanged.length === originalVideo.length &&
      unchanged.every((byte, index) => byte === originalVideo[index]),
    "Unavailable video encoders must preserve the original file.",
  );
  return {
    image: { sourceBytes: png.size, storedBytes: image.bytes.length, output: image.name },
    video: {
      sourceBytes: inputVideo.size,
      storedBytes: video.bytes.length,
      output: video.name,
      audioPreserved: true,
    },
    cancellation: "passed",
    unsupportedEncoderFallback: "passed",
  };
}
