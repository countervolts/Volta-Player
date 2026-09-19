/**
 * Development-only timing for the local-library scan.
 *
 * Opening a folder reads thousands of files, and the phases that dominate have
 * moved more than once. These marks make the current bottleneck measurable
 * without leaving log noise in production builds.
 *
 * Enable with either:
 *   - `localStorage.setItem("volta-local-library-timing", "true")`
 *   - `window.__voltaLocalLibraryTiming = true`
 */

const STORAGE_KEY = "volta-local-library-timing";

type TimingWindow = Window & { __voltaLocalLibraryTiming?: boolean };

let enabled: boolean | null = null;

const isEnabled = () => {
  if (enabled !== null) return enabled;
  try {
    const override = (window as TimingWindow).__voltaLocalLibraryTiming;
    enabled =
      override === true ||
      window.localStorage?.getItem(STORAGE_KEY) === "true";
  } catch {
    enabled = false;
  }
  return enabled;
};

export type LocalLibraryScan = {
  /** Marks recorded so far, in the order they happened. */
  marks: Array<{ label: string; at: number }>;
  /** Record a named point in the scan. */
  mark: (label: string) => void;
  /** Finish the scan and log the per-phase breakdown. */
  end: (label?: string) => void;
};

/**
 * Start a scan measurement. When timing is disabled this returns a no-op
 * recorder, so callers never need to branch on whether it is enabled.
 */
export const startLocalLibraryScan = (): LocalLibraryScan => {
  if (!isEnabled()) {
    const noop = () => {};
    return { marks: [], mark: noop, end: noop };
  }
  const started = performance.now();
  const marks: Array<{ label: string; at: number }> = [];
  const mark = (label: string) => marks.push({ label, at: performance.now() });
  const end = (label = "local library scan") => {
    let previous = started;
    const lines = marks.map((entry) => {
      const delta = entry.at - previous;
      previous = entry.at;
      return `${entry.label}: ${delta.toFixed(0)}ms`;
    });
    lines.push(`total: ${(performance.now() - started).toFixed(0)}ms`);
    console.info(`[volta] ${label} — ${lines.join(" | ")}`);
  };
  return { marks, mark, end };
};
