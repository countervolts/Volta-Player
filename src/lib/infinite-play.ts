import type { Song } from "./navidrome";

export type AlbumSongGroup = {
  albumId: string;
  songs: readonly Song[];
};

export function infinitePlayAlbumTarget(songCount: number) {
  const wanted = Math.max(1, Math.trunc(songCount));
  return Math.max(24, Math.min(64, wanted));
}

const MAX_SONG_PAGE = 100;

/** Sort by disc then track so an album plays in its intended order. */
const albumOrder = (left: Song, right: Song) => {
  const disc = (left.discNumber || 1) - (right.discNumber || 1);
  if (disc !== 0) return disc;
  const track = (left.track || 0) - (right.track || 0);
  if (track !== 0) return track;
  return left.id.localeCompare(right.id);
};

/** Deduplicate songs by ID, keeping the first occurrence. */
const uniqueSongs = (songs: readonly Song[]) => {
  const seen = new Set<string>();
  const output: Song[] = [];
  for (const song of songs) {
    if (!song?.id || seen.has(song.id)) continue;
    seen.add(song.id);
    output.push(song);
  }
  return output;
};

export function interleaveAlbumSongs(
  groups: readonly AlbumSongGroup[],
  count: number,
  excludedSongIds: ReadonlySet<string> = new Set(),
): Song[] {
  const wanted = Math.max(0, Math.trunc(count));
  if (!wanted) return [];

  const claimed = new Set<string>();
  const albums: Song[][] = [];
  for (const group of groups) {
    const songs = uniqueSongs(group.songs)
      .filter((song) => !excludedSongIds.has(song.id) && !claimed.has(song.id))
      .sort(albumOrder);
    if (!songs.length) continue;
    songs.forEach((song) => claimed.add(song.id));
    albums.push(songs);
  }
  if (!albums.length) return [];

  const output: Song[] = [];
  const longest = Math.max(...albums.map((songs) => songs.length));
  for (let round = 0; round < longest && output.length < wanted; round++) {
    for (const album of albums) {
      const song = album[round];
      if (!song) continue;
      output.push(song);
      if (output.length >= wanted) break;
    }
  }
  return output;
}

export function rankInfinitePlayAlbums(input: {
  shelfIds: readonly string[];
  poolIds?: readonly string[];
  queuedAlbumIds?: ReadonlySet<string>;
  limit?: number;
}): string[] {
  const queued = input.queuedAlbumIds || new Set<string>();
  const fresh: string[] = [];
  const alreadyQueued: string[] = [];
  const seen = new Set<string>();

  const add = (ids: readonly string[] | undefined, target: string[]) => {
    for (const raw of ids || []) {
      const id = raw?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      target.push(id);
    }
  };

  add(
    input.shelfIds?.filter((id) => !queued.has(id.trim())),
    fresh,
  );
  add(
    input.poolIds?.filter((id) => !queued.has(id.trim())),
    fresh,
  );
  // Pass 2: previously queued albums, only to fill out a small library.
  add(input.shelfIds, alreadyQueued);
  add(input.poolIds, alreadyQueued);

  const ordered = [...fresh, ...alreadyQueued];
  return input.limit ? ordered.slice(0, input.limit) : ordered;
}

export async function loadRankedAlbumSongs(
  rankedAlbumIds: readonly string[],
  wantedAlbums: number,
  fetchSongs: (offset: number, size: number) => Promise<Song[]>,
  options: {
    pageSize?: number;
    maxPages?: number;
    wantedSongs?: number;
    /** Albums already in the queue; seek past these before stopping. */
    excludeAlbumIds?: ReadonlySet<string>;
  } = {},
): Promise<AlbumSongGroup[]> {
  const target = Math.max(1, Math.trunc(wantedAlbums));
  const songTarget = Math.max(1, Math.trunc(options.wantedSongs ?? target));
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? 200));
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? 25));

  const byAlbum = new Map<string, Song[]>();
  const excludedAlbumIds = new Set(
    [...(options.excludeAlbumIds || [])]
      .map((id) => id.trim())
      .filter(Boolean),
  );
  let offset = 0;
  let pages = 0;
  let held = 0;
  let freshAlbums = 0;
  while (
    pages < maxPages &&
    (byAlbum.size < target || held < songTarget || freshAlbums < target)
  ) {
    const page = await fetchSongs(offset, pageSize);
    if (!page.length) break;
    offset += page.length;
    for (const song of page) {
      const id = song?.albumId?.trim() || song?.id?.trim();
      if (!id || !song.id) continue;
      const bucket = byAlbum.get(id);
      if (bucket) bucket.push(song);
      else {
        byAlbum.set(id, [song]);
        if (!excludedAlbumIds.has(id)) freshAlbums += 1;
      }
      held += 1;
    }
    pages += 1;
    if (page.length < Math.min(pageSize, MAX_SONG_PAGE)) break;
  }

  const rankOf = new Map<string, number>();
  rankedAlbumIds.forEach((raw, index) => {
    const id = raw?.trim();
    // First occurrence wins, so a duplicate ID cannot shift a later album.
    if (id && !rankOf.has(id)) rankOf.set(id, index);
  });
  const unranked = Number.MAX_SAFE_INTEGER;

  return [...byAlbum.entries()]
    .sort(([left], [right]) => {
      const leftRank = rankOf.get(left) ?? unranked;
      const rightRank = rankOf.get(right) ?? unranked;
      if (leftRank !== rightRank) return leftRank - rightRank;
      // Albums discovered beyond the ranked list keep a stable order.
      return left.localeCompare(right);
    })
    .map(([albumId, songs]) => ({ albumId, songs }));
}
