export interface Capabilities {
  w3m: boolean;
}

let cache: Capabilities | null = null;

export function getCapabilities(): Capabilities {
  if (cache) return cache;
  const w3m = Bun.which("w3m") !== null;
  cache = { w3m };
  if (!w3m) {
    console.log(
      "[cap] w3m not found — `v` rich-render disabled. `brew install w3m` to enable.",
    );
  }
  return cache;
}
