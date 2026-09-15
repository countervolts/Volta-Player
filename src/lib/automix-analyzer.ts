import type { Song } from "./navidrome";
import type { TrackAnalysis } from "./audio-analysis";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
} from "./audio-analysis.worker";

/**
 * AutoMix analyser.
 *
 * Most libraries are not scanned for BPM or key, so AutoMix measures the audio
 * itself. This module owns the expensive half: fetching a size-limited track,
 * decoding it with the Web Audio API, and handing bounded PCM windows to a worker
 * that runs the FFT analysis off the main thread.
 *
 * Design constraints that shaped this:
 * - **Never block playback.** Analysis is scheduled in the background, one
 *   track at a time, and only for tracks near the playhead.
 * - **Never re-analyse.** Results are cached in memory and in `localStorage`,
 *   keyed by library and song identity, so a track is measured once per browser.
 * - **Never fail loudly.** A track that cannot be decoded simply keeps its
 *   natural-speed fallback; no tempo is invented.
 */

/** Middle window for a coarse tempo/key profile, separate from transition edges. */
const ANALYSIS_CLIP_SECONDS = 45;
/** Skip the intro, which is often a pickup or a spoken-word segment. */
const ANALYSIS_START_SECONDS = 15;
const ANALYSIS_CACHE_KEY = "volta-automix-analysis:v2";
/** Cap the persisted cache so it cannot grow without bound. */
const ANALYSIS_CACHE_LIMIT = 600;
/** Concurrent decodes. More than one competes with playback for bandwidth. */
const ANALYSIS_CONCURRENCY = 1;
const MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 30_000;
const failedUntil = new Map<string, number>();
type DecodedClip = Omit<AnalysisWorkerRequest, "id">;

type CacheEntry = TrackAnalysis & { at: number };

const memoryCache = new Map<string, TrackAnalysis>();
let persisted: Record<string, CacheEntry> | null = null;
let worker: Worker | null = null;
let workerRequestId = 0;
const pending = new Map<
  number,
  (analysis: TrackAnalysis | null) => void
>();
let active = 0;
const queue: { song: Song; url: string; key: string; resolve: () => void }[] = [];
const inFlight = new Set<string>();

function readPersisted(): Record<string, CacheEntry> {
  if (persisted) return persisted;
  persisted = {};
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return persisted;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    if (parsed && typeof parsed === "object") persisted = parsed;
  } catch {
    // A corrupt cache is not fatal; it is simply rebuilt.
    persisted = {};
  }
  return persisted;
}

function writePersisted() {
  if (!persisted) return;
  try {
    const entries = Object.entries(persisted);
    if (entries.length > ANALYSIS_CACHE_LIMIT) {
      // Drop the oldest analyses first.
      entries
        .sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0))
        .slice(0, entries.length - ANALYSIS_CACHE_LIMIT)
        .forEach(([key]) => delete persisted![key]);
    }
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(persisted));
  } catch {
    // Quota or private mode: the in-memory cache still works this session.
  }
}

/** A previously measured analysis, if one exists. */
export function cachedAnalysis(songId: string): TrackAnalysis | undefined {
  const memory = memoryCache.get(songId);
  if (memory) return memory;
  const stored = readPersisted()[songId];
  if (!stored || !Number.isFinite(stored.bpm) || stored.bpm <= 0 ||
      !Number.isFinite(stored.confidence) || !Number.isFinite(stored.energy) ||
      !Number.isFinite(stored.camelot) || stored.camelot < 1 || stored.camelot > 12 ||
      !["A", "B"].includes(stored.mode)) return undefined;
  const { at: _at, ...analysis } = stored;
  memoryCache.set(songId, analysis);
  return analysis;
}

function storeAnalysis(songId: string, analysis: TrackAnalysis) {
  memoryCache.set(songId, analysis);
  if (memoryCache.size > ANALYSIS_CACHE_LIMIT)
    memoryCache.delete(memoryCache.keys().next().value!);
  const cache = readPersisted();
  cache[songId] = { ...analysis, at: Date.now() };
  writePersisted();
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(
      new URL("./audio-analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data.analysis);
  };
  worker.onerror = () => {
    // A worker failure must not strand the queue.
    pending.forEach((resolve) => resolve(null));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Decode a bounded clip of a track into planar channel data. */
async function decodeClip(
  url: string,
  signal: AbortSignal,
): Promise<DecodedClip | null> {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;

  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) return null;
  if (Number(response.headers.get("content-length")) > MAX_ANALYSIS_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_ANALYSIS_BYTES || signal.aborted) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const encoded = new Uint8Array(bytes);
  let position = 0;
  for (const chunk of chunks) { encoded.set(chunk, position); position += chunk.byteLength; }
  const buffer = encoded.buffer;
  if (signal.aborted) return null;

  // A throwaway context: decoding does not need an output device, and creating
  // one per clip avoids holding a suspended context open for the session.
  const context = new AudioContextClass({ sampleRate: 22050 });
  try {
    const decoded = await context.decodeAudioData(buffer);
    if (signal.aborted) return null;
    const start = Math.min(
      ANALYSIS_START_SECONDS,
      Math.max(0, decoded.duration - 5),
    );
    const length = Math.min(
      ANALYSIS_CLIP_SECONDS,
      Math.max(1, decoded.duration - start),
    );
    const startSample = Math.floor(start * decoded.sampleRate);
    const sampleCount = Math.floor(length * decoded.sampleRate);
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const source = decoded.getChannelData(channel);
      // Copy out of the AudioBuffer: it is not transferable, and the worker
      // must not hold a reference to the decoded buffer.
      channels.push(
        source.slice(startSample, startSample + sampleCount) as Float32Array,
      );
    }
    const edgeFrames = Math.min(decoded.length, Math.floor(16 * decoded.sampleRate));
    const outroStart = decoded.length - edgeFrames;
    const copyRegion = (start: number) => Array.from({ length: decoded.numberOfChannels },
      (_, channel) => decoded.getChannelData(channel).slice(start, start + edgeFrames));
    return { channels, sampleRate: decoded.sampleRate,
      introChannels: copyRegion(0), outroChannels: copyRegion(outroStart),
      outroOffset: outroStart / decoded.sampleRate, duration: decoded.duration };
  } finally {
    void context.close().catch(() => undefined);
  }
}

async function runAnalysis(
  song: Song,
  url: string,
): Promise<TrackAnalysis | null> {
  if ((song.duration ?? 0) > 900 || (song.size ?? 0) > MAX_ANALYSIS_BYTES) return null;
  const controller = new AbortController();
  let requestId: number | undefined;
  let timeout: ReturnType<typeof setTimeout>;
  const work = async () => {
    try {
      const clip = await decodeClip(url, controller.signal);
      if (!clip || controller.signal.aborted) return null;
      const instance = ensureWorker();
      if (!instance) return null;
      const id = ++workerRequestId;
      requestId = id;
      return await new Promise<TrackAnalysis | null>((resolve) => {
        pending.set(id, resolve);
        instance.postMessage({ id, ...clip } satisfies AnalysisWorkerRequest,
          [...clip.channels, ...clip.introChannels, ...clip.outroChannels].map(channel => channel.buffer));
      });
    } catch { return null; }
  };
  try {
    return await Promise.race([work(), new Promise<null>(resolve => {
      timeout = setTimeout(() => {
        controller.abort();
        if (requestId !== undefined) {
          pending.get(requestId)?.(null);
          pending.delete(requestId);
          worker?.terminate();
          worker = null;
        }
        resolve(null);
      }, ANALYSIS_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timeout!); }
}

function pump() {
  while (active < ANALYSIS_CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active++;
    void runAnalysis(job.song, job.url)
      .then((analysis) => {
        if (analysis) storeAnalysis(job.key, analysis);
        else failedUntil.set(job.key, Date.now() + 5 * 60_000);
      })
      .finally(() => {
        active--;
        inFlight.delete(job.key);
        job.resolve();
        pump();
      });
  }
}

/**
 * Queue a track for background analysis.
 *
 * Returns a promise that settles when the track has been measured (or has
 * failed). Callers that only want the result should read `cachedAnalysis`
 * afterwards; the promise exists so tests and the controller can await it.
 */
export function analyzeSong(song: Song, url: string, key = song.id): Promise<void> {
  if ((failedUntil.get(key) ?? 0) > Date.now()) return Promise.resolve();
  if (cachedAnalysis(key)) return Promise.resolve();
  if (inFlight.has(key)) return Promise.resolve();
  inFlight.add(key);
  return new Promise<void>((resolve) => {
    queue.push({ song, url, key, resolve });
    pump();
  });
}

/**
 * Analyse the tracks around the playhead.
 *
 * Only a small window is measured: the current track and the next few, which
 * is all AutoMix needs to plan the transition that is actually coming up.
 */
export function analyzeUpcoming(
  songs: readonly Song[],
  currentIndex: number,
  urlFor: (song: Song) => string,
  lookahead = 2,
  keyFor: (song: Song) => string = song => song.id,
): void {
  const wanted = new Set(songs.slice(currentIndex, currentIndex + lookahead + 1).map(keyFor));
  // Rapid skipping should not queue an entire library behind the playing song.
  for (let index = queue.length - 1; index >= 0; index--) {
    if (wanted.has(queue[index].key)) continue;
    const [discarded] = queue.splice(index, 1);
    inFlight.delete(discarded.key);
    discarded.resolve();
  }
  for (
    let offset = 0;
    offset <= lookahead && currentIndex + offset < songs.length;
    offset++
  ) {
    const song = songs[currentIndex + offset];
    if (!song || song.source === "local" || song.localUrl) continue;
    if (cachedAnalysis(keyFor(song))) continue;
    void analyzeSong(song, urlFor(song), keyFor(song));
  }
}

/** Test seam: drop all cached analyses and pending work. */
export function resetAutomixAnalysis() {
  memoryCache.clear();
  failedUntil.clear();
  persisted = null;
  queue.length = 0;
  inFlight.clear();
  pending.forEach((resolve) => resolve(null));
  pending.clear();
  active = 0;
  try {
    localStorage.removeItem(ANALYSIS_CACHE_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
