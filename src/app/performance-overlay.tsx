import { useEffect, useRef } from "react";

const WINDOW_SIZE = 120;
const CHART_WIDTH = 316;
const CHART_HEIGHT = 60;
const REFRESH_MS = 500;
const FALLBACK_INTERVAL_MS = 1000 / 60;
const SLOW_FACTOR = 1.5;
const SUSPEND_MS = 1000;
const MIN_SAMPLES_FOR_ESTIMATE = 12;

type MetricNodes = Record<string, HTMLElement | null>;

type ExtendedPerformance = Performance & {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
};

type NetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type StorageEstimate = {
  usage?: number;
  quota?: number;
};

function formatBytes(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes)) return "not reported";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(value: number | undefined, digits = 0) {
  return Number.isFinite(value)
    ? `${Number(value).toFixed(digits)} ms`
    : "not recorded";
}

function median(samples: number[]) {
  if (!samples.length) return undefined;
  const ranked = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(ranked.length / 2);
  return ranked.length % 2
    ? ranked[middle]
    : (ranked[middle - 1] + ranked[middle]) / 2;
}

function formatRate(bytesPerSecond: number | undefined) {
  if (
    bytesPerSecond === undefined ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond < 1
  )
    return "not enough timed assets";
  if (bytesPerSecond < 1024 * 1024)
    return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function estimateInterval(samples: Float32Array, filled: number) {
  if (filled < MIN_SAMPLES_FOR_ESTIMATE) return null;
  const buckets = new Map<number, { count: number; total: number }>();
  for (let index = 0; index < filled; index += 1) {
    const gap = samples[index];
    const key = Math.round(gap * 2) / 2;
    const bucket = buckets.get(key) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += gap;
    buckets.set(key, bucket);
  }
  let best: { key: number; count: number; total: number } | null = null;
  for (const [key, bucket] of buckets) {
    if (
      !best ||
      bucket.count > best.count ||
      (bucket.count === best.count && key < best.key)
    )
      best = { key, count: bucket.count, total: bucket.total };
  }
  if (!best || best.count < filled * 0.1) return null;
  const interval = best.total / best.count;
  let late = 0;
  for (let index = 0; index < filled; index += 1)
    if (samples[index] > interval * SLOW_FACTOR) late += 1;
  return { interval, onTime: 1 - late / filled };
}

export function PerformanceOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const nodes: MetricNodes = {};
    root.querySelectorAll<HTMLElement>("[data-metric]").forEach((node) => {
      nodes[node.dataset.metric || ""] = node;
    });
    const set = (metric: string, value: string) => {
      const node = nodes[metric];
      if (node) node.textContent = value;
    };

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CHART_WIDTH * ratio;
    canvas.height = CHART_HEIGHT * ratio;
    const samples = new Float32Array(WINDOW_SIZE);
    const ranked = new Float32Array(WINDOW_SIZE);
    let write = 0;
    let filled = 0;
    let last = -1;
    let refreshed = 0;
    let frame = 0;
    let visible = !document.hidden;
    let seen = 0;
    let longTasks = 0;
    let longestTask = 0;
    let interval = FALLBACK_INTERVAL_MS;
    let measuredPageMemory: number | undefined;
    let measuringPageMemory = false;
    let storage: StorageEstimate | undefined;
    let measuringStorage = false;
    let errors = 0;
    let lastError = "none";

    const observer =
      "PerformanceObserver" in window
        ? new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
              longTasks += 1;
              longestTask = Math.max(longestTask, entry.duration);
            });
          })
        : null;
    try {
      observer?.observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task timing is not supported in every browser.
    }

    const onError = (event: ErrorEvent) => {
      errors += 1;
      lastError = (event.message || "Unhandled error").slice(0, 72);
    };
    const onRejection = () => {
      errors += 1;
      lastError = "Unhandled promise rejection";
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    const draw = (scale: number) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);
      const barWidth = CHART_WIDTH / WINDOW_SIZE;
      const slow = interval * SLOW_FACTOR;
      for (let index = 0; index < filled; index += 1) {
        const sample = samples[(write - filled + index + WINDOW_SIZE) % WINDOW_SIZE];
        const height = Math.max(1, Math.min(1, sample / scale) * CHART_HEIGHT);
        context.fillStyle = sample > slow ? "#ff7b72" : "#7ee787";
        context.fillRect(
          index * barWidth,
          CHART_HEIGHT - height,
          Math.max(1, barWidth - 0.5),
          height,
        );
      }
      context.fillStyle = "#ffffff40";
      context.fillRect(
        0,
        CHART_HEIGHT - Math.min(1, interval / scale) * CHART_HEIGHT,
        CHART_WIDTH,
        1,
      );
    };

    const report = () => {
      if (document.hidden) {
        set("status", "paused · tab hidden");
        return;
      }
      const performanceApi = performance as ExtendedPerformance;
      const network = (navigator as Navigator & { connection?: NetworkInformation })
        .connection;
      const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const resources = performance.getEntriesByType("resource");
      const transferred = resources.reduce(
        (total, entry) => {
          const resource = entry as PerformanceResourceTiming;
          return total + (resource.transferSize || resource.encodedBodySize || resource.decodedBodySize || 0);
        },
        0,
      );
      const decodedAssets = resources.reduce(
        (total, entry) =>
          total + ((entry as PerformanceResourceTiming).decodedBodySize || 0),
        0,
      );
      const resourceTiming = resources.map(
        (entry) => entry as PerformanceResourceTiming,
      );
      const resourceTtfb = median(
        resourceTiming
          .map((entry) => entry.responseStart - entry.requestStart)
          .filter((value) => value > 0),
      );
      const resourceRate = median(
        resourceTiming
          .map((entry) => {
            const bytes =
              entry.transferSize || entry.encodedBodySize || entry.decodedBodySize;
            return entry.duration > 0 && bytes > 0
              ? bytes / (entry.duration / 1000)
              : 0;
          })
          .filter(Boolean),
      );
      const estimate = estimateInterval(samples, filled);
      const paints = performance.getEntriesByType("paint") as PerformanceEntry[];
      const firstContentfulPaint = paints.find(
        (entry) => entry.name === "first-contentful-paint",
      );
      const resourceTypes = new Map<string, number>();
      for (const entry of resources) {
        const type = (entry as PerformanceResourceTiming).initiatorType || "other";
        resourceTypes.set(type, (resourceTypes.get(type) || 0) + 1);
      }
      const assetMix = ["script", "link", "img", "audio", "video", "fetch", "xmlhttprequest"]
        .map((type) => (resourceTypes.get(type) ? `${type} ${resourceTypes.get(type)}` : ""))
        .filter(Boolean)
        .join(" · ");
      if (estimate) interval = estimate.interval;

      if (seen && filled) {
        seen = 0;
        let total = 0;
        let worst = 0;
        for (let index = 0; index < filled; index += 1) {
          total += samples[index];
          worst = Math.max(worst, samples[index]);
          ranked[index] = samples[index];
        }
        const average = total / filled;
        ranked.subarray(0, filled).sort();
        const low = ranked[filled - Math.max(1, Math.round(filled * 0.05))];
        set("fps", `${Math.round(1000 / average)} fps`);
        set("frame-average", formatMs(average, 1));
        set("frame-p95", formatMs(ranked[Math.min(filled - 1, Math.floor(filled * 0.95))], 1));
        set("frame-worst", formatMs(worst));
        set("fps-low", `${Math.round(1000 / Math.max(low, 0.01))} fps`);
        set("frame-budget", `${Math.round((estimate?.onTime ?? 0) * 100)}% on time`);
        set("refresh", estimate ? `${Math.round(1000 / estimate.interval)} Hz` : "measuring…");
        draw(Math.max(worst, interval * 2));
      }

      set("status", visible ? "live · 500 ms sample" : "paused · tab hidden");
      set("route", `${location.pathname || "/"}${location.search}`);
      set("uptime", formatMs(performance.now()));
      set("long-tasks", observer ? String(longTasks) : "not supported");
      set("longest-task", observer ? formatMs(longestTask) : "not supported");
      set("errors", String(errors));
      set("last-error", lastError);
      if (performanceApi.memory) {
        set("heap", `${formatBytes(performanceApi.memory.usedJSHeapSize)} / ${formatBytes(performanceApi.memory.jsHeapSizeLimit)}`);
      } else if (measuredPageMemory !== undefined) {
        set("heap", `${formatBytes(measuredPageMemory)} page memory`);
      } else {
        set("heap", "browser blocks heap inspection");
      }
      set("asset-footprint", `${formatBytes(decodedAssets)} decoded assets`);
      if (performanceApi.measureUserAgentSpecificMemory && !measuringPageMemory) {
        measuringPageMemory = true;
        void performanceApi.measureUserAgentSpecificMemory()
          .then((result) => {
            measuredPageMemory = result.bytes;
          })
          .catch(() => undefined)
          .finally(() => {
            measuringPageMemory = false;
          });
      }
      if (navigator.storage?.estimate && !measuringStorage) {
        measuringStorage = true;
        void navigator.storage
          .estimate()
          .then((estimate) => {
            storage = estimate;
          })
          .catch(() => undefined)
          .finally(() => {
            measuringStorage = false;
          });
      }
      set(
        "storage",
        storage
          ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
          : "measuring…",
      );
      set("dom", document.getElementsByTagName("*").length.toLocaleString());
      const images = Array.from(document.images);
      set(
        "images",
        `${images.filter((image) => image.complete).length} / ${images.length} decoded`,
      );
      set("resources", `${resources.length} · ${formatBytes(transferred)}`);
      set("asset-mix", assetMix || "no resource timings");
      set("ttfb", navigation ? formatMs(navigation.responseStart - navigation.requestStart) : "N/A");
      set("fcp", firstContentfulPaint ? formatMs(firstContentfulPaint.startTime) : "N/A");
      set("dcl", navigation ? formatMs(navigation.domContentLoadedEventEnd) : "N/A");
      set("navigation", navigation ? formatMs(navigation.loadEventEnd) : "N/A");
      set(
        "connection",
        network?.effectiveType?.toUpperCase() || "browser does not report class",
      );
      set(
        "network",
        network
          ? `${network.downlink ?? "?"} Mbps · ${network.rtt ?? "?"} ms RTT`
          : `${formatRate(resourceRate)} · ${formatMs(resourceTtfb)} median TTFB`,
      );
      set("online", navigator.onLine ? "online" : "offline");
      set(
        "saver",
        network?.saveData === undefined
          ? "browser does not report"
          : network.saveData
            ? "on"
            : "off",
      );
      const deviceNavigator = navigator as Navigator & { deviceMemory?: number };
      set(
        "device",
        `${navigator.hardwareConcurrency || "?"} threads · ${deviceNavigator.deviceMemory === undefined ? "memory not reported" : `${deviceNavigator.deviceMemory} GB`}`,
      );
      set("viewport", `${window.innerWidth}×${window.innerHeight} · ${window.devicePixelRatio || 1}x`);
    };

    const onVisibility = () => {
      visible = !document.hidden;
      last = -1;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (visible && last >= 0) {
        const delta = now - last;
        if (delta > 0 && delta < SUSPEND_MS) {
          samples[write] = delta;
          write = (write + 1) % WINDOW_SIZE;
          if (filled < WINDOW_SIZE) filled += 1;
          seen += 1;
        }
      }
      last = visible ? now : -1;
      if (now - refreshed >= REFRESH_MS) {
        refreshed = now;
        report();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <aside className="performance-overlay" data-testid="performance-overlay" ref={rootRef} aria-label="Performance diagnostics">
      <header className="performance-overlay-header">
        <div className="performance-overlay-title">
          <i aria-hidden="true" />
          <div>
            <strong>Performance inspector</strong>
            <span>Beta diagnostics</span>
          </div>
        </div>
        <span className="performance-overlay-status" data-metric="status">starting…</span>
      </header>
      <div className="performance-overlay-body">
        <section className="performance-overlay-section performance-overlay-rendering">
          <h2>Frame delivery</h2>
          <div className="performance-overlay-grid performance-overlay-key-grid">
            <Metric label="FPS" metric="fps" />
            <Metric label="On budget" metric="frame-budget" />
            <Metric label="5% low" metric="fps-low" />
            <Metric label="Refresh" metric="refresh" />
          </div>
          <canvas className="performance-overlay-chart" ref={canvasRef} style={{ width: CHART_WIDTH, height: CHART_HEIGHT }} />
          <div className="performance-overlay-grid">
            <Metric label="Frame average" metric="frame-average" />
            <Metric label="Frame p95" metric="frame-p95" />
            <Metric label="Worst frame" metric="frame-worst" />
          </div>
        </section>
        <section className="performance-overlay-section">
          <h2>Page</h2>
          <div className="performance-overlay-list">
            <Metric label="Route" metric="route" />
            <Metric label="Session uptime" metric="uptime" />
            <Metric label="TTFB" metric="ttfb" />
            <Metric label="First contentful paint" metric="fcp" />
            <Metric label="DOM ready" metric="dcl" />
            <Metric label="Load event" metric="navigation" />
          </div>
        </section>
        <section className="performance-overlay-section">
          <h2>Runtime</h2>
          <div className="performance-overlay-list">
            <Metric label="JS heap" metric="heap" />
            <Metric label="Decoded asset footprint" metric="asset-footprint" />
            <Metric label="Site storage" metric="storage" />
            <Metric label="DOM nodes" metric="dom" />
            <Metric label="Images" metric="images" />
            <Metric label="Long tasks" metric="long-tasks" />
            <Metric label="Longest task" metric="longest-task" />
            <Metric label="Errors since open" metric="errors" />
            <Metric label="Last error" metric="last-error" />
          </div>
        </section>
        <section className="performance-overlay-section">
          <h2>Network and assets</h2>
          <div className="performance-overlay-list">
            <Metric label="Online" metric="online" />
            <Metric label="Connection" metric="connection" />
            <Metric label="Throughput / RTT" metric="network" />
            <Metric label="Data saver" metric="saver" />
            <Metric label="Resources" metric="resources" />
            <Metric label="Asset mix" metric="asset-mix" />
          </div>
        </section>
        <section className="performance-overlay-section">
          <h2>Environment</h2>
          <div className="performance-overlay-list">
            <Metric label="Device hint" metric="device" />
            <Metric label="Viewport" metric="viewport" />
          </div>
        </section>
      </div>
    </aside>
  );
}

function Metric({ label, metric }: { label: string; metric: string }) {
  return (
    <div className="performance-overlay-metric">
      <span>{label}</span>
      <b data-metric={metric}>—</b>
    </div>
  );
}
