import type { Song } from "./navidrome";
import {
  camelotDistance,
  harmonicCompatibility,
  parseMusicalKey,
  tempoCompatibility,
} from "./musical-key";
import type { TrackAnalysis } from "./audio-analysis";

/** Evidence-based transitions. Unknown rhythm never authorizes speed changes. */

export type AutomixStyle = "beatmatch" | "crossfade" | "cut" | "gapless";

export type AutomixProfile = {
  /** Beats per minute. */
  bpm: number;
  /** Camelot wheel position, 1–12. */
  camelot: number;
  /** Camelot wheel letter: A = minor, B = major. */
  mode: "A" | "B";
  /** 0–1 loudness/energy proxy used to avoid jarring drops. */
  energy: number;
  /** 0–1 confidence in the profile. Audio analysis scores highest. */
  confidence: number;
  source: "analysis" | "server" | "estimated";
};

export type AutomixPlan = {
  style: AutomixStyle;
  /** Seconds the two tracks overlap. Zero preserves the natural boundary. */
  overlapSeconds: number;
  /** Playback-rate multiplier for the incoming track (1 = untouched). */
  tempoRatio: number;
  /** Absolute outgoing start time when a measured grid is available. */
  outgoingStartSeconds?: number;
  /** Where the incoming track starts, in seconds. */
  incomingOffsetSeconds: number;
  curve: "equal-power" | "linear";
  /** 0–1 harmonic compatibility on the Camelot wheel. */
  harmonic: number;
  /** 0–1 tempo compatibility after octave folding. */
  tempoCompatibility: number;
  /** Human-readable explanation, surfaced in the Now Playing indicator. */
  reason: string;
};

export const AUTOMIX_MIN_OVERLAP = 0;
export const AUTOMIX_MAX_OVERLAP = 8;
/** Baseline for a short dissolve; unsuitable pairs can have zero overlap. */
export const AUTOMIX_FLOOR_OVERLAP = 1.5;
/** Conservative stretch bound; pitch preservation is also required. */
export const AUTOMIX_MAX_TEMPO_SHIFT = 0.03;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Unknown values stay neutral and carry zero confidence; no metadata hashes. */
export function automixProfile(song: Song): AutomixProfile {
  const analysis = song.analysis;
  if (analysis && Number.isFinite(analysis.bpm) && analysis.bpm > 0 &&
      Number.isFinite(analysis.energy) && Number.isFinite(analysis.confidence)) {
    return { ...analysis, source: "analysis" };
  }
  const bpm = Number(song.bpm);
  const key = parseMusicalKey(song.musicalKey);
  const hasTempo = Number.isFinite(bpm) && bpm >= 40 && bpm <= 240;
  return {
    bpm: hasTempo ? bpm : 0,
    camelot: key?.camelot ?? 8,
    mode: key?.mode ?? "B",
    energy: 0.5,
    confidence: hasTempo && key ? 0.8 : 0,
    source: hasTempo && key ? "server" : "estimated",
  };
}

/** Round a duration to a whole number of beats, never below one beat. */
export function quantizeToBeat(seconds: number, bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return seconds;
  const beat = 60 / bpm;
  const beats = Math.max(1, Math.round(seconds / beat));
  return beats * beat;
}

/**
 * Prefer a short natural-speed dissolve unless actual edge pulses agree.
 * Constants here are Volta tuning, not claims about Apple's private algorithm.
 */
export function planAutomixTransition(
  from: Song,
  to: Song,
  options: { maxOverlap?: number; duration?: number } = {},
): AutomixPlan {
  const ceiling = options.maxOverlap ?? AUTOMIX_MAX_OVERLAP;
  const duration = options.duration ?? from.analysis?.duration ?? from.duration ?? 0;
  const incomingDuration = to.analysis?.duration ?? to.duration ?? 0;
  const maxOverlap = Math.min(
    clamp(Number.isFinite(ceiling) ? ceiling : AUTOMIX_MAX_OVERLAP, 0, AUTOMIX_MAX_OVERLAP),
    duration > 0 ? duration / 4 : AUTOMIX_MAX_OVERLAP,
    incomingDuration > 0 ? incomingDuration / 4 : AUTOMIX_MAX_OVERLAP,
  );
  const a = automixProfile(from);
  const b = automixProfile(to);
  const knownKey = (song: Song, profile: AutomixProfile) =>
    profile.source === "server" || (profile.source === "analysis" &&
      (song.analysis?.keyConfidence ?? 0) >= 0.5);
  const knownTempo = (song: Song, profile: AutomixProfile) =>
    profile.source === "server" || (profile.source === "analysis" &&
      (song.analysis?.tempoConfidence ?? 0) >= 0.7);
  const harmonic = knownKey(from, a) && knownKey(to, b)
    ? harmonicCompatibility(camelotDistance(a, b)) : 0.5;
  const tempoKnown = knownTempo(from, a) && knownTempo(to, b);
  const tempo = tempoKnown
    ? tempoCompatibility(a.bpm, b.bpm) : 0.5;
  const energyGap = Math.abs((from.analysis?.outro?.energy ?? a.energy) -
    (to.analysis?.intro?.energy ?? b.energy));
  const plan: AutomixPlan = {
    style: "crossfade", overlapSeconds: Math.min(2, maxOverlap),
    tempoRatio: 1, incomingOffsetSeconds: 0, curve: "equal-power",
    harmonic, tempoCompatibility: tempo,
    reason: "Gentle blend at original tempo",
  };
  if (harmonic < 0.34 || tempoKnown && tempo < 0.55 || energyGap > 0.55 ||
      from.id === to.id || duration > 0 && duration < 12 ||
      incomingDuration > 0 && incomingDuration < 12) {
    return { ...plan, style: "gapless", overlapSeconds: 0,
      reason: "Preserving the natural song boundary" };
  }
  const outro = from.analysis?.outro;
  const intro = to.analysis?.intro;
  if (!outro || !intro || outro.confidence < 0.7 || intro.confidence < 0.7 ||
      !Number.isFinite(outro.bpm) || !Number.isFinite(intro.bpm) ||
      outro.bpm <= 0 || intro.bpm <= 0 ||
      !Number.isFinite(outro.beatOffset) || !Number.isFinite(intro.beatOffset) ||
      duration <= 0 || energyGap > 0.3) return plan;
  // Incoming playback must move toward outgoing tempo: 120 / 125, not 125 / 120.
  // Do not octave-fold an ambiguous edge pulse into a purported beat match.
  const ratio = outro.bpm / intro.bpm;
  if (Math.abs(ratio - 1) > AUTOMIX_MAX_TEMPO_SHIFT) return plan;
  const beat = 60 / outro.bpm;
  // Without vocal/phrase separation, cap shared-key overlap to four beats.
  const desired = Math.min(harmonic >= 0.67 ? beat * 8 : beat * 4, maxOverlap);
  // Align incoming pulse phase by moving the outgoing start, preserving time 0
  // of the incoming song. A pulse is not evidence of a bar downbeat.
  const phase = outro.beatOffset - intro.beatOffset / ratio;
  const earliest = duration - desired;
  const start = phase + Math.ceil((earliest - phase) / beat) * beat;
  const overlap = duration - start;
  if (overlap < 1 || start < 0 || start < duration - maxOverlap) return plan;
  return { ...plan, style: "beatmatch", overlapSeconds: overlap,
    outgoingStartSeconds: start, tempoRatio: ratio,
    reason: `Measured beats aligned near ${Math.round(outro.bpm)} BPM` };
}

/**
 * Apple skips AutoMix for a full album played in order, out of respect for the
 * artist's intended pacing. Volta mirrors that: a queue that is one album in
 * track order is left alone.
 */
export function isAlbumSequence(queue: readonly Song[]): boolean {
  if (queue.length < 2) return false;
  const albumId = queue[0]?.albumId;
  if (!albumId) return false;
  let previousTrack = -Infinity;
  let previousDisc = 1;
  for (const song of queue) {
    if (song.albumId !== albumId) return false;
    const track = song.track;
    if (!Number.isFinite(track)) return false;
    const disc = song.discNumber ?? 1;
    if (previousTrack !== -Infinity &&
        !(disc === previousDisc && track === previousTrack + 1) &&
        !(disc === previousDisc + 1 && track === 1)) return false;
    previousTrack = track as number;
    previousDisc = disc;
  }
  return true;
}

/**
 * Whether AutoMix should run for the queue at all. Local files are excluded
 * because their metadata is rarely scanned, matching Apple's behaviour.
 *
 * Whether there *is* a next track is the caller's concern: `checkHandoff`
 * already knows the next index, and repeat-all legitimately wraps to 0.
 */
export function automixEligible(queue: readonly Song[]): boolean {
  if (queue.length < 2) return false;
  if (queue.some((song) => song.source === "local" || song.localUrl))
    return false;
  return !isAlbumSequence(queue);
}

/** Short label for the Now Playing "Mixing" indicator. */
export function describeAutomixStyle(style: AutomixStyle): string {
  if (style === "gapless") return "Natural transition";
  return style === "beatmatch"
    ? "Beat-matched"
    : style === "cut"
      ? "Quick blend"
      : "Crossfade";
}

export type { TrackAnalysis };
