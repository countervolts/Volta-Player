import type { ShareProvider } from "../app/app-storage";

export type ShareTarget = {
  type: "song" | "album" | "artist";
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
};

export type ShareResolution = {
  url: string;
  exact: boolean;
};

type ItunesResult = {
  artistName?: string;
  artistViewUrl?: string;
  collectionName?: string;
  collectionViewUrl?: string;
  trackName?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
};

type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const normalize = (value?: string) =>
  (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[\[(][^\])]*[\])]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const matches = (left?: string, right?: string) => {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
};

const queryFor = (target: ShareTarget) =>
  [target.artist, target.title, target.type === "song" ? target.album : ""]
    .filter(Boolean)
    .join(" ");

export const providerSearchUrl = (
  provider: ShareProvider,
  target: ShareTarget,
) => {
  const query = encodeURIComponent(queryFor(target));
  if (provider === "spotify") return `https://open.spotify.com/search/${query}`;
  return `https://music.apple.com/us/search?term=${query}`;
};

const itunesEntity = (type: ShareTarget["type"]) =>
  type === "song" ? "song" : type === "album" ? "album" : "musicArtist";

const isExactAppleMatch = (target: ShareTarget, result: ItunesResult) => {
  if (target.type === "song")
    return matches(target.title, result.trackName) && matches(target.artist, result.artistName);
  if (target.type === "album")
    return matches(target.title, result.collectionName) && matches(target.artist, result.artistName);
  return matches(target.title, result.artistName);
};

const resultUrl = (target: ShareTarget, result: ItunesResult) =>
  target.type === "song"
    ? result.trackViewUrl
    : target.type === "album"
      ? result.collectionViewUrl
      : result.artistViewUrl;

export async function resolveShareUrl(
  provider: ShareProvider,
  target: ShareTarget,
  fetcher: Fetcher = fetch,
): Promise<ShareResolution> {
  const fallback = providerSearchUrl(provider, target);
  if (provider === "spotify") return { url: fallback, exact: false };

  const params = new URLSearchParams({
    term: queryFor(target),
    country: "US",
    media: "music",
    entity: itunesEntity(target.type),
    limit: "8",
  });
  try {
    const response = await fetcher(`https://itunes.apple.com/search?${params}`);
    if (!response.ok) return { url: fallback, exact: false };
    const payload = (await response.json()) as { results?: ItunesResult[] };
    const matchesForTarget = (payload.results || []).filter((result) =>
      isExactAppleMatch(target, result),
    );
    const result = target.duration
      ? [...matchesForTarget].sort(
          (left, right) =>
            Math.abs((left.trackTimeMillis || 0) / 1000 - target.duration!) -
            Math.abs((right.trackTimeMillis || 0) / 1000 - target.duration!),
        )[0]
      : matchesForTarget[0];
    const url = result ? resultUrl(target, result) : undefined;
    return url ? { url, exact: true } : { url: fallback, exact: false };
  } catch {
    return { url: fallback, exact: false };
  }
}
