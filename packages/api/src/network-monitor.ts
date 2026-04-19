import { startNetworkMonitor, type NetworkMonitor, type NetworkStatus } from "@grace/mail";
import { bus } from "./bus.ts";
import { getFolderManager } from "./folder-manager.ts";

let monitor: NetworkMonitor | null = null;

/** Starts the singleton network monitor. Idempotent. Publishes
 * `network.status` on transitions and kicks every active folder supervisor
 * out of its backoff when connectivity is restored, so recovery from sleep
 * or WiFi churn doesn't wait through the 60s worst-case IDLE backoff. */
export function startNetworkMonitorSingleton(): NetworkMonitor {
  if (monitor) return monitor;
  monitor = startNetworkMonitor({
    onStateChange: (status: NetworkStatus, prev) => {
      bus.publish({
        type: "network.status",
        state: status.state === "offline" ? "offline" : "online",
        ...(status.reason !== undefined ? { reason: status.reason } : {}),
      });
      if (status.state === "online") {
        const transition = prev === "unknown" ? "confirmed" : "restored";
        console.log(`[network] ${transition} — online`);
        if (prev === "offline") {
          const mgr = getFolderManager();
          const kicked = mgr?.kickAll("network restored") ?? 0;
          if (kicked > 0) {
            console.log(`[network] kicked ${kicked} idle supervisor(s) out of backoff`);
          }
        }
      } else if (status.state === "offline") {
        console.log(
          `[network] offline${status.reason ? ` — ${status.reason}` : ""}`,
        );
      }
    },
    onError: (err) => {
      // Probe failures transition state via onStateChange; log only unusual ones.
      if (process.env.GRACE_NETWORK_DEBUG === "1") {
        console.error("[network] probe error:", err);
      }
    },
  });
  return monitor;
}

export function stopNetworkMonitorSingleton(): void {
  if (!monitor) return;
  monitor.stop();
  monitor = null;
}

export function getNetworkStatus(): NetworkStatus | null {
  return monitor?.getStatus() ?? null;
}
