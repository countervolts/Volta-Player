/**
 * AutoMix audio analysis.
 *
 * Server tags are the cheapest source of tempo/key, but most libraries are not
 * scanned, so AutoMix falls back to analysing the audio itself. This module is
 * the pure DSP half: it takes mono PCM at a known sample rate and returns a
 * tempo, a musical key and an energy estimate. It has no DOM dependency, so it
 * runs in a worker and is directly unit testable with synthesised signals.
 *
 * Pipeline (the same one a DJ tool uses, at a much smaller budget):
 *  1. STFT with a Hann window over ~21 ms hops.
 *  2. Spectral flux → an onset-strength envelope.
 *  3. Normalised autocorrelation over the 60–200 BPM lag range, weighted by a
 *     log-normal tempo prior so a half/double-time peak does not win.
 *  4. Chroma accumulation from the same spectra, correlated against the
 *     Krumhansl–Schmuckler major/minor profiles for the key.
 */

export type TrackAnalysis = {
  bpm: number;
  /** Camelot wheel position 1–12. */
  camelot: number;
  mode: "A" | "B";
  /** 0–1 loudness/energy proxy derived from RMS. */
  energy: number;
  /** 0–1 confidence in the tempo/key estimate. */
  confidence: number;
  source: "analysis";
  tempoConfidence?: number;
  keyConfidence?: number;
  duration?: number;
  intro?: TransitionRegion;
  outro?: TransitionRegion;
};

export type TransitionRegion = {
  bpm: number;
  /** Absolute media time of one measured pulse, not an assumed downbeat. */
  beatOffset: number;
  confidence: number;
  energy: number;
};

export const ANALYSIS_SAMPLE_RATE = 11025;
/** Frames are 1024 samples (~93 ms) with a 256-sample hop (~23 ms). */
export const ANALYSIS_FFT_SIZE = 1024;
export const ANALYSIS_HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
const PREFERRED_BPM = 120;
/** How far an analysed tempo may be folded to reach the preferred band. */
const FOLD_LOW = 70;
const FOLD_HIGH = 180;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` must share a power-of-
 * two length. Small and dependency-free, which matters because this runs inside
 * a worker on a hot loop.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    const half = len >> 1;
    for (let start = 0; start < n; start += len) {
      let curRe = 1;
      let curIm = 0;
      for (let offset = 0; offset < half; offset++) {
        const a = start + offset;
        const b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++)
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return window;
}

/**
 * Harmonic profile weights for the key finder. Values are the classic
 * Krumhansl–Schmuckler probe-tone ratings, ordered from the tonic.
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/** Major keys on the Camelot wheel, indexed by pitch class (0 = C). */
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
/** Relative minors, same indexing. */
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/** Lowest/highest frequency folded into the chroma vector (C2–B6). */
const CHROMA_MIN_HZ = 65.4;
const CHROMA_MAX_HZ = 1975.5;

type OnsetAndChroma = {
  onset: Float32Array;
  lowOnset: Float32Array;
  chroma: Float64Array;
  frames: number;
  frameRate: number;
  /** Mean spectral energy per frame, used as a brightness/energy proxy. */
  spectralEnergy: number;
};

/**
 * One pass over the signal producing both the onset envelope (for tempo) and
 * the chroma vector (for key). Running them together avoids a second FFT pass.
 */
function onsetAndChroma(
  samples: Float32Array,
  sampleRate: number,
): OnsetAndChroma {
  const size = ANALYSIS_FFT_SIZE;
  const hop = ANALYSIS_HOP;
  const window = hannWindow(size);
  const bins = size >> 1;
  const frameCount =
    samples.length >= size ? Math.floor((samples.length - size) / hop) + 1 : 0;
  const onset = new Float32Array(Math.max(0, frameCount));
  const lowOnset = new Float32Array(Math.max(0, frameCount));
  const chroma = new Float64Array(12);
  const previous = new Float32Array(bins);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const binToPitch = new Int8Array(bins);
  for (let bin = 1; bin < bins; bin++) {
    const frequency = (bin * sampleRate) / size;
    if (frequency < CHROMA_MIN_HZ || frequency > CHROMA_MAX_HZ) {
      binToPitch[bin] = -1;
      continue;
    }
    const midi = 69 + 12 * Math.log2(frequency / 440);
    binToPitch[bin] = ((Math.round(midi) % 12) + 12) % 12;
  }

  let spectralTotal = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    for (let i = 0; i < size; i++) {
      re[i] = (samples[start + i] || 0) * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    let flux = 0;
    let lowFlux = 0;
    for (let bin = 1; bin < bins; bin++) {
      const magnitude = Math.hypot(re[bin], im[bin]);
      const delta = magnitude - previous[bin];
      if (delta > 0) flux += delta;
      if (delta > 0 && bin * sampleRate / size < 250) lowFlux += delta;
      previous[bin] = magnitude;
      const pitch = binToPitch[bin];
      if (pitch >= 0) chroma[pitch] += magnitude;
    }
    // Scale by the window's mean so the envelope is comparable across rates.
    onset[frame] = flux / bins;
    lowOnset[frame] = lowFlux / bins;
    spectralTotal += flux;
  }

  return {
    onset,
    lowOnset,
    chroma,
    frames: frameCount,
    frameRate: sampleRate / hop,
    spectralEnergy: frameCount ? spectralTotal / frameCount : 0,
  };
}

export type TempoEstimate = { bpm: number; strength: number };

/**
 * Normalise the onset envelope so autocorrelation is not dominated by a loud
 * section, then find the lag with the strongest self-similarity.
 */
export function estimateTempo(
  onset: Float32Array,
  frameRate: number,
): TempoEstimate | null {
  if (onset.length < 8) return null;
  const mean = onset.reduce((total, value) => total + value, 0) / onset.length;
  if (!Number.isFinite(mean) || mean <= 0) return null;
  const envelope = new Float32Array(onset.length);
  let variance = 0;
  for (let i = 0; i < onset.length; i++) {
    // Half-wave rectify around the local mean so only real onsets contribute.
    const value = Math.max(0, onset[i] - mean);
    envelope[i] = value;
    variance += value * value;
  }
  if (variance <= 0) return null;
  const norm = Math.sqrt(variance);
  for (let i = 0; i < envelope.length; i++) envelope[i] /= norm;

  const minLag = Math.max(2, Math.floor((60 * frameRate) / MAX_BPM));
  const maxLag = Math.min(
    envelope.length - 2,
    Math.ceil((60 * frameRate) / MIN_BPM),
  );
  if (maxLag <= minLag) return null;

  const scores = new Float32Array(maxLag + 2);
  let best = -Infinity;
  let bestLag = minLag;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = envelope.length - lag;
    for (let i = 0; i < limit; i++) sum += envelope[i] * envelope[i + lag];
    sum /= Math.max(1, limit);
    const bpm = (60 * frameRate) / lag;
    // Log-normal prior around a typical dance/pop tempo. Without it the
    // strongest peak is often a half- or double-time multiple.
    const prior = Math.exp(
      -0.5 * Math.pow(Math.log2(bpm / PREFERRED_BPM) / 0.9, 2),
    );
    const score = sum * prior;
    scores[lag] = score;
    count++;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (best <= 0 || count === 0) return null;

  // Parabolic interpolation around the peak recovers sub-lag resolution, which
  // matters because one whole lag step is several BPM at this hop size.
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = scores[bestLag - 1];
    const right = scores[bestLag + 1];
    const denominator = left - 2 * best + right;
    if (Math.abs(denominator) > 1e-9) {
      const offset = (0.5 * (left - right)) / denominator;
      if (Math.abs(offset) < 1) refined = bestLag + offset;
    }
  }

  let bpm = (60 * frameRate) / refined;
  while (bpm < FOLD_LOW) bpm *= 2;
  while (bpm > FOLD_HIGH) bpm /= 2;
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  // Peak/average saturated at 1 on nearly every real track. Use normalized
  // correlation so confidence reflects repeatability, not just a winning lag.
  let product = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let i = 0; i < envelope.length - bestLag; i++) {
    product += envelope[i] * envelope[i + bestLag];
    leftPower += envelope[i] ** 2;
    rightPower += envelope[i + bestLag] ** 2;
  }
  const strength = clamp(product / Math.max(1e-12, Math.sqrt(leftPower * rightPower)), 0, 1);
  return { bpm: Math.round(bpm * 10) / 10, strength };
}

export type KeyEstimate = { camelot: number; mode: "A" | "B"; strength: number };

/**
 * Correlate the chroma vector against every rotation of the major and minor
 * profiles and return the best match as a Camelot position.
 */
export function estimateKey(chroma: Float64Array): KeyEstimate | null {
  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const correlation = (profile: number[], rotation: number) => {
    let meanChroma = 0;
    let meanProfile = 0;
    for (let i = 0; i < 12; i++) {
      meanChroma += chroma[i];
      meanProfile += profile[i];
    }
    meanChroma /= 12;
    meanProfile /= 12;
    let numerator = 0;
    let left = 0;
    let right = 0;
    for (let i = 0; i < 12; i++) {
      const profileValue = profile[(i - rotation + 12) % 12];
      const chromaDelta = chroma[i] - meanChroma;
      const profileDelta = profileValue - meanProfile;
      numerator += chromaDelta * profileDelta;
      left += chromaDelta * chromaDelta;
      right += profileDelta * profileDelta;
    }
    const denominator = Math.sqrt(left * right);
    return denominator > 1e-9 ? numerator / denominator : 0;
  };

  let best = -Infinity;
  let runnerUp = -Infinity;
  let bestRotation = 0;
  let bestMode: "A" | "B" = "B";
  for (let rotation = 0; rotation < 12; rotation++) {
    const major = correlation(MAJOR_PROFILE, rotation);
    const minor = correlation(MINOR_PROFILE, rotation);
    for (const [score, mode] of [
      [major, "B"],
      [minor, "A"],
    ] as const) {
      if (score > best) {
        runnerUp = best;
        best = score;
        bestRotation = rotation;
        bestMode = mode;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }
  if (!Number.isFinite(best)) return null;

  const margin = Number.isFinite(runnerUp) ? best - runnerUp : best;
  return {
    camelot:
      bestMode === "A"
        ? MINOR_CAMELOT[bestRotation]
        : MAJOR_CAMELOT[bestRotation],
    mode: bestMode,
    strength: clamp(margin * 4, 0, 1),
  };
}

/** Perceived energy from RMS, mapped from a −30…0 dBFS window to 0–1. */
export function estimateEnergy(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return clamp((db + 30) / 30, 0, 1);
}

/**
 * Mix interleaved or planar channels down to mono, then resample to the
 * analysis rate.
 *
 * Downsampling by averaging whole input samples acts as a crude low-pass,
 * which is what we want: onsets live in the low end and averaging avoids the
 * aliasing that would otherwise smear the chroma vector.
 */
export function resampleMono(
  channels: Float32Array[],
  inputRate: number,
  outputRate = ANALYSIS_SAMPLE_RATE,
): Float32Array {
  const frames = channels[0]?.length ?? 0;
  if (!frames) return new Float32Array(0);
  const channelCount = channels.length;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let channel = 0; channel < channelCount; channel++)
      sum += channels[channel][i] || 0;
    mono[i] = sum / channelCount;
  }
  if (
    !Number.isFinite(inputRate) ||
    inputRate <= 0 ||
    inputRate === outputRate
  )
    return mono;

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(frames / ratio));
  const output = new Float32Array(outputLength);
  if (ratio >= 2) {
    // Box-filter decimation: average the source window that belongs to each
    // output sample. Using a fixed `floor(ratio)` window instead would repeat
    // or skip source samples whenever the ratio is fractional (48 kHz -> 11.025
    // kHz is 4.354), which jitters the onset envelope and corrupts the tempo.
    for (let i = 0; i < outputLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(frames, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let k = start; k < end; k++) sum += mono[k];
      output[i] = sum / (end - start);
    }
    return output;
  }
  // Upsampling or a fractional ratio: linear interpolation is plenty here.
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = mono[Math.min(index, frames - 1)];
    const b = mono[Math.min(index + 1, frames - 1)];
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

/**
 * Analyse mono PCM.
 *
 * Returns `null` when the signal is too short or too quiet to say anything
 * useful about it, so the caller can fall back to an estimate instead of
 * trusting a meaningless result. This matters for test tones and spoken-word
 * tracks, which have no tempo to find.
 */
export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
): TrackAnalysis | null {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0)
    return null;
  const { onset, chroma, frameRate, spectralEnergy } = onsetAndChroma(
    samples,
    sampleRate,
  );
  const energy = estimateEnergy(samples);
  // A silent (or near-silent) window has no onsets; refuse rather than guess.
  if (energy <= 0.02 || spectralEnergy <= 1e-6) return null;

  const tempo = estimateTempo(onset, frameRate);
  const key = estimateKey(chroma);
  if (!tempo && !key) return null;

  const keyMargin = key?.strength ?? 0;
  return {
    bpm: tempo?.bpm ?? PREFERRED_BPM,
    camelot: key?.camelot ?? 8,
    mode: key?.mode ?? "B",
    energy,
    confidence: clamp(
      0.35 + (tempo?.strength ?? 0) * 0.35 + keyMargin * 0.3,
      0,
      1,
    ),
    source: "analysis",
    tempoConfidence: tempo?.strength ?? 0,
    keyConfidence: key?.strength ?? 0,
  };
}

/** Measure a local pulse grid; refuse irregular/weak edges instead of guessing. */
export function analyzeTransitionRegion(
  samples: Float32Array,
  sampleRate: number,
  offset = 0,
): TransitionRegion | undefined {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length / sampleRate < 8) return undefined;
  const features = onsetAndChroma(samples, sampleRate);
  let best: TransitionRegion = { bpm: 0, beatOffset: 0, confidence: 0, energy: estimateEnergy(samples) };
  // Broad-band attacks and bass attacks provide independent pulse candidates.
  // A repeated offbeat (hi-hat/snare) must not count against regular kick beats.
  for (const onset of [features.onset, features.lowOnset]) {
    const tempo = estimateTempo(onset, features.frameRate);
    if (!tempo) continue;
    const peak = onset.reduce((max, value) => Math.max(max, value), 0);
    const mean = onset.reduce((sum, value) => sum + value, 0) / onset.length;
    const peaks: { time: number; weight: number }[] = [];
    for (let i = 1; i < onset.length - 1; i++) {
      if (onset[i] < Math.max(peak * 0.15, mean * 1.5) ||
          onset[i] < onset[i - 1] || onset[i] <= onset[i + 1]) continue;
      peaks.push({ time: (i * ANALYSIS_HOP + ANALYSIS_FFT_SIZE / 2) / sampleRate, weight: onset[i] });
    }
    if (peaks.length < 8) continue;
    const total = peaks.reduce((sum, item) => sum + item.weight, 0);
    for (const seed of [tempo.bpm / 2, tempo.bpm, tempo.bpm * 2]) {
      if (seed < 65 || seed > 180) continue;
      for (let bpm = seed * 0.98; bpm <= seed * 1.02; bpm += 0.1) {
        const period = 60 / bpm;
        for (const anchor of peaks.slice(0, 12)) {
          let matched = 0;
          let matchedWeight = 0;
          const beats = new Set<number>();
          for (const item of peaks) {
            const beat = Math.round((item.time - anchor.time) / period);
            const error = Math.abs(item.time - anchor.time - beat * period);
            if (error < 0.04) {
              matched += item.weight * (1 - error / 0.08);
              matchedWeight += item.weight;
              beats.add(beat);
            }
          }
          // Require attacks at most predicted pulses throughout the window.
          // Extra syncopated attacks are allowed; random attacks have poor coverage.
          if (matchedWeight < total * 0.25) continue;
          const coverage = Math.min(1, beats.size / (samples.length / sampleRate / period));
          const confidence = coverage * matched / matchedWeight;
          if (confidence > best.confidence) best = {
            bpm, beatOffset: offset + anchor.time, confidence, energy: best.energy,
          };
        }
      }
    }
  }
  return best.confidence >= 0.7 ? best : undefined;
}
