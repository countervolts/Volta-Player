import { canvasReadbackUnreliable } from "./canvas-readback";

const stillCache = new Map<string, string>();
const stillPending = new Map<string, Promise<string>>();
let stillBytes = 0;
const MAX_STILL_BYTES = 4 * 1024 * 1024;

export function discardArtworkStill(src: string) {
  const cached = stillCache.get(src);
  if (!cached) return;
  stillCache.delete(src);
  stillBytes = Math.max(0, stillBytes - cached.length);
}

export function loadArtworkStill(src: string, providedBlob?: Blob): Promise<string> {
  const cached = stillCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = stillPending.get(src);
  if (pending) return pending;
  const request = (async () => {
    if (canvasReadbackUnreliable()) throw new Error("Canvas readback unavailable");
    let blob: Blob;
    if (providedBlob) blob = providedBlob;
    else {
      const response = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
      blob = await response.blob();
    }
    const objectUrl = URL.createObjectURL(blob);
    let decoder: {
      tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
      decode(options: { frameIndex: number }): Promise<{
        image: CanvasImageSource & { close?: () => void };
      }>;
      close: () => void;
    } | undefined;
    try {
      const decoderType = (window as unknown as {
        ImageDecoder?: new (options: { data: Blob; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
          decode(options: { frameIndex: number }): Promise<{
            image: CanvasImageSource & { close?: () => void };
          }>;
          close: () => void;
        };
      }).ImageDecoder;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Artwork canvas unavailable");
      let frame: CanvasImageSource & { close?: () => void };
      if (decoderType && /image\/(gif|webp|apng)/i.test(blob.type)) {
        try {
          decoder = new decoderType({ data: blob, type: blob.type });
          await decoder.tracks.ready;
          const frameIndex = Math.min(1, Math.max(0, (decoder.tracks.selectedTrack?.frameCount ?? 1) - 1));
          frame = (await decoder.decode({ frameIndex })).image;
        } catch {
          decoder?.close();
          decoder = undefined;
          frame = await decodeArtworkImage(objectUrl);
        }
      } else {
        frame = await decodeArtworkImage(objectUrl);
        // Firefox does not currently expose ImageDecoder. Give the animated
        // <img> time to advance before drawing it, so the fallback captures
        // frame 2 rather than the initial frame.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      }
      if (!frame) {
        throw new Error("Artwork frame unavailable");
      }
      const width = "displayWidth" in frame ? frame.displayWidth : (frame as HTMLImageElement).naturalWidth;
      const height = "displayHeight" in frame ? frame.displayHeight : (frame as HTMLImageElement).naturalHeight;
      const scale = Math.min(1, 480 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const still = canvas.toDataURL("image/webp", 0.88);
      canvas.width = canvas.height = 0;
      frame.close?.();
      decoder?.close();
      decoder = undefined;
      const cost = still.length;
      if (cost <= MAX_STILL_BYTES) {
        while (stillCache.size && stillBytes + cost > MAX_STILL_BYTES) {
          const key = stillCache.keys().next().value!;
          stillBytes -= stillCache.get(key)!.length;
          stillCache.delete(key);
        }
        stillCache.set(src, still);
        stillBytes += cost;
      }
      return still;
    } finally {
      decoder?.close();
      URL.revokeObjectURL(objectUrl);
    }
  })().finally(() => stillPending.delete(src));
  stillPending.set(src, request);
  return request;
}

async function decodeArtworkImage(src: string): Promise<CanvasImageSource & { close?: () => void }> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

const stillCanvasCache = new Map<string, HTMLCanvasElement>();
const stillCanvasPending = new Map<string, Promise<HTMLCanvasElement>>();
const MAX_STILL_CANVAS_ENTRIES = 96;

export function discardArtworkStillCanvas(src: string) {
  stillCanvasCache.delete(src);
}

export function loadArtworkStillCanvas(src: string, providedBlob?: Blob): Promise<HTMLCanvasElement> {
  const cached = stillCanvasCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = stillCanvasPending.get(src);
  if (pending) return pending;
  const request = (async () => {
    let blob: Blob;
    if (providedBlob) blob = providedBlob;
    else {
      const response = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
      blob = await response.blob();
    }
    const objectUrl = URL.createObjectURL(blob);
    let decoder: {
      tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
      decode(options: { frameIndex: number }): Promise<{
        image: CanvasImageSource & { close?: () => void };
      }>;
      close: () => void;
    } | undefined;
    try {
      const decoderType = (window as unknown as {
        ImageDecoder?: new (options: { data: Blob; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
          decode(options: { frameIndex: number }): Promise<{
            image: CanvasImageSource & { close?: () => void };
          }>;
          close: () => void;
        };
      }).ImageDecoder;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Artwork canvas unavailable");
      let frame: CanvasImageSource & { close?: () => void };
      if (decoderType && /image\/(gif|webp|apng)/i.test(blob.type)) {
        try {
          decoder = new decoderType({ data: blob, type: blob.type });
          await decoder.tracks.ready;
          const frameIndex = Math.min(1, Math.max(0, (decoder.tracks.selectedTrack?.frameCount ?? 1) - 1));
          frame = (await decoder.decode({ frameIndex })).image;
        } catch {
          decoder?.close();
          decoder = undefined;
          frame = await decodeArtworkImage(objectUrl);
        }
      } else {
        frame = await decodeArtworkImage(objectUrl);
      }
      if (!frame) throw new Error("Artwork frame unavailable");
      const width = "displayWidth" in frame ? frame.displayWidth : (frame as HTMLImageElement).naturalWidth;
      const height = "displayHeight" in frame ? frame.displayHeight : (frame as HTMLImageElement).naturalHeight;
      const scale = Math.min(1, 480 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close?.();
      decoder?.close();
      decoder = undefined;
      while (stillCanvasCache.size >= MAX_STILL_CANVAS_ENTRIES) {
        const key = stillCanvasCache.keys().next().value!;
        stillCanvasCache.delete(key);
      }
      stillCanvasCache.set(src, canvas);
      return canvas;
    } finally {
      decoder?.close();
      URL.revokeObjectURL(objectUrl);
    }
  })().finally(() => stillCanvasPending.delete(src));
  stillCanvasPending.set(src, request);
  return request;
}
