import "server-only";

import { deliverPushOutbox } from "@/lib/server/push";

const state = globalThis as typeof globalThis & {
  untoldPushTimer?: ReturnType<typeof setInterval>;
};
export function startPushWorker() {
  if (state.untoldPushTimer) return;
  let busy = false;
  let lastReported = 0;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await deliverPushOutbox();
    } catch {
      if (Date.now() - lastReported > 300_000) {
        console.error("Untold notification delivery is temporarily unavailable");
        lastReported = Date.now();
      }
    } finally {
      busy = false;
    }
  }, 30_000);
  timer.unref();
  state.untoldPushTimer = timer;
}
