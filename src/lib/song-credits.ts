import type { Song } from "./navidrome";

export type SongCredit = {
  role: string;
  people: string[];
};

export type SongCredits = {
  source: "metadata" | "musicbrainz";
  credits: SongCredit[];
  recordingTitle: string;
};

type MusicBrainzArtist = { name?: string };
type MusicBrainzRelation = {
  type?: string;
  artist?: MusicBrainzArtist;
};
type MusicBrainzRecording = {
  title?: string;
  length?: number;
  score?: number;
  "artist-credit"?: Array<{ name?: string; artist?: MusicBrainzArtist }>;
  relations?: MusicBrainzRelation[];
};

type MusicBrainzResponse = { recordings?: MusicBrainzRecording[] };

type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const normalized = (value?: string) =>
  (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const same = (left?: string, right?: string) => {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
};

const artistNames = (recording: MusicBrainzRecording) =>
  (recording["artist-credit"] || [])
    .map((credit) => credit.artist?.name || credit.name || "")
    .filter(Boolean);

const scoreRecording = (recording: MusicBrainzRecording, song: Song) => {
  let score = recording.score || 0;
  if (same(recording.title, song.title)) score += 120;
  if (artistNames(recording).some((artist) => same(artist, song.artist))) score += 80;
  if (song.duration && recording.length) {
    const difference = Math.abs(recording.length / 1000 - song.duration);
    score += Math.max(0, 25 - difference * 3);
  }
  return score;
};

const displayRole = (role: string) =>
  role
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const splitPeople = (value?: string) =>
  (value || "")
    .split(/[;\u0000•]/)
    .map((person) => person.trim())
    .filter(Boolean);

export function creditsFromMetadata(song: Song): SongCredits | null {
  const roles = new Map<string, Set<string>>();
  const add = (role: string, value?: string) => {
    const people = splitPeople(value);
    if (!people.length) return;
    const existing = roles.get(role) || new Set<string>();
    people.forEach((person) => existing.add(person));
    roles.set(role, existing);
  };
  add("Primary artist", song.artist);
  if (!same(song.albumArtist, song.artist)) add("Album artist", song.albumArtist);
  add("Composer", song.composer);
  if (!roles.size) return null;
  return {
    source: "metadata",
    recordingTitle: song.title,
    credits: [...roles.entries()].map(([role, people]) => ({
      role,
      people: [...people],
    })),
  };
}

export function creditsFromMusicBrainz(
  response: unknown,
  song: Song,
): SongCredits | null {
  const recordings = (response as MusicBrainzResponse)?.recordings;
  if (!Array.isArray(recordings) || !recordings.length) return null;
  const recording = [...recordings]
    .filter(
      (candidate): candidate is MusicBrainzRecording =>
        Boolean(candidate) &&
        same(candidate.title, song.title) &&
        artistNames(candidate).some((artist) => same(artist, song.artist)),
    )
    .sort((left, right) => scoreRecording(right, song) - scoreRecording(left, song))[0];
  if (!recording) return null;

  const roles = new Map<string, Set<string>>();
  const add = (role: string, person?: string) => {
    if (!person) return;
    const people = roles.get(role) || new Set<string>();
    people.add(person);
    roles.set(role, people);
  };
  artistNames(recording).forEach((artist) => add("Primary artist", artist));
  (recording.relations || []).forEach((relation) => {
    if (!relation.type) return;
    add(displayRole(relation.type), relation.artist?.name);
  });

  return {
    source: "musicbrainz",
    recordingTitle: recording.title || song.title,
    credits: [...roles.entries()].map(([role, people]) => ({
      role,
      people: [...people],
    })),
  };
}

export async function lookupSongCredits(
  song: Song,
  fetcher: Fetcher = fetch,
): Promise<SongCredits | null> {
  const metadataCredits = creditsFromMetadata(song);
  if (metadataCredits && metadataCredits.credits.length > 1) return metadataCredits;
  if (!song.title || !song.artist) return null;
  const query = new URLSearchParams({
    fmt: "json",
    limit: "8",
    inc: "artist-credits+recording-rels",
    query: `recording:"${song.title}" AND artist:"${song.artist}"`,
  });
  try {
    const response = await fetcher(
      `https://musicbrainz.org/ws/2/recording/?${query}`,
      { credentials: "omit", referrerPolicy: "no-referrer" },
    );
    if (!response.ok) return null;
    const external = creditsFromMusicBrainz(await response.json(), song);
    if (!external || !metadataCredits) return external;
    const merged = new Map<string, string[]>();
    [...metadataCredits.credits, ...external.credits].forEach((credit) => {
      const people = merged.get(credit.role) || [];
      credit.people.forEach((person) => {
        if (!people.includes(person)) people.push(person);
      });
      merged.set(credit.role, people);
    });
    return {
      ...external,
      credits: [...merged.entries()].map(([role, people]) => ({ role, people })),
    };
  } catch {
    return null;
  }
}
