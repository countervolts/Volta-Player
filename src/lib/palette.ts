import { canvasReadbackUnreliable } from "./canvas-readback";

export type ArtworkPalette = {
  /** Dominant, most saturated color. Drives the primary glow. */
  primary: string;
  /** A contrasting hue for the secondary glow. */
  secondary: string;
  /** A deep, desaturated tone used to anchor the base gradient. */
  deep: string;
  /** Average luminance of the artwork, 0 (black) to 1 (white). */
  luminance: number;
  /**
   * Six vivid, visually distinct dominant colors. Our full-screen
   * background is a mesh gradient driven by a set of dominant artwork colors
   * rather than a blurred copy of the cover, so these feed the animated mesh.
   */
  colors: string[];
};

const paletteCache = new Map<string, ArtworkPalette>();
const palettePending = new Map<string, Promise<ArtworkPalette>>();
const MAX_PALETTE_ENTRIES = 48;

const SAMPLE_SIZE = 32;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHex(r: number, g: number, b: number) {
  const channel = (value: number) =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { h: (hue / 6) * 360, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return {
    r: channel(hue + 1 / 3) * 255,
    g: channel(hue) * 255,
    b: channel(hue - 1 / 3) * 255,
  };
}

function shiftHue(hex: string, degrees: number, saturationBoost = 0) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const next = hslToRgb(
    h + degrees,
    clamp(s + saturationBoost, 0, 1),
    l,
  );
  return toHex(next.r, next.g, next.b);
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const int = Number.parseInt(full, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function hexToHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

function hueDistance(a: string, b: string) {
  const distance = Math.abs(hexToHsl(a).h - hexToHsl(b).h);
  return Math.min(distance, 360 - distance);
}

function mix(hex: string, target: string, amount: number) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return toHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

/**
 * Neutral fallback used when artwork cannot be sampled at all (for example a
 * self-hosted server that does not send CORS headers on its cover endpoint).
 * It is deliberately desaturated: a rainbow fallback reads as "random colours"
 * and is worse than an understated dark gradient.
 */
function fallbackPalette(luminance = 0.2): ArtworkPalette {
  const base = clamp(luminance, 0.08, 0.6);
  const tone = (shiftHueValue: number, lightness: number) =>
    toHex(
      ...(Object.values(
        hslToRgb(240 + shiftHueValue, 0.18, lightness),
      ) as [number, number, number]),
    );
  return {
    primary: tone(0, base + 0.22),
    secondary: tone(28, base + 0.3),
    deep: toHex(0, 0, 0),
    luminance: base,
    colors: [
      tone(0, base + 0.22),
      tone(28, base + 0.3),
      tone(-28, base + 0.18),
      tone(14, base + 0.34),
      tone(-14, base + 0.26),
      tone(42, base + 0.2),
    ],
  };
}

type Lab = { l: number; a: number; b: number };

function rgbToLab(r: number, g: number, b: number): Lab {
  // sRGB -> linear -> XYZ (D65) -> CIELAB. Perceptual distance keeps clusters
  // from collapsing into near-identical neighbors.
  const lin = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function labDistance(a: Lab, b: Lab) {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

/**
 * Nudge a sampled color toward a usable mesh tone.
 *
 * Hue and saturation are preserved, never invented. Forcing a minimum
 * saturation makes neutral regions (a white shirt, dark hair, grey shadows)
 * take on whatever arbitrary hue their compression noise happened to carry,
 * which produces colors that do not exist in the artwork.
 */
function vivify(r: number, g: number, b: number, saturation: number, lightness: number) {
  const { h, s, l } = rgbToHsl(r, g, b);
  const next = hslToRgb(
    h,
    clamp(s * saturation, 0, 1),
    clamp(l * lightness, 0.16, 0.7),
  );
  return { r: next.r, g: next.g, b: next.b };
}

const KMEANS_CLUSTERS = 7;
const KMEANS_ITERATIONS = 12;

function kmeansColors(pixels: Uint8ClampedArray) {
  const samples: { r: number; g: number; b: number; lab: Lab }[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    samples.push({ r, g, b, lab: rgbToLab(r, g, b) });
  }
  if (samples.length < KMEANS_CLUSTERS) return [];

  // Seed deterministically across the sample space for stable palettes.
  let centers: Lab[] = Array.from({ length: KMEANS_CLUSTERS }, (_, index) => {
    const sample = samples[Math.floor((index + 0.5) * samples.length / KMEANS_CLUSTERS)];
    return { ...sample.lab };
  });

  const assignments = new Array(samples.length).fill(0);
  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let i = 0; i < samples.length; i += 1) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const distance = labDistance(samples[i].lab, centers[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, count: 0, r: 0, g: 0, b2: 0 }));
    for (let i = 0; i < samples.length; i += 1) {
      const cluster = sums[assignments[i]];
      cluster.l += samples[i].lab.l;
      cluster.a += samples[i].lab.a;
      cluster.b += samples[i].lab.b;
      cluster.r += samples[i].r;
      cluster.g += samples[i].g;
      cluster.b2 += samples[i].b;
      cluster.count += 1;
    }
    centers = centers.map((center, index) => {
      const cluster = sums[index];
      if (!cluster.count) return center;
      return {
        l: cluster.l / cluster.count,
        a: cluster.a / cluster.count,
        b: cluster.b / cluster.count,
      };
    });
    if (!moved) break;
  }

  return centers.map((_, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (assignments[i] !== index) continue;
      r += samples[i].r;
      g += samples[i].g;
      b += samples[i].b;
      count += 1;
    }
    return {
      count,
      r: count ? r / count : 0,
      g: count ? g / count : 0,
      b: count ? b / count : 0,
    };
  }).filter((cluster) => cluster.count > 0);
}

function buildPalette(pixels: Uint8ClampedArray): ArtworkPalette {
  let totalLuminance = 0;
  let samples = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    totalLuminance += rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]).l;
    samples += 1;
  }
  const luminance = samples ? totalLuminance / samples : 0.2;

  const clusters = kmeansColors(pixels);
  if (!clusters.length) return { ...fallbackPalette(), luminance };

  const described = clusters.map((cluster) => {
    const hsl = rgbToHsl(cluster.r, cluster.g, cluster.b);
    const lab = rgbToLab(cluster.r, cluster.g, cluster.b);
    return {
      ...cluster,
      hsl,
      lab,
      // Perceptual chroma. HSL saturation is unreliable on near-white pixels:
      // a white shirt can report saturation 0.27 with a blue hue, which is how
      // a red cover ends up with a stray blue in its palette.
      chroma: Math.hypot(lab.a, lab.b),
      hex: toHex(cluster.r, cluster.g, cluster.b),
    };
  });

  // Only genuinely colored regions may define the hue. Below this chroma a
  // color reads as neutral (white, black, grey) no matter what HSL says.
  const CHROMA_MIN = 10;
  const chromatic = described
    .filter((entry) => entry.chroma >= CHROMA_MIN)
    .sort((a, b) => b.count - a.count);
  const neutral = [...described].sort((a, b) => b.count - a.count);

  if (!chromatic.length) {
    // Truly monochrome artwork (for example a black-and-white cover) reads
    // here as a near-black backdrop with only subtle tonal variation, so the
    // greys are scaled well down rather than spanning the full range.
    const darkest = neutral[neutral.length - 1];
    const grey = (l: number) => {
      const rgb = hslToRgb(0, 0, clamp(l, 0.02, 0.5));
      return toHex(rgb.r, rgb.g, rgb.b);
    };
    const level = clamp((neutral[0]?.hsl.l ?? 0.5) * 0.34, 0.08, 0.3);
    const colors = [
      grey(level),
      grey(level * 1.5),
      grey(level * 0.6),
      grey(level * 1.9),
      grey(0.03),
      grey(level * 1.15),
    ];
    return {
      primary: colors[0],
      secondary: colors[1],
      deep: grey((darkest?.hsl.l ?? 0.1) * 0.25),
      luminance,
      colors,
    };
  }

  // Coverage-weighted circular mean hue of the colored regions. A weighted mean
  // represents the cover as a whole; picking a single cluster lets one shadow
  // or highlight hijack the entire background.
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;
  let weightedSaturation = 0;
  let colorCount = 0;
  for (const entry of chromatic) {
    // Weight by coverage and how strongly colored the region is.
    const w = entry.count * entry.chroma;
    const radians = (entry.hsl.h * Math.PI) / 180;
    sumX += Math.cos(radians) * w;
    sumY += Math.sin(radians) * w;
    totalWeight += w;
    weightedSaturation += entry.hsl.s * entry.count;
    colorCount += entry.count;
  }
  const dominantHue =
    ((Math.atan2(sumY / totalWeight, sumX / totalWeight) * 180) / Math.PI + 360) %
    360;
  const averageSaturation = weightedSaturation / Math.max(1, colorCount);

  // Build a rich but faithful set: the dominant color plus tonal variants of
  const shade = (h: number, s: number, l: number) => {
    const rgb = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0.04, 0.92));
    return toHex(rgb.r, rgb.g, rgb.b);
  };
  const dh = dominantHue;
  // Full-screen background is markedly darker and calmer than the
  // artwork itself: the cover stays the brightest object on screen and the
  // backdrop reads as a deep tint of it. Saturation is kept close to the
  // artwork's own so a brown album does not become neon orange.
  const ds = clamp(averageSaturation * 1.05, 0.2, 0.62);
  // Anchor lightness to the artwork's colored regions, then darken. Without
  // this the mesh washes out to a flat mid-tone (a black-and-white cover
  // becomes a light grey screen instead of a near-black one).
  const averageLightness =
    chromatic.reduce((sum, entry) => sum + entry.hsl.l * entry.count, 0) /
    Math.max(1, chromatic.reduce((sum, entry) => sum + entry.count, 0));
  const dl = clamp(averageLightness * 0.62, 0.12, 0.34);

  const colors: string[] = [];
  const push = (hex: string) => {
    if (colors.length < 6 && !colors.includes(hex)) colors.push(hex);
  };

  // Dominant, dark enough that white text and the artwork both stay legible.
  push(shade(dh, ds, dl));
  // A brighter relative and a deeper one give the mesh its depth.
  push(shade(dh, ds, clamp(dl * 1.5 + 0.08, 0.24, 0.5)));
  push(shade(dh, ds * 0.95, clamp(dl * 0.45, 0.08, 0.2)));
  // A second hue only when a colored region genuinely covers a meaningful part
  // of the cover; otherwise a shadow would tint the whole background.
  const colorTotal = chromatic.reduce((sum, entry) => sum + entry.count, 0);
  const contrast = chromatic.find((entry) => {
    const distance = Math.abs(entry.hsl.h - dh);
    return (
      Math.min(distance, 360 - distance) > 40 &&
      entry.count >= colorTotal * 0.22
    );
  });
  if (contrast) {
    push(
      shade(
        contrast.hsl.h,
        clamp(averageSaturation, 0.2, 0.55),
        clamp(contrast.hsl.l * 0.7, 0.12, 0.34),
      ),
    );
  }
  // Light and dark neutrals from the artwork anchor the mesh. Their hue is
  // irrelevant (they read as grey/white/black), so they are forced to the
  // dominant hue to avoid introducing a foreign color.
  const lightNeutral = neutral.find((entry) => entry.hsl.l > 0.6);
  const darkNeutral = neutral.find((entry) => entry.hsl.l < 0.35);
  if (lightNeutral) push(shade(dh, ds * 0.3, clamp(lightNeutral.hsl.l * 0.42, 0.24, 0.42)));
  if (darkNeutral) push(shade(dh, ds * 0.55, clamp(darkNeutral.hsl.l * 0.45, 0.04, 0.14)));
  // Backfill with more tonal variants for very muted artwork.
  const variants = [0.7, 1.25, 0.5, 1.6, 0.35];
  for (const factor of variants) {
    if (colors.length >= 6) break;
    push(shade(dh, ds, clamp(dl * factor, 0.06, 0.5)));
  }

  const primary = colors[0];
  const secondary =
    colors.find((color) => hueDistance(primary, color) > 40) ??
    colors[1] ??
    primary;
  const deep = shade(dh, ds * 0.9, clamp(dl * 0.3, 0.02, 0.1));
  return { primary, secondary, deep, luminance, colors };
}

async function decodePalette(src: string): Promise<ArtworkPalette> {
  // Firefox RFP randomises getImageData, which would yield a nonsense palette.
  // Fail fast so the caller uses the fallback palette instead.
  if (canvasReadbackUnreliable()) throw new Error("Canvas readback unavailable");
  const response = await fetch(src, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    // Use an HTMLImageElement rather than createImageBitmap: it decodes every
    // format the <img> element supports (including SVG artwork) and matches the
    // path already used for frozen artwork frames elsewhere in the app.
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Palette canvas unavailable");
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    canvas.width = canvas.height = 0;
    return buildPalette(data);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Resolve a palette for an artwork source. Successful results are cached by URL
 * and concurrent requests for the same source share one decode. Failures are
 * NOT cached: a transient error (rate limit, offline) must not permanently pin
 * the background to the fallback palette.
 */
export function loadArtworkPalette(src?: string): Promise<ArtworkPalette> {
  if (!src) return Promise.resolve(fallbackPalette());
  const cached = paletteCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = palettePending.get(src);
  if (pending) return pending;
  const request = decodePalette(src)
    .then((palette) => {
      if (paletteCache.size >= MAX_PALETTE_ENTRIES) {
        const oldest = paletteCache.keys().next().value;
        if (oldest) paletteCache.delete(oldest);
      }
      paletteCache.set(src, palette);
      return palette;
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn("Artwork palette extraction failed", src, error);
      }
      return fallbackPalette();
    })
    .finally(() => palettePending.delete(src));
  palettePending.set(src, request);
  return request;
}

/** Derive a secondary hue when the artwork is nearly monochrome. */
export function accentFromPalette(palette: ArtworkPalette) {
  if (hueDistance(palette.primary, palette.secondary) < 25) {
    return shiftHue(palette.primary, 150, 0.1);
  }
  return palette.secondary;
}
