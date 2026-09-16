import type { ListeningEvent } from "./listening-history";

export type StatsPeriod = "day" | "week" | "month" | "year";

export type StatsTimelinePoint = {
  key: string;
  label: string;
  plays: number;
  seconds: number;
};

export type RankedListeningItem = {
  coverArt?: string;
  id: string;
  imageUrl?: string;
  label: string;
  detail?: string;
  plays: number;
  seconds: number;
};

export type ListeningStatsSnapshot = {
  activeDays: number;
  averageListenSeconds: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  longestStreak: number;
  range: {
    current: boolean;
    label: string;
  };
  sessions: number;
  timeline: StatsTimelinePoint[];
  topAlbums: RankedListeningItem[];
  topArtists: RankedListeningItem[];
  topGenres: RankedListeningItem[];
  topSongs: RankedListeningItem[];
  totalPlays: number;
  totalSeconds: number;
  uniqueAlbums: number;
  uniqueArtists: number;
  uniqueSongs: number;
};

type PeriodRange = {
  end: Date;
  label: string;
  start: Date;
  timeline: Array<Pick<StatsTimelinePoint, "key" | "label">>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date) => {
  const start = startOfDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);

const addPeriod = (date: Date, period: StatsPeriod, amount: number) => {
  const next = new Date(date);
  if (period === "day") next.setDate(next.getDate() + amount);
  if (period === "week") next.setDate(next.getDate() + amount * 7);
  if (period === "month") next.setMonth(next.getMonth() + amount);
  if (period === "year") next.setFullYear(next.getFullYear() + amount);
  return next;
};

const formattedMonthDay = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);

const formatHour = (hour: number) => {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
};

const periodRange = (period: StatsPeriod, offset: number, now: Date): PeriodRange => {
  const baseline =
    period === "day"
      ? startOfDay(now)
      : period === "week"
        ? startOfWeek(now)
        : period === "month"
          ? startOfMonth(now)
          : startOfYear(now);
  const start = addPeriod(baseline, period, offset);
  const end = addPeriod(start, period, 1);

  if (period === "day") {
    return {
      start,
      end,
      label: new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(start),
      timeline: Array.from({ length: 24 }, (_, hour) => ({
        key: String(hour),
        label: formatHour(hour),
      })),
    };
  }

  if (period === "week") {
    return {
      start,
      end,
      label: `${formattedMonthDay(start)} – ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(end.getTime() - 1))}`,
      timeline: Array.from({ length: 7 }, (_, index) => ({
        key: localDateKey(addPeriod(start, "day", index)),
        label: WEEKDAY_LABELS[index],
      })),
    };
  }

  if (period === "month") {
    const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return {
      start,
      end,
      label: new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(start),
      timeline: Array.from({ length: days }, (_, index) => {
        const day = addPeriod(start, "day", index);
        return { key: localDateKey(day), label: String(index + 1) };
      }),
    };
  }

  return {
    start,
    end,
    label: String(start.getFullYear()),
    timeline: MONTH_LABELS.map((label, index) => ({ key: String(index), label })),
  };
};

const normalizedKey = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") || "";

const genreNames = (value?: string) =>
  (value || "")
    .split(/[,;|/]+/)
    .map((genre) => genre.trim())
    .filter(Boolean);

const increase = (
  target: Map<string, RankedListeningItem>,
  id: string,
  label: string,
  detail?: string,
  artwork?: Pick<RankedListeningItem, "coverArt" | "imageUrl">,
) => {
  const existing = target.get(id);
  if (existing) {
    existing.plays += 1;
    if (!existing.coverArt && artwork?.coverArt) existing.coverArt = artwork.coverArt;
    if (!existing.imageUrl && artwork?.imageUrl) existing.imageUrl = artwork.imageUrl;
    return;
  }
  target.set(id, { id, label, detail, plays: 1, seconds: 0, ...artwork });
};

const rank = (items: Map<string, RankedListeningItem>) =>
  [...items.values()]
    .sort((left, right) => right.plays - left.plays || right.seconds - left.seconds)
    .slice(0, 8);

const longestDateStreak = (dates: Set<string>) => {
  const sorted = [...dates].sort();
  if (!sorted.length) return 0;
  let best = 1;
  let current = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = new Date(`${sorted[index - 1]}T12:00:00`);
    const next = new Date(`${sorted[index]}T12:00:00`);
    if (Math.round((next.getTime() - previous.getTime()) / DAY_MS) === 1) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 1;
    }
  }
  return best;
};

export const summarizeListeningPeriod = (
  events: readonly ListeningEvent[],
  period: StatsPeriod,
  offset = 0,
  now = new Date(),
): ListeningStatsSnapshot => {
  const range = periodRange(period, offset, now);
  const inPeriod = events.filter(
    (event) => event.at >= range.start.getTime() && event.at < range.end.getTime(),
  );
  const plays = inPeriod.filter((event) => event.kind === "start");
  const songs = new Map<string, RankedListeningItem>();
  const artists = new Map<string, RankedListeningItem>();
  const albums = new Map<string, RankedListeningItem>();
  const genres = new Map<string, RankedListeningItem>();
  const songSeconds = new Map<string, number>();
  const artistSeconds = new Map<string, number>();
  const albumSeconds = new Map<string, number>();
  const timeline = range.timeline.map((slot) => ({ ...slot, plays: 0, seconds: 0 }));
  const timelineByKey = new Map(timeline.map((slot) => [slot.key, slot]));
  const activeDates = new Set<string>();
  const sessionIds = new Set<string>();

  const timelineKey = (event: ListeningEvent) => {
    const date = new Date(event.at);
    if (period === "day") return String(date.getHours());
    if (period === "week" || period === "month") return localDateKey(date);
    return String(date.getMonth());
  };
  const artistFor = (event: ListeningEvent) => {
    const label = event.artist?.trim() || "Unknown artist";
    return { id: event.artistId?.trim() || normalizedKey(label), label };
  };
  const albumFor = (event: ListeningEvent) => {
    const label = event.album?.trim() || "Unknown album";
    return { id: event.albumId?.trim() || normalizedKey(label), label };
  };

  for (const event of inPeriod) {
    const seconds = Math.max(0, event.deltaSeconds);
    const artist = artistFor(event);
    const album = albumFor(event);
    songSeconds.set(event.songId, (songSeconds.get(event.songId) || 0) + seconds);
    artistSeconds.set(artist.id, (artistSeconds.get(artist.id) || 0) + seconds);
    albumSeconds.set(album.id, (albumSeconds.get(album.id) || 0) + seconds);
    const slot = timelineByKey.get(timelineKey(event));
    if (slot) slot.seconds += seconds;

    if (event.kind !== "start") continue;
    const artwork = { coverArt: event.coverArt, imageUrl: event.imageUrl };
    increase(songs, event.songId, event.title, event.artist || undefined, artwork);
    increase(artists, artist.id, artist.label, undefined, artwork);
    increase(albums, album.id, album.label, event.artist || undefined, artwork);
    genreNames(event.genre).forEach((genre) =>
      increase(genres, normalizedKey(genre), genre),
    );
    if (slot) slot.plays += 1;
    activeDates.add(localDateKey(new Date(event.at)));
    sessionIds.add(event.sessionId);
  }

  songs.forEach((item) => (item.seconds = songSeconds.get(item.id) || 0));
  artists.forEach((item) => (item.seconds = artistSeconds.get(item.id) || 0));
  albums.forEach((item) => (item.seconds = albumSeconds.get(item.id) || 0));

  const totalSeconds = inPeriod.reduce(
    (total, event) => total + Math.max(0, event.deltaSeconds),
    0,
  );
  const firstPlayedAt = plays.length
    ? Math.min(...plays.map((event) => event.at))
    : 0;
  const lastPlayedAt = plays.length ? Math.max(...plays.map((event) => event.at)) : 0;

  return {
    activeDays: activeDates.size,
    averageListenSeconds: plays.length ? totalSeconds / plays.length : 0,
    firstPlayedAt,
    lastPlayedAt,
    longestStreak: longestDateStreak(activeDates),
    range: { current: offset === 0, label: range.label },
    sessions: sessionIds.size,
    timeline,
    topAlbums: rank(albums),
    topArtists: rank(artists),
    topGenres: rank(genres),
    topSongs: rank(songs),
    totalPlays: plays.length,
    totalSeconds,
    uniqueAlbums: albums.size,
    uniqueArtists: artists.size,
    uniqueSongs: songs.size,
  };
};
