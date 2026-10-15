type CandidateCounts = { host: number; srflx: number; prflx: number; relay: number };

function candidateCounts(sdp: string): CandidateCounts {
  const counts: CandidateCounts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    const type = line.match(/\styp (host|srflx|prflx|relay)(?:\s|$)/)?.[1];
    if (type) counts[type as keyof CandidateCounts]++;
  }
  return counts;
}

// Sign a snapshot containing gathered candidates. An unreachable optional ICE
// server must not prevent using routes that other servers have already found.
// max-bundle on the peer makes these routes apply to both audio and video.
export function gatherCallDescription(
  pc: RTCPeerConnection,
  isCurrent: () => boolean,
): Promise<RTCSessionDescriptionInit> {
  const policy = pc.getConfiguration().iceTransportPolicy ?? "all";
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastCandidateAt = startedAt;
    let settled = false;
    const errorCodes = new Set<number>();
    const done = () => {
      settled = true;
      clearInterval(timer);
      pc.removeEventListener("icecandidate", candidate);
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidateerror", candidateError);
    };
    const candidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate?.candidate) lastCandidateAt = Date.now();
      check();
    };
    const candidateError = (event: RTCPeerConnectionIceErrorEvent) => {
      // Do not log URLs, addresses, SDP, credentials, or browser error text.
      if (Number.isInteger(event.errorCode) && errorCodes.size < 16)
        errorCodes.add(event.errorCode);
    };
    const check = () => {
      if (settled) return;
      if (!isCurrent() || pc.signalingState === "closed") {
        done();
        reject(new Error("Call cancelled"));
        return;
      }
      const description = pc.localDescription;
      const counts = candidateCounts(description?.sdp ?? "");
      const elapsed = Date.now() - startedAt;
      const complete = pc.iceGatheringState === "complete";
      const deadline = elapsed >= 25_000;
      // Leave a short window for other routes after a relay allocation works.
      // Otherwise wait for completion or the bounded gathering deadline.
      const relayReady =
        counts.relay > 0 && elapsed >= 3000 && Date.now() - lastCandidateAt >= 1500;
      if (!complete && !deadline && !relayReady) return;
      const usable =
        policy === "relay"
          ? counts.relay > 0
          : counts.host + counts.srflx + counts.prflx + counts.relay > 0;
      done();
      if (!usable || !description || !["offer", "answer"].includes(description.type)) {
        console.warn("Untold call setup", {
          reason: policy === "relay" ? "no-relay-candidate" : "no-connection-candidate",
          policy,
          gatheringState: pc.iceGatheringState,
          candidateTypes: counts,
          iceErrorCodes: [...errorCodes],
        });
        reject(
          new Error(
            policy === "relay"
              ? "The call connection service couldn’t be reached. Try another network or try again later."
              : "The call couldn’t find a connection. Try another network or try again later.",
          ),
        );
        return;
      }
      const hasRelayService = pc
        .getConfiguration()
        .iceServers?.some((server) =>
          (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
            /^turns?:/i.test(url),
          ),
        );
      if ((deadline && !complete) || (hasRelayService && counts.relay === 0))
        console.warn("Untold call setup", {
          reason:
            hasRelayService && counts.relay === 0
              ? "relay-not-reached"
              : "using-gathered-candidates",
          policy,
          candidateTypes: counts,
          iceErrorCodes: [...errorCodes],
        });
      // This immutable SDP string is signed exactly as sent. Later candidates
      // are not sent unsigned or appended to an already signed description.
      resolve({ type: description.type, sdp: description.sdp });
    };
    const timer = setInterval(check, 200);
    pc.addEventListener("icecandidate", candidate);
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidateerror", candidateError);
    check();
  });
}
