import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir, stat, rm } from "node:fs/promises";
import { resolve, join, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, ".test-build/call-tools/package.json"));
const { build } = require("esbuild");
const output = join(root, ".test-build/calls-browser");
await mkdir(output, { recursive: true });
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Mic,Video,MonitorUp,PhoneOff} from 'lucide-react';
import {CallWindow} from './components/messaging/call-window';
import {CallMediaView} from './components/messaging/call-media-view';
import {CallDevicesProvider,useCallDevices} from './components/messaging/call-devices';
import {CallHistoryCard} from './components/messaging/call-history-entry';
import {limitCallSenders} from './lib/messaging/call-media';
const canvas=document.createElement('canvas'); canvas.width=640; canvas.height=360;
const ctx=canvas.getContext('2d'); let ticks=0; let sharing=false;
const draw=()=>{ticks++;ctx.fillStyle=sharing?'#c4b38e':'#244b52';ctx.fillRect(0,0,640,360);ctx.fillStyle=sharing?'#25352b':'#d2efe0';ctx.font='32px system-ui';ctx.fillText(sharing?'Quarterly project review':'Alex — remote video',40,90);ctx.font='18px system-ui';ctx.fillText('Live frame '+ticks,40,130);};
draw();const ticker=setInterval(draw,50);
const source=canvas.captureStream(20);const sound=new AudioContext();const oscillator=sound.createOscillator();const gain=sound.createGain();gain.gain.value=0;oscillator.connect(gain);const destination=sound.createMediaStreamDestination();gain.connect(destination);oscillator.start();
source.addTrack(destination.stream.getAudioTracks()[0]);
const sending=new RTCPeerConnection({iceServers:[]});const receiving=new RTCPeerConnection({iceServers:[]});const remote=new MediaStream();
receiving.ontrack=e=>remote.addTrack(e.track);
for(const track of source.getTracks())sending.addTrack(track,source);
const gathered=pc=>pc.iceGatheringState==='complete'?Promise.resolve():new Promise((yes)=>{const change=()=>{if(pc.iceGatheringState==='complete'){pc.removeEventListener('icegatheringstatechange',change);yes();}};pc.addEventListener('icegatheringstatechange',change);});
await sending.setLocalDescription(await sending.createOffer());await gathered(sending);await receiving.setRemoteDescription(sending.localDescription);await receiving.setLocalDescription(await receiving.createAnswer());await gathered(receiving);await sending.setRemoteDescription(receiving.localDescription);
await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Loopback connection timed out')),10000);const ready=()=>{if(sending.connectionState==='connected'){clearTimeout(timer);yes();}};sending.addEventListener('connectionstatechange',ready);ready();});
await limitCallSenders(sending,false);
const entry={id:'direct:11111111-1111-4111-8111-111111111111',source:'direct',sourceId:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',initiatorId:'other',name:'Alex Morgan',kind:'video',status:'ended',outcome:'completed',createdAt:'2026-10-16T05:10:00Z',connectedAt:'2026-10-16T05:10:10Z',endedAt:'2026-10-16T05:14:42Z',durationSeconds:272,personalSeconds:null,missed:false,acknowledged:true,legacy:false,participants:[{userId:'other',name:'Alex Morgan',status:'joined',seconds:null},{userId:'me',name:'You',status:'joined',seconds:null}]};
function Fixture(){const[min,setMin]=useState(false);const[ended,setEnded]=useState(false);const[group,setGroup]=useState(false);const[muted,setMuted]=useState(false);window.testSetGroup=setGroup;return <CallDevicesProvider><AudioActions/><main style={{padding:24}}><h1>Call history</h1><CallHistoryCard entry={entry} viewerId="me"/><CallHistoryCard entry={{...entry,id:'missed',name:'Design group',source:'group',missed:true,outcome:'missed',durationSeconds:null,connectedAt:null}} viewerId="me"/></main>{!ended&&<CallWindow title={group?'Group call: Design group':'Call with Alex Morgan'} group={group} live minimized={min} onMinimize={setMin} onEnd={()=>setEnded(true)} onMute={()=>setMuted(!muted)} muted={muted} duration="4:32"><h2>{group?'Design group':'Alex Morgan'}</h2><p className="call-phase">Connected · 4:32</p>{group?<div className="group-call-grid">{['Alex Morgan','You','Sam Rivera'].map((name,i)=><div className="group-call-tile" key={name}><CallMediaView stream={remote} muted={i>0} label={name}/><div className="group-call-tile__caption"><strong>{name}</strong><span>Connected</span></div></div>)}</div>:<div className="call-stage"><div className="call-video"><CallMediaView stream={remote} label="Alex Morgan"/></div><div className="call-video call-video--self"><CallMediaView stream={source} muted label="Your camera preview"/></div></div>}<div className="call-controls">{['Mute','Camera off','Share screen','End call'].map(label=><button className={'call-control'+(label==='End call'?' call-control--end':'')} key={label} type="button" onClick={()=>label==='End call'&&setEnded(true)}>{React.createElement({'Mute':Mic,'Camera off':Video,'Share screen':MonitorUp,'End call':PhoneOff}[label],{size:22,'aria-hidden':true})}<span>{label}</span></button>)}</div><details className="call-more"><summary>More options</summary><p className="call-note">Choose microphone, camera and speakers. Keep Untold open during a call.</p></details></CallWindow>}</CallDevicesProvider>};
function AudioActions(){window.testSelectOutput=useCallDevices().selectOutput;return null;}
createRoot(document.getElementById('root')).render(<Fixture/>);
window.testAPI={remote,source,sending,receiving,async share(){sharing=true;const replacement=canvas.captureStream(20).getVideoTracks()[0];await sending.getSenders().find(s=>s.track?.kind==='video').replaceTrack(replacement);await limitCallSenders(sending,true);return replacement.readyState;}, stop(){source.getTracks().forEach(t=>t.stop());sending.getSenders().forEach(s=>s.track?.stop());sending.close();receiving.close();oscillator.stop();sound.close();clearInterval(ticker);}, get ticks(){return ticks;}};
window.testReady=true;
`;
const bundle = await build({
  stdin: { contents: fixture, resolveDir: root, loader: "tsx", sourcefile: "call-fixture.tsx" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixture-context",
      setup(b) {
        b.onResolve(
          { filter: /^(?:\.\/call-provider|\.\/messaging-device-provider)$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const useCalls=()=>({active:false,start:async()=>{}});export const useMessagingDevice=()=>({approved:true});",
        }));
        b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "link" }));
        b.onLoad({ filter: /.*/, namespace: "link" }, () => ({
          contents:
            "import React from 'react';export default function Link(props){return React.createElement('a',props)}",
          resolveDir: root,
        }));
      },
    },
  ],
});
await writeFile(join(output, "fixture.js"), bundle.outputFiles[0].contents);
const css = (
  await Promise.all(
    [
      "globals.css",
      "themes.css",
      "improvements.css",
      "membership-media.css",
      "call-controls.css",
    ].map((name) => readFile(join(root, "app", name), "utf8")),
  )
)
  .join("\n")
  .replace('@import "tailwindcss";', "");
await writeFile(join(output, "fixture.css"), css);
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  if (name === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
    return;
  }
  if (!["/fixture.js", "/fixture.css"].includes(name)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", name.endsWith("js") ? "text/javascript" : "text/css");
  res.end(await readFile(join(output, name.slice(1))));
});
await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
const url = `http://127.0.0.1:${server.address().port}/`;
const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
let executable;
for (const candidate of candidates)
  if (
    await stat(candidate).then(
      () => true,
      () => false,
    )
  ) {
    executable = candidate;
    break;
  }
assert.ok(executable, "Set BROWSER_PATH to a Chromium executable");
const profile = await mkdtemp(join(tmpdir(), "untold-call-test-"));
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);
let socket;
const sleep = (ms) => new Promise((yes) => setTimeout(yes, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then(
      (s) => s.split("\n")[0],
      () => null,
    );
    if (port) break;
    await sleep(100);
  }
  assert.ok(port, "Browser did not start");
  const page = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  }).then((r) => r.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((yes, no) => {
    socket.once("open", yes);
    socket.once("error", no);
  });
  let id = 0;
  const pending = new Map();
  socket.on("message", (message) => {
    const data = JSON.parse(String(message));
    const task = pending.get(data.id);
    if (task) {
      pending.delete(data.id);
      data.error ? task.reject(data.error) : task.resolve(data.result);
    }
  });
  const command = (method, params = {}) =>
    new Promise((yes, no) => {
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        no(Error(`CDP timeout: ${method}`));
      }, 20000);
      pending.set(key, {
        resolve: (v) => {
          clearTimeout(timer);
          yes(v);
        },
        reject: (v) => {
          clearTimeout(timer);
          no(v);
        },
      });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression, userGesture = false) => {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture,
    });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command("Page.enable");
  await command("Page.bringToFront");
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await evaluate("Boolean(window.testReady)");
    if (ready) break;
    await sleep(200);
  }
  assert.ok(ready, "Media fixture failed to initialize");
  await evaluate(
    "window.testLateAudio=window.testAPI.remote.getAudioTracks()[0];window.testAPI.remote.removeTrack(window.testLateAudio)",
  );
  await sleep(100);
  await evaluate("window.testAPI.remote.addTrack(window.testLateAudio)");
  await sleep(150);
  assert.equal(
    await evaluate("document.querySelector('video[data-call-remote]').paused"),
    false,
    "Late audio does not interrupt video",
  );
  await evaluate(
    "window.testOriginalSink=HTMLMediaElement.prototype.setSinkId;document.querySelector('audio').setSinkId=async()=>{throw new DOMException('Test output disconnected','NotFoundError')};window.testSelectOutput('unavailable').catch(()=>{})",
  );
  await sleep(150);
  assert.equal(
    await evaluate("document.querySelector('video[data-call-remote]').paused"),
    false,
    "Audio output failure must not pause incoming video",
  );
  assert.equal(
    await evaluate("document.querySelector('audio').paused"),
    true,
    "Disconnected output stays private",
  );
  await evaluate(
    "document.querySelector('audio').setSinkId=window.testOriginalSink;window.testSelectOutput('')",
  );
  await sleep(100);
  const cases = [];
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [390, 340],
    [844, 390],
    [768, 1024],
    [1366, 768],
    [1440, 900],
  ]) {
    await command("Emulation.setTouchEmulationEnabled", {
      enabled: width < 1000,
      maxTouchPoints: 1,
    });
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 1000,
    });
    await sleep(250);
    const metrics = await evaluate(
      `(()=>{const v=document.querySelector('video[data-call-remote]');const box=v.getBoundingClientRect();const controls=document.querySelector('.call-controls').getBoundingClientRect();return {width:box.width,height:box.height,frames:v.getVideoPlaybackQuality().totalVideoFrames,playing:!v.paused,controlsBottom:controls.bottom,viewport:innerHeight,audio:document.querySelectorAll('audio').length};})()`,
    );
    assert.ok(metrics.width > 40 && metrics.height > 40, JSON.stringify(metrics));
    assert.ok(metrics.playing && metrics.frames > 0, "Remote video must play before fullscreen");
    assert.ok(metrics.controlsBottom <= metrics.viewport + 1, JSON.stringify(metrics));
    assert.equal(metrics.audio, 1, "Exactly one remote audio owner");
    const shot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `call-${width}x${height}.png`), Buffer.from(shot.data, "base64"));
    cases.push({ viewport: `${width}x${height}`, ...metrics });
  }
  await evaluate("document.querySelector('[aria-label=\"Minimize call\"]').click()", true);
  await sleep(150);
  assert.equal(await evaluate("Boolean(document.querySelector('.call-mini'))"), true);
  await evaluate("document.querySelector('.call-mini__return').click()", true);
  await sleep(150);
  assert.equal(await evaluate("document.querySelector('video[data-call-remote]').paused"), false);
  await evaluate(
    `(()=>{Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:{requestWindow:async()=>{throw new DOMException('Denied','NotAllowedError')}}});const open=window.open.bind(window);window.open=(...args)=>(window.testPopup=open(...args));document.querySelector('[aria-label="Open floating call"]').click();})()`,
    true,
  );
  await sleep(150);
  assert.ok(
    (await evaluate("document.querySelector('.call-window__message').textContent")).includes(
      "Open separate window",
    ),
  );
  await evaluate("document.querySelector('.call-window__message button').click()", true);
  await sleep(350);
  assert.equal(
    await evaluate("Boolean(window.testPopup?.document.querySelector('.call-window--external'))"),
    true,
    "Popup contains the existing call",
  );
  assert.equal(
    await evaluate(
      "window.testPopup.document.querySelector('video[data-call-remote]').srcObject===window.testAPI.remote",
    ),
    true,
    "Popup preserves media ownership",
  );
  await evaluate("window.testPopup.close()");
  await sleep(250);
  assert.equal(
    await evaluate("Boolean(document.querySelector('.call-window:not(.call-window--external)'))"),
    true,
    "Closing popup restores call",
  );
  assert.equal(await evaluate("window.testAPI.share()"), "live");
  await sleep(350);
  assert.equal(await evaluate("document.querySelector('video[data-call-remote]').paused"), false);
  await evaluate("window.testSetGroup(true)");
  await sleep(250);
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(150);
  assert.equal(await evaluate("document.querySelectorAll('.group-call-tile').length"), 3);
  const groupShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "group-phone.png"), Buffer.from(groupShot.data, "base64"));
  await evaluate(
    "document.documentElement.dataset.theme='amoled';document.documentElement.style.setProperty('--text-scale','1.3');document.documentElement.style.zoom='1.2'",
  );
  await sleep(200);
  const large = await evaluate(
    "(()=>{const b=document.querySelector('.call-controls').getBoundingClientRect();return {bottom:b.bottom,height:innerHeight};})()",
  );
  assert.ok(
    large.bottom <= large.height + 1,
    `Zoomed controls stay inside viewport: ${JSON.stringify(large)}`,
  );
  const largeShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "group-large-amoled.png"), Buffer.from(largeShot.data, "base64"));
  await command("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate("document.documentElement.style.setProperty('--text-scale','2')");
  await sleep(200);
  const twice = await evaluate(
    "(()=>{const b=document.querySelector('.call-controls').getBoundingClientRect();return {bottom:b.bottom,height:innerHeight,stage:document.querySelector('.group-call-grid').getBoundingClientRect().height};})()",
  );
  assert.ok(
    twice.bottom <= twice.height + 1 && twice.stage > 40,
    `200% text keeps media and controls visible: ${JSON.stringify(twice)}`,
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.call-control')].every(button=>button.scrollWidth<=button.clientWidth+1)",
    ),
    true,
    "Large control labels do not overlap adjacent actions",
  );
  const twiceShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "group-200-percent.png"), Buffer.from(twiceShot.data, "base64"));
  await evaluate(
    "document.querySelector('.call-control--end').click();document.documentElement.dataset.theme='light';document.documentElement.style.zoom='1';document.documentElement.style.setProperty('--text-scale','1')",
  );
  await sleep(200);
  const historyShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "history-phone.png"), Buffer.from(historyShot.data, "base64"));
  await evaluate("window.testAPI.stop()");
  assert.equal(
    await evaluate("window.testAPI.source.getTracks().every(t=>t.readyState==='ended')"),
    true,
  );
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        cases,
        lateAudio: true,
        outputFailureVideoIndependence: true,
        minimizedRestore: true,
        popupFallbackAndRestore: true,
        senderReplacement: true,
        groupTiles: true,
        largeTextZoom: true,
        cleanup: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Browser checks passed: live loopback video/audio, ${cases.length} viewports, minimize/restore, sender replacement, group layout, zoom, and cleanup. Artifacts: ${output}`,
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
  await sleep(400);
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  server.closeAllConnections();
  await new Promise((yes) => server.close(yes));
  if (
    resolve(profile).startsWith(resolve(tmpdir()) + sep) &&
    basename(profile).startsWith("untold-call-test-")
  )
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }).catch(
      () => {},
    );
}
