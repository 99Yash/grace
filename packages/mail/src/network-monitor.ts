export type NetworkState = "unknown" | "online" | "offline";

export interface NetworkStatus {
  state: NetworkState;
  lastCheckedAt: number;
  reason?: string;
}

export interface NetworkMonitorOpts {
  /** Probe target; must respond fast to HEAD/GET. Default: gstatic 204. */
  probeUrl?: string;
  /** Interval while online. Default 30s — we also react to socket close
   * via the idle-supervisor, so this is mostly a "did the machine wake
   * from sleep?" poll. */
  onlineIntervalMs?: number;
  /** Interval while offline. Default 5s — we want fast recovery. */
  offlineIntervalMs?: number;
  /** Per-probe timeout. Default 5s. */
  probeTimeoutMs?: number;
  onStateChange?: (status: NetworkStatus, prev: NetworkState) => void;
  onError?: (err: unknown) => void;
}

export interface NetworkMonitor {
  stop: () => void;
  getStatus: () => NetworkStatus;
  /** Run a probe now; resolves with the resulting state. */
  probeNow: () => Promise<NetworkState>;
}

const DEFAULT_PROBE_URL = "https://www.gstatic.com/generate_204";

export function startNetworkMonitor(opts: NetworkMonitorOpts = {}): NetworkMonitor {
  const probeUrl = opts.probeUrl ?? DEFAULT_PROBE_URL;
  const onlineInterval = opts.onlineIntervalMs ?? 30_000;
  const offlineInterval = opts.offlineIntervalMs ?? 5_000;
  const timeout = opts.probeTimeoutMs ?? 5_000;

  let status: NetworkStatus = { state: "unknown", lastCheckedAt: 0 };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const probe = async (): Promise<NetworkState> => {
    const res = await fetch(probeUrl, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    }).catch((err) => {
      throw err;
    });
    // Any 2xx or 3xx counts as connectivity. 204 is the happy path.
    if (res.status >= 200 && res.status < 400) return "online";
    return "offline";
  };

  const runProbe = async (): Promise<NetworkState> => {
    let nextState: NetworkState;
    let reason: string | undefined;
    try {
      nextState = await probe();
    } catch (err) {
      nextState = "offline";
      reason = err instanceof Error ? err.message : String(err);
      try {
        opts.onError?.(err);
      } catch (inner) {
        console.error("[network-monitor] onError threw:", inner);
      }
    }
    const prev = status.state;
    status = reason
      ? { state: nextState, lastCheckedAt: Date.now(), reason }
      : { state: nextState, lastCheckedAt: Date.now() };
    if (prev !== nextState) {
      try {
        opts.onStateChange?.(status, prev);
      } catch (err) {
        console.error("[network-monitor] onStateChange threw:", err);
      }
    }
    return nextState;
  };

  const schedule = (state: NetworkState) => {
    if (stopped) return;
    const delay = state === "offline" ? offlineInterval : onlineInterval;
    timer = setTimeout(() => {
      timer = null;
      void loop();
    }, delay);
  };

  const loop = async () => {
    if (stopped) return;
    const next = await runProbe();
    schedule(next);
  };

  void loop();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    getStatus: () => status,
    probeNow: runProbe,
  };
}
