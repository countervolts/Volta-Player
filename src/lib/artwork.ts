/**
 * Frozen frames for animated artwork.
 *
 * An animated cover (GIF/APNG/animated WebP) that must not animate is frozen by
 * decoding one frame and painting it into a canvas that is then *displayed*.
 * Pixels are never read or exported back out of that canvas: Firefox's
 * `privacy.resistFingerprinting` randomises canvas readback (`getImageData`,
 * `toDataURL`, `toBlob`, `convertToBlob`, `readPixels`), so a frame captured
 * that way would display as noise. Canvas *rendering* is untouched by RFP, so a
 * displayed canvas is a faithful frame and needs no permission, no user gesture
 * and no detection of the privacy setting.
 *
 * This module therefore contains no canvas export/readback call and no
 * browser/fingerprinting detection of any kind. The invariant is that artwork
 * shown to the user never depends on reading pixels back out of a canvas.
 */

/** Containers that are *capable* of animation. PNG/JPEG cannot animate. */
const ANIMATED_CONTAINER_TYPE = /image\/(gif|apng|webp)/i;
/** Enough of the header to reach the animation marker in WebP and PNG. */
const HEADER_BYTES = 4096;
/**
 * Firefox has no `ImageDecoder`, so the fallback frame comes from an animated
 * `<img>`. Waiting briefly lets it advance past the first frame, which is what
 * the frozen still is supposed to capture.
 */
const FRAME_ADVANCE_MS = 100;
/** Longest edge of a frozen frame. Covers are downscaled to this at most. */
const MAX_STILL_EDGE = 480;

type Decoder = {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
  decode(options: { frameIndex: number }): Promise<{
    image: CanvasImageSource & { close?: () => void; displayWidth: number; displayHeight: number };
  }>;
  close: () => void;
};

type DecodedFrame = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

/* -------------------------------------------------------------------------- */
/* Animation detection                                                        */
/* -------------------------------------------------------------------------- */

const animationCache = new WeakMap<Blob, Promise<boolean>>();

/**
 * Walk RIFF-style chunks (`tag`, then payload) and report which tags were seen.
 * Used for both WebP (`RIFF….WEBP`) and PNG, which share the layout of a
 * 4-byte tag followed by a length-prefixed payload.
 */
function scanChunks(
  bytes: Uint8Array,
  offset: number,
  tags: readonly string[],
): { seen: string | undefined; complete: boolean } {
  let at = offset;
  while (at + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const length =
      bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
    if (tags.includes(tag)) return { seen: tag, complete: true };
    if (length < 0) break;
    // WebP is a RIFF container: the next tag is 8 bytes of header plus the
    // payload padded to an even boundary. PNG chunks carry a CRC after the
    // payload, so the next tag starts 4 bytes later.
    const advance = offset === 12 ? 8 + length + (length & 1) : 12 + length;
    if (advance <= 8) break;
    at += advance;
  }
  // Running past the window is not "no animation", it is "unknown".
  return { seen: undefined, complete: false };
}

/**
 * Whether a blob is genuinely animated, decided from the container bytes.
 *
 * Cheap and exact where it can be: an `ANIM` chunk in WebP and an `acTL` chunk
 * in PNG are what make those containers animate, and both sit in the header.
 * GIF is treated as animated without inspection — a single-frame GIF frozen
 * into a canvas is pixel-identical, so the only cost of that assumption is a
 * canvas where an `<img>` would also have done.
 *
 * Unknown outcomes resolve to `true`: freezing a static image is visually
 * identical, whereas leaving an animated one live in a grid would not be.
 */
export function artworkIsAnimated(blob: Blob): Promise<boolean> {
  const cached = animationCache.get(blob);
  if (cached) return cached;
  const decision = (async () => {
    // PNG, JPEG, AVIF, SVG and friends cannot animate. This is exact, so the
    // common static case never pays for a decode or a byte scan.
    if (!ANIMATED_CONTAINER_TYPE.test(blob.type)) return false;
    try {
      const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
      const isPng =
        header.length > 8 &&
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47;
      if (isPng || /image\/apng/i.test(blob.type)) {
        // `acTL` must precede the first `IDAT` in an animated PNG.
        const { seen, complete } = scanChunks(header, 8, ["acTL", "IDAT"]);
        if (!complete) return true;
        return seen === "acTL";
      }
      const isWebp =
        header.length > 12 &&
        String.fromCharCode(header[0], header[1], header[2], header[3]) === "RIFF" &&
        String.fromCharCode(header[8], header[9], header[10], header[11]) === "WEBP";
      if (isWebp) {
        // `ANIM` precedes the frame data in an animated WebP; a still file
        // carries `VP8 `/`VP8L` instead.
        const { seen, complete } = scanChunks(header, 12, ["ANIM", "VP8 ", "VP8L"]);
        if (!complete) return true;
        return seen === "ANIM";
      }
    } catch {
      // A failed header read is not evidence of a still image.
      return true;
    }
    return true;
  })();
  animationCache.set(blob, decision);
  return decision;
}

/* -------------------------------------------------------------------------- */
/* Frozen-frame extraction (display-only canvas)                              */
/* -------------------------------------------------------------------------- */

async function decodeFrame(blob: Blob, objectUrl: string): Promise<DecodedFrame> {
  const decoderType = (
    window as unknown as {
      ImageDecoder?: new (options: { data: Blob; type: string }) => Decoder;
    }
  ).ImageDecoder;
  if (decoderType && ANIMATED_CONTAINER_TYPE.test(blob.type)) {
    let decoder: Decoder | undefined;
    try {
      decoder = new decoderType({ data: blob, type: blob.type });
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
      // Frame 2 when there is one, so a frozen cover is not always frame 1.
      const frameIndex = Math.min(1, Math.max(0, frameCount - 1));
      const { image } = await decoder.decode({ frameIndex });
      const live = decoder;
      return {
        source: image,
        width: image.displayWidth,
        height: image.displayHeight,
        close: () => {
          image.close?.();
          live.close();
        },
      };
    } catch {
      decoder?.close();
      // Fall through to the <img> decoder below.
    }
  }
  // `HTMLImageElement` decodes every format the element supports, including
  // SVG artwork, and matches the path used elsewhere for cover decoding.
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
  await new Promise<void>((resolve) => window.setTimeout(resolve, FRAME_ADVANCE_MS));
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => {},
  };
}

/**
 * Paint a decoded frame into a canvas sized to the frame itself.
 *
 * The bitmap is deliberately the artwork's own pixel grid: sizing it from
 * `devicePixelRatio` or the viewport would both blur the cover and let
 * fingerprintable screen values reach the image. CSS handles the on-screen size.
 */
function drawFrameToCanvas(frame: DecodedFrame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, MAX_STILL_EDGE / Math.max(frame.width, frame.height, 1));
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Artwork canvas unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // No background fill: a transparent cover must stay transparent.
  context.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const stillCanvasCache = new Map<string, HTMLCanvasElement>();
const stillCanvasPending = new Map<string, Promise<HTMLCanvasElement>>();
const MAX_STILL_CANVAS_ENTRIES = 96;

/** Drop a cached frozen frame and release its backing store immediately. */
export function discardArtworkStillCanvas(src: string) {
  const canvas = stillCanvasCache.get(src);
  if (!canvas) return;
  stillCanvasCache.delete(src);
  canvas.width = canvas.height = 0;
}

/**
 * Resolve a frozen frame for an animated cover as a canvas to display.
 *
 * Never reads or exports pixels: the returned canvas is meant to be drawn onto
 * the visible canvas, or used directly. Failures reject so callers can keep
 * showing the original artwork.
 */
export function loadArtworkStillCanvas(
  src: string,
  providedBlob?: Blob,
): Promise<HTMLCanvasElement> {
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
    let frame: DecodedFrame | undefined;
    try {
      frame = await decodeFrame(blob, objectUrl);
      if (!frame.width || !frame.height) throw new Error("Artwork frame unavailable");
      const canvas = drawFrameToCanvas(frame);
      while (stillCanvasCache.size >= MAX_STILL_CANVAS_ENTRIES) {
        const key = stillCanvasCache.keys().next().value!;
        discardArtworkStillCanvas(key);
      }
      stillCanvasCache.set(src, canvas);
      return canvas;
    } finally {
      frame?.close();
      URL.revokeObjectURL(objectUrl);
    }
  })().finally(() => stillCanvasPending.delete(src));
  stillCanvasPending.set(src, request);
  return request;
}
