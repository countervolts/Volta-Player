import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Album,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clock3,
  Disc3,
  Flame,
  ListMusic,
  Music2,
  UserRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Artwork } from "../components";
import { duration, type Navidrome } from "../lib/navidrome";
import {
  summarizeListeningPeriod,
  type RankedListeningItem,
  type StatsPeriod,
} from "../lib/listening-stats";
import type { ListeningEvent } from "../lib/listening-history";

const PERIODS: Array<{ label: string; value: StatsPeriod }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];
const GRAPH_COLORS = ["#fa586a", "#d9899d", "#b79bdf", "#79b6c9", "#d7b36d", "#86b987", "#dd8d66", "#8ea8d8"];

type ArtworkSource = Pick<RankedListeningItem, "coverArt" | "imageUrl">;
type ArtworkKind = "album" | "artist" | "song";
type ChartValue = number | string | readonly (number | string)[];
const tooltipFormatter = (unit: string) => (value: ChartValue | undefined) =>
  [Array.isArray(value) ? value.join(" – ") : value ?? 0, unit] as [number | string, string];

const compactDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return duration(seconds);
};

function StatCard({
  icon,
  label,
  sub,
  value,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <article className="stats-card">
      <span className="stats-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="stats-card-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </article>
  );
}

const itemMediaKey = (kind: ArtworkKind, id: string) => `${kind}:${id}`;

function useRankedArtwork(
  client: Navidrome,
  songs: readonly RankedListeningItem[],
  artists: readonly RankedListeningItem[],
  albums: readonly RankedListeningItem[],
) {
  const cacheRef = useRef<{ client: Navidrome; entries: Map<string, ArtworkSource> }>();
  const [, setVersion] = useState(0);
  if (cacheRef.current?.client !== client)
    cacheRef.current = { client, entries: new Map<string, ArtworkSource>() };
  const songIds = useMemo(
    () => songs.filter((item) => !item.coverArt && !item.imageUrl).map((item) => item.id),
    [songs],
  );
  const artistIds = useMemo(
    () => artists.filter((item) => !item.imageUrl).map((item) => item.id),
    [artists],
  );
  const albumIds = useMemo(
    () => albums.filter((item) => !item.coverArt && !item.imageUrl).map((item) => item.id),
    [albums],
  );
  const requestKey = `${songIds.join("|")}\u001f${artistIds.join("|")}\u001f${albumIds.join("|")}`;

  useEffect(() => {
    if (client.server === "http://local.volta.invalid" || !requestKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const cache = cacheRef.current!.entries;
    const songRequests = songIds
      .filter((id) => !cache.has(itemMediaKey("song", id)))
      .map((id) =>
        client
          .song(id, controller.signal)
          .then((song) => ({
            key: itemMediaKey("song", id),
            value: { coverArt: song.coverArt, imageUrl: song.localArtworkUrl },
          }))
          .catch(() => null),
      );
    const artistRequests = artistIds
      .filter((id) => !cache.has(itemMediaKey("artist", id)))
      .map((id) =>
        client
          .artist(id, controller.signal)
          .then((artist) => ({
            key: itemMediaKey("artist", id),
            value: {
              coverArt: artist.coverArt,
              imageUrl: artist.artistImageUrl || artist.localArtworkUrl,
            },
          }))
          .catch(() => null),
      );
    const albumRequests = albumIds
      .filter((id) => !cache.has(itemMediaKey("album", id)))
      .map((id) =>
        client
          .album(id, controller.signal)
          .then((album) => ({
            key: itemMediaKey("album", id),
            value: { coverArt: album.coverArt, imageUrl: album.localArtworkUrl },
          }))
          .catch(() => null),
      );
    if (!songRequests.length && !artistRequests.length && !albumRequests.length) {
      controller.abort();
      return;
    }
    void Promise.all([...songRequests, ...artistRequests, ...albumRequests]).then((results) => {
      if (cancelled) return;
      let changed = false;
      results.forEach((result) => {
        if (!result) return;
        cache.set(result.key, result.value);
        changed = true;
      });
      if (changed) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [albumIds, artistIds, client, requestKey, songIds]);

  return cacheRef.current.entries;
}

function RankedList({
  client,
  emptyLabel,
  items,
  kind,
  media,
  title,
}: {
  client: Navidrome;
  emptyLabel: string;
  items: readonly RankedListeningItem[];
  kind: ArtworkKind;
  media: ReadonlyMap<string, ArtworkSource>;
  title: string;
}) {
  return (
    <section className="stats-chart-card stats-ranking-card">
      <h2>{title}</h2>
      {items.length ? (
        <ol className="stats-rank-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <span className="stats-rank-number">{index + 1}</span>
              <Artwork
                className={`stats-rank-artwork stats-rank-artwork-${kind}`}
                client={client}
                id={media.get(itemMediaKey(kind, item.id))?.coverArt || item.coverArt}
                imageUrl={media.get(itemMediaKey(kind, item.id))?.imageUrl || item.imageUrl}
                label=""
                loadEager
                size={100}
              />
              <span className="stats-rank-copy">
                <b>{item.label}</b>
                {item.detail && <small>{item.detail}</small>}
              </span>
              <span className="stats-rank-count">
                {item.plays} {item.plays === 1 ? "play" : "plays"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="stats-list-empty">{emptyLabel}</p>
      )}
    </section>
  );
}

function ActivityCharts({
  period,
  timeline,
}: {
  period: StatsPeriod;
  timeline: ReturnType<typeof summarizeListeningPeriod>["timeline"];
}) {
  const activityLabel =
    period === "day"
      ? "Plays by hour"
      : period === "week"
        ? "Plays by day"
        : period === "month"
          ? "Daily plays"
        : "Monthly plays";
  const chartData = timeline.map((slot) => ({
    label: slot.label,
    minutes: Math.round(slot.seconds / 60),
    plays: slot.plays,
  }));
  const axisTick = { fill: "var(--muted)", fontSize: 10 };
  const tooltipStyle = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 11,
  };
  return (
    <div className="stats-graph-grid">
      <section className="stats-chart-card stats-recharts-card">
        <div className="stats-chart-heading">
          <h2>{activityLabel}</h2>
          <span>Tracks</span>
        </div>
        <div className="stats-recharts-chart">
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={chartData} margin={{ bottom: 0, left: -18, right: 6, top: 8 }}>
              <defs>
                <linearGradient id={`stats-plays-${period}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.48} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" interval="preserveStartEnd" tick={axisTick} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} tickLine={false} />
              <RechartsTooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--accent)", strokeOpacity: 0.45 }} formatter={tooltipFormatter("plays")} />
              <Area dataKey="plays" fill={`url(#stats-plays-${period})`} stroke="var(--accent)" strokeWidth={2} type="monotone" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="stats-chart-card stats-recharts-card">
        <div className="stats-chart-heading">
          <h2>Listening time</h2>
          <span>Minutes</span>
        </div>
        <div className="stats-recharts-chart">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={chartData} margin={{ bottom: 0, left: -18, right: 6, top: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" interval="preserveStartEnd" tick={axisTick} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} tickLine={false} />
              <RechartsTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--hover)" }} formatter={tooltipFormatter("min")} />
              <Bar dataKey="minutes" fill="var(--accent)" maxBarSize={32} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function GenreBreakdown({ items }: { items: readonly RankedListeningItem[] }) {
  const genreData = items.map((item) => ({ label: item.label, plays: item.plays }));
  return (
    <section className="stats-chart-card stats-genre-card">
      <h2>Genre breakdown</h2>
      {items.length ? (
        <div className="stats-genre-chart">
          <div className="stats-genre-visual">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  cx="50%"
                  cy="50%"
                  data={genreData}
                  dataKey="plays"
                  innerRadius="54%"
                  outerRadius="78%"
                  paddingAngle={2}
                >
                  {genreData.map((item, index) => (
                    <Cell fill={GRAPH_COLORS[index % GRAPH_COLORS.length]} key={item.label} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", fontSize: 11 }} formatter={tooltipFormatter("plays")} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ol className="stats-genre-list">
            {items.map((item, index) => (
              <li key={item.id}>
                <i aria-hidden="true" style={{ background: GRAPH_COLORS[index % GRAPH_COLORS.length] }} />
                <span className="stats-genre-label">{item.label}</span>
                <span>{item.plays}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="stats-list-empty">No genres were recorded for this period.</p>
      )}
    </section>
  );
}

export function StatsView({
  client,
  enabled,
  events,
  onOpenSettings,
}: {
  client: Navidrome;
  enabled: boolean;
  events: readonly ListeningEvent[];
  onOpenSettings: () => void;
}) {
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [offset, setOffset] = useState(0);
  const stats = useMemo(
    () => summarizeListeningPeriod(events, period, offset),
    [events, offset, period],
  );
  const rankedArtwork = useRankedArtwork(
    client,
    stats.topSongs,
    stats.topArtists,
    stats.topAlbums,
  );
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    [],
  );
  const hasData = stats.totalPlays > 0;
  const periodName = PERIODS.find((candidate) => candidate.value === period)?.label || "";

  return (
    <div className="stats-view">
      <p className="stats-intro">
        Listening activity saved locally by Volta. Browse day, week, month, and
        year views without sending your history anywhere.
      </p>
      <div className="stats-period-tabs" role="tablist" aria-label="Stats period">
        {PERIODS.map((candidate) => (
          <button
            key={candidate.value}
            role="tab"
            aria-selected={period === candidate.value}
            className={period === candidate.value ? "selected" : ""}
            onClick={() => {
              setPeriod(candidate.value);
              setOffset(0);
            }}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div className="stats-period-nav">
        <button
          aria-label={`Previous ${periodName.toLowerCase()}`}
          className="stats-period-arrow"
          onClick={() => setOffset((value) => value - 1)}
          type="button"
        >
          <ArrowLeft size={16} />
        </button>
        <strong>{stats.range.label}</strong>
        <button
          className={stats.range.current ? "stats-current active" : "stats-current"}
          onClick={() => setOffset(0)}
          type="button"
        >
          {period === "day" ? "Today" : period === "week" ? "This week" : "Current"}
        </button>
        <button
          aria-label={`Next ${periodName.toLowerCase()}`}
          className="stats-period-arrow"
          disabled={stats.range.current}
          onClick={() => setOffset((value) => Math.min(0, value + 1))}
          type="button"
        >
          <ArrowRight size={16} />
        </button>
      </div>
      {!enabled ? (
        <section className="stats-empty-state">
          <BarChart3 size={31} aria-hidden="true" />
          <h2>Listening stats are paused</h2>
          <p>Turn on personalized recommendations to start keeping a local listening history.</p>
          <button className="secondary-button" onClick={onOpenSettings} type="button">
            Open Settings
          </button>
        </section>
      ) : !hasData ? (
        <section className="stats-empty-state">
          <BarChart3 size={31} aria-hidden="true" />
          <h2>No listening data for this {periodName.toLowerCase()}</h2>
          <p>
            {stats.range.current
              ? "Start playing music and your stats will appear here automatically."
              : "No tracks were recorded for this period."}
          </p>
        </section>
      ) : (
        <>
          <section className="stats-section">
            <div className="stats-section-heading">
              <BarChart3 size={16} aria-hidden="true" />
              <h2>{period === "year" ? `${stats.range.label} summary` : "Overview"}</h2>
            </div>
            <div className="stats-grid">
              <StatCard icon={<Music2 size={18} />} label="Tracks played" value={stats.totalPlays.toLocaleString()} />
              <StatCard
                icon={<Clock3 size={18} />}
                label="Listen time"
                value={compactDuration(stats.totalSeconds)}
                sub={`${Math.round(stats.totalSeconds / 60).toLocaleString()} min`}
              />
              <StatCard icon={<Disc3 size={18} />} label="Unique songs" value={stats.uniqueSongs.toLocaleString()} />
              <StatCard icon={<UserRound size={18} />} label="Unique artists" value={stats.uniqueArtists.toLocaleString()} />
              <StatCard icon={<Album size={18} />} label="Unique albums" value={stats.uniqueAlbums.toLocaleString()} />
              <StatCard icon={<ListMusic size={18} />} label="Sessions" value={stats.sessions.toLocaleString()} />
              <StatCard
                icon={<CalendarDays size={18} />}
                label="Average listen"
                value={compactDuration(stats.averageListenSeconds)}
                sub="per track start"
              />
              <StatCard
                icon={<Flame size={18} />}
                label="Best streak"
                value={`${stats.longestStreak} day${stats.longestStreak === 1 ? "" : "s"}`}
                sub={`${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"}`}
              />
            </div>
          </section>
          <div className="stats-info-bar">
            <span>First play <b>{timeFormatter.format(stats.firstPlayedAt)}</b></span>
            <span>Last play <b>{timeFormatter.format(stats.lastPlayedAt)}</b></span>
            <span>Active days <b>{stats.activeDays}</b></span>
          </div>
          <ActivityCharts period={period} timeline={stats.timeline} />
          <div className="stats-lower-grid">
            <GenreBreakdown items={stats.topGenres} />
            <RankedList
              client={client}
              emptyLabel="No songs were recorded for this period."
              items={stats.topSongs}
              kind="song"
              media={rankedArtwork}
              title="Top songs"
            />
          </div>
          <div className="stats-lower-grid">
            <RankedList
              client={client}
              emptyLabel="No albums were recorded for this period."
              items={stats.topAlbums}
              kind="album"
              media={rankedArtwork}
              title="Top albums"
            />
            <RankedList
              client={client}
              emptyLabel="No artists were recorded for this period."
              items={stats.topArtists}
              kind="artist"
              media={rankedArtwork}
              title="Top artists"
            />
          </div>
        </>
      )}
    </div>
  );
}
