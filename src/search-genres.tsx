import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, Music2, Play, Shuffle } from "lucide-react";
import { AlbumGrid, Artwork } from "./components";
import { type AlbumRecord, type Genre, type Navidrome, type Song } from "./lib/navidrome";
import { type LocalMusicLibrary } from "./lib/local-music";

const colors = ["#a92343", "#285c94", "#9b5622", "#247469", "#786321", "#7e4168", "#416b37", "#ad3630"];
const key = (value: string) => value.trim().toLocaleLowerCase();

function GenreTile({ genre, client, localTracks, onOpen }: {
  genre: Genre; client: Navidrome; localTracks?: Song[]; onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [cover, setCover] = useState<Song>();
  useEffect(() => {
    if (localTracks) {
      setCover(localTracks.find((song) => song.localArtworkUrl));
      return;
    }
    const controller = new AbortController();
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void client.songsByGenre(genre.value, 0, 1, controller.signal)
        .then((songs) => { if (!controller.signal.aborted) setCover(songs[0]); })
        .catch(() => {});
    }, { rootMargin: "120px" });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [client, genre.value, localTracks]);
  const color = colors[Array.from(genre.value).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % colors.length];
  return <button ref={ref} className="genre-tile" style={{ "--genre-color": color } as CSSProperties}
    onClick={onOpen} aria-label={`Browse ${genre.value}`}>
    {cover?.coverArt || cover?.localArtworkUrl
      ? <Artwork client={client} id={cover.coverArt} imageUrl={cover.localArtworkUrl} size={400} />
      : <Music2 className="genre-symbol" aria-hidden="true" />}
    <strong>{genre.value}</strong>
  </button>;
}

export function SearchGenres({
  client,
  library,
  selectedGenre,
  onSelectGenre,
  onBackToGenres,
  onOpenAlbum,
  onPlayAlbum,
  onPlay,
  onShuffle,
}: {
  client: Navidrome; library: LocalMusicLibrary | null;
  selectedGenre: string | null;
  onSelectGenre?: (genre: string) => void;
  onBackToGenres?: () => void;
  onOpenAlbum: (album: AlbumRecord) => void;
  onPlayAlbum: (album: AlbumRecord) => void;
  onPlay: (songs: Song[]) => void;
  onShuffle: (songs: Song[]) => void;
}) {
  const localGroups = useMemo(() => {
    if (!library) return null;
    const groups = new Map<string, { label: string; songs: Song[] }>();
    for (const song of library.tracks) {
      const label = song.genre?.trim();
      if (!label) continue;
      const group = groups.get(key(label)) ?? { label, songs: [] };
      group.songs.push(song);
      groups.set(key(label), group);
    }
    return groups;
  }, [library]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<string | null>(selectedGenre);
  const [songs, setSongs] = useState<Song[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setSelected(selectedGenre);
    setSongs([]);
    setMore(false);
    setOffset(0);
  }, [selectedGenre]);
  const genreAlbums = useMemo(() => {
    const groups = new Map<string, AlbumRecord>();
    for (const song of songs) {
      const id = song.albumId || `genre-album:${key(song.artist || "")}-${key(song.album || song.title)}`;
      const album = groups.get(id) || {
        id,
        name: song.album || "Unknown album",
        artist: song.albumArtist || song.artist || "Unknown artist",
        artistId: song.artistId,
        coverArt: song.coverArt,
        localArtworkUrl: song.localArtworkUrl,
        year: song.year,
        genre: selected || song.genre,
        source: song.source,
        song: [],
      };
      album.song!.push(song);
      album.songCount = album.song!.length;
      if (!album.coverArt && song.coverArt) album.coverArt = song.coverArt;
      if (!album.localArtworkUrl && song.localArtworkUrl) album.localArtworkUrl = song.localArtworkUrl;
      groups.set(id, album);
    }
    return [...groups.values()];
  }, [selected, songs]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const load = async () => {
      if (!selected) {
        const result = localGroups
          ? [...localGroups.values()].map(({ label, songs }) => ({ value: label, songCount: songs.length, albumCount: 0 }))
          : await client.genres(controller.signal);
        if (controller.signal.aborted) return;
        const unique = new Map(result.filter((genre) => genre.value.trim()).map((genre) => [key(genre.value), genre]));
        setGenres([...unique.values()].sort((a, b) => a.value.localeCompare(b.value)));
      } else {
        const result = localGroups
          ? (localGroups.get(key(selected))?.songs ?? []).slice(offset, offset + 100)
          : await client.songsByGenre(selected, offset, 100, controller.signal);
        if (controller.signal.aborted) return;
        setSongs((previous) => offset ? [...previous, ...result] : result);
        setMore(localGroups ? offset + result.length < (localGroups.get(key(selected))?.songs.length ?? 0) : result.length === 100);
      }
    };
    void load().catch(() => { if (!controller.signal.aborted) setError("Genres could not be loaded. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, localGroups, selected, offset, retry]);

  return <section className="genre-browser" aria-label="Browse Genres">
    {selected ? <>
      <button className="genre-back" onClick={() => {
        if (onBackToGenres) onBackToGenres();
        else { setSelected(null); setOffset(0); }
      }}><ChevronLeft size={16} />Browse Genres</button>
      <div className="genre-detail-header">
        <div>
          <p className="collection-kind">Genre</p>
          <h1>{selected}</h1>
          <p>{songs.length}{more ? "+" : ""} songs · {genreAlbums.length}{more ? "+" : ""} albums</p>
        </div>
        <div className="genre-detail-actions">
          <button className="primary-button" disabled={!songs.length} onClick={() => onPlay(songs)}><Play size={14} fill="currentColor" />Play all</button>
          <button className="secondary-button" disabled={!songs.length} onClick={() => onShuffle(songs)}><Shuffle size={15} />Shuffle all</button>
        </div>
      </div>
      <section className="music-section genre-albums-section">
        <div className="section-heading">
          <h2>Albums</h2>
          <span>From your collection</span>
        </div>
        <AlbumGrid
          albums={genreAlbums}
          client={client}
          onOpen={onOpenAlbum}
          onPlay={onPlayAlbum}
          resultNavigation
        />
      </section>
      {more && !error && <button className="secondary-button" disabled={busy} onClick={() => setOffset(songs.length)}>Load more from this genre</button>}
    </> : <>
      <div className="section-heading"><h2>Browse Genres</h2></div>
      <div className="genre-grid">{genres.map((genre) => <GenreTile key={genre.value} genre={genre} client={client}
        localTracks={localGroups?.get(key(genre.value))?.songs}
        onOpen={() => {
          setSongs([]); setMore(false); setOffset(0);
          if (onSelectGenre) onSelectGenre(genre.value);
          else setSelected(genre.value);
        }} />)}</div>
    </>}
    {busy && <p className="genre-message" role="status">Loading…</p>}
    {error && <p className="genre-message" role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
    {!busy && !error && !(selected ? songs.length : genres.length) && <p className="genre-message">
      {selected ? "No songs in this genre." : "No genres found. Add genre tags to your music to browse them here."}
    </p>}
  </section>;
}
