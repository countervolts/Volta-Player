import { useEffect, useRef } from "react";

/**
 * Frame-rate and frame-time overlay for the full-screen player.
 *
 * It times the gap between animation frames, which is where an expensive
 * backdrop shows up, and charts the recent frame times so a hitch is visible
 * rather than averaged away.
 *
 * Numbers are written straight to the DOM rather than held in React state: a
 * component whose job is to measure frame pacing should not be re-rendering
 * while it does so.
 */

/** Frame times kept in the rolling window, one bar per sample. */
const WINDOW_SIZE = 120;
const CHART_WIDTH = 240;
const CHART_HEIGHT = 56;
/** How often the readout and the chart are redrawn, in ms. */
const REFRESH_MS = 100;
/**
 * Interval assumed before the real one has been measured.
 *
 * Animation frames are delivered on the display's refresh, so the budget a frame
 * is allowed is the refresh interval, not a fixed 60th of a second. On a
 * high-refresh display a frame can miss its slot while still looking fast
 * against 16.7ms, so once there is enough data the chart is scaled to what was
 * actually measured.
 */
const FALLBACK_INTERVAL_MS = 1000 / 60;
/** A frame taking this long relative to the interval has missed a slot. */
const SLOW_FACTOR = 1.5;
/** Gaps longer than this are a backgrounded tab, not a dropped frame. */
const SUSPEND_MS = 1000;
/** Samples needed before the refresh interval is estimated from the data. */
const MIN_SAMPLES_FOR_ESTIMATE = 12;

/** Kept high-contrast: this is read while the backdrop moves behind it. */
const CHART_OK = "#7ee787";
const CHART_SLOW = "#ff7b72";
const CHART_BUDGET = "#ffffff40";
const CHART_AXIS = "#ffffff1a";

/**
 * Shown while the page is not visible.
 *
 * A hidden tab has its animation frames throttled, so the numbers would read as
 * a stalled page while the monitor itself is the thing that was starved. Saying
 * so is better than reporting a frame rate that was never about the backdrop.
 */
const PAUSED_TEXT = "paused (hidden)";

/**
 * Estimate the refresh interval from the frame times.
 *
 * The most common gap is one refresh, since a page that is keeping up spends
 * most of its frames taking exactly that long. Gaps are bucketed because a
 * browser may round animation timestamps to whole milliseconds, which makes an
 * exact comparison useless: 240Hz is 4.17ms and arrives as "4".
 */
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
  // If no single gap dominates, the page is too erratic to call it a refresh.
  if (!best || best.count < filled * 0.1) return null;
  const interval = best.total / best.count;
  let late = 0;
  for (let index = 0; index < filled; index += 1)
    if (samples[index] > interval * SLOW_FACTOR) late += 1;
  return { interval, onTime: 1 - late / filled };
}

export function FrameMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLElement>(null);
  const statsRef = useRef<HTMLElement>(null);
  const pacingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fpsNode = fpsRef.current;
    const statsNode = statsRef.current;
    if (!canvas || !fpsNode || !statsNode) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Draw at device resolution so the chart is not soft on a retina display.
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
    // Frame times are only counted while the page is visible, so a hidden
    // window cannot contribute the throttled gaps it was given.
    let visible = !document.hidden;
    let seen = 0;
    let interval = FALLBACK_INTERVAL_MS;

    const draw = (scale: number) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);
      const barWidth = CHART_WIDTH / WINDOW_SIZE;
      const slow = interval * SLOW_FACTOR;
      // The window is a ring, so the oldest sample sits at the write cursor.
      for (let index = 0; index < filled; index += 1) {
        const sample =
          samples[(write - filled + index + WINDOW_SIZE) % WINDOW_SIZE];
        const height = Math.max(1, Math.min(1, sample / scale) * CHART_HEIGHT);
        context.fillStyle = sample > slow ? CHART_SLOW : CHART_OK;
        context.fillRect(
          index * barWidth,
          CHART_HEIGHT - height,
          Math.max(1, barWidth - 0.5),
          height,
        );
      }
      // The budget line is drawn over the bars, so a frame reads against the
      // slot it was allowed rather than only against its neighbours.
      const budget =
        CHART_HEIGHT - Math.min(1, interval / scale) * CHART_HEIGHT;
      context.fillStyle = CHART_BUDGET;
      context.fillRect(0, budget, CHART_WIDTH, 1);
      context.fillStyle = CHART_AXIS;
      context.fillRect(0, CHART_HEIGHT - 1, CHART_WIDTH, 1);
    };

    const report = () => {
      const pacingNode = pacingRef.current;
      if (document.hidden) {
        fpsNode.textContent = "--";
        statsNode.textContent = PAUSED_TEXT;
        if (pacingNode) pacingNode.textContent = "";
        return;
      }
      // Nothing has been seen yet since the last report, which on a very slow
      // page is a result in itself rather than a reason to draw nothing.
      if (!seen) {
        fpsNode.textContent = "0 fps";
        statsNode.textContent = `no frames in ${REFRESH_MS} ms`;
        return;
      }
      seen = 0;
      if (!filled) return;
      let total = 0;
      let worst = 0;
      for (let index = 0; index < filled; index += 1) {
        const sample = samples[index];
        total += sample;
        if (sample > worst) worst = sample;
        ranked[index] = sample;
      }
      const mean = total / filled;
      // A "1% low" over a two-second window would be a single frame, so it is
      // taken from the slowest few frames instead.
      const slow = Math.max(1, Math.round(filled * 0.05));
      ranked.subarray(0, filled).sort();
      const low = ranked[filled - slow];
      fpsNode.textContent = `${Math.round(1000 / mean)} fps`;
      statsNode.textContent =
        `${mean.toFixed(1)} ms avg · ${Math.round(worst)} ms max · ` +
        `5% low ${Math.round(1000 / Math.max(low, 0.01))} fps`;
      const estimate = estimateInterval(samples, filled);
      if (estimate) interval = estimate.interval;
      if (pacingNode) {
        pacingNode.textContent = estimate
          ? `≈ ${Math.round(1000 / estimate.interval)} Hz · ` +
            `${Math.round(estimate.onTime * 100)}% on time`
          : "measuring ceiling…";
      }
      // Always leave the budget line on the chart, and keep it off the top edge
      // when every frame is slow.
      draw(Math.max(worst, interval * 2));
    };

    const onVisibility = () => {
      visible = !document.hidden;
      // Start a fresh interval, or the gap spent hidden would be counted.
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
      if (now - refreshed < REFRESH_MS) return;
      refreshed = now;
      report();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="frame-monitor" data-testid="frame-monitor" aria-hidden="true">
      <div className="frame-monitor-readout">
        {/* Filled in from the animation loop, so they start as a placeholder. */}
        <b ref={fpsRef}>-- fps</b>
        <span ref={statsRef}>measuring…</span>
      </div>
      <span className="frame-monitor-pacing" ref={pacingRef}>
        measuring ceiling…
      </span>
      <canvas
        className="frame-monitor-chart"
        ref={canvasRef}
        style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}
      />
    </div>
  );
}
