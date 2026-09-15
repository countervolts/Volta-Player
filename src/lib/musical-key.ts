/**
 * Shared music-theory helpers for AutoMix.
 *
 * Kept in one place so the offline analyser and the transition planner cannot
 * drift apart on what "8A" or a Camelot distance means.
 */

export type CamelotKey = { camelot: number; mode: "A" | "B" };

/** Major keys on the Camelot wheel, indexed by pitch class (0 = C). */
export const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
/** Relative minors, same pitch-class indexing. */
export const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

const NOTE_TO_SEMITONE: Record<string, number> = {
  c: 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  fb: 4,
  "e#": 5,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
  cb: 11,
  "b#": 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Parse a musical key label into a Camelot position.
 * Accepts `Am`, `A minor`, `F#m`, `Db`, `C major`, `8A`, `8B`.
 */
export function parseMusicalKey(value?: string): CamelotKey | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/\s+/g, "");
  if (!normalized) return null;

  // A server may already hand back a Camelot code.
  const camelot = normalized.match(/^(\d{1,2})([ab])$/);
  if (camelot) {
    const number = Number(camelot[1]);
    if (number >= 1 && number <= 12)
      return { camelot: number, mode: camelot[2] === "a" ? "A" : "B" };
  }

  let mode: "A" | "B" = "B";
  let root = normalized;
  if (/minor$/.test(normalized)) {
    mode = "A";
    root = normalized.replace(/minor$/, "");
  } else if (/min$/.test(normalized)) {
    mode = "A";
    root = normalized.replace(/min$/, "");
  } else if (/major$/.test(normalized)) {
    root = normalized.replace(/major$/, "");
  } else if (/maj$/.test(normalized)) {
    root = normalized.replace(/maj$/, "");
  } else if (normalized.length > 1 && /m$/.test(normalized)) {
    mode = "A";
    root = normalized.replace(/m$/, "");
  }

  const semitone = NOTE_TO_SEMITONE[root];
  if (semitone === undefined) return null;
  return {
    camelot: mode === "A" ? MINOR_CAMELOT[semitone] : MAJOR_CAMELOT[semitone],
    mode,
  };
}

/**
 * Harmonic distance on the Camelot wheel.
 * 0 = identical, 1 = adjacent or relative, 2 = one step away, 3+ = clash.
 */
export function camelotDistance(a: CamelotKey, b: CamelotKey): number {
  if (a.camelot === b.camelot && a.mode === b.mode) return 0;
  // Relative major/minor share a number but differ in mode.
  if (a.camelot === b.camelot) return 1;
  const forward = (b.camelot - a.camelot + 12) % 12;
  const backward = (a.camelot - b.camelot + 12) % 12;
  const steps = Math.min(forward, backward);
  // Same mode, one step around the wheel is a perfect fourth/fifth.
  if (a.mode === b.mode) return steps === 1 ? 1 : steps === 2 ? 2 : 3;
  // Different modes: adjacent numbers are still mixable, further is not.
  return steps === 1 ? 2 : 3;
}

/** Map harmonic distance onto a 0–1 compatibility score. */
export function harmonicCompatibility(distance: number): number {
  return clamp(1 - distance / 3, 0, 1);
}

/**
 * Fold a tempo ratio into the 0.75–1.5 range so 70 BPM and 140 BPM read as the
 * same tempo, which is how a DJ hears them.
 */
export function foldTempoRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  let folded = ratio;
  while (folded < 0.75) folded *= 2;
  while (folded > 1.5) folded /= 2;
  return folded;
}

/** 0–1 tempo compatibility, 1 when the folded ratio is exactly 1. */
export function tempoCompatibility(fromBpm: number, toBpm: number): number {
  if (!Number.isFinite(fromBpm) || !Number.isFinite(toBpm)) return 0;
  if (fromBpm <= 0 || toBpm <= 0) return 0;
  const folded = foldTempoRatio(toBpm / fromBpm);
  const drift = Math.abs(folded - 1);
  return clamp(1 - drift / 0.25, 0, 1);
}