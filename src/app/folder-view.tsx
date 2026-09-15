import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Columns3,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  List,
  Music2,
  Play,
  Search,
  Star,
} from "lucide-react";
import { Artwork, EmptyState, IconButton, Tooltip } from "../components";
import {
  duration,
  isLossless,
  type Navidrome,
  type Song,
} from "../lib/navidrome";
import {
  buildFolderTree,
  collectFolderSongs,
  folderAncestors,
  formatBytes,
  searchFolderTree,
  songFolderPath,
  type FolderNode,
} from "../lib/folder-tree";

type ViewMode = "columns" | "list" | "icons";
type SortMode = "name" | "kind" | "size" | "date";

const VIEW_KEY = "volta-folder-view";
const SORT_KEY = "volta-folder-sort";

const readStored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};

const kindLabel = (song: Song) => {
  const extension = song.suffix?.toUpperCase();
  if (isLossless(song)) return extension ? `${extension} audio` : "Lossless audio";
  return extension ? `${extension} audio` : "Audio";
};

const modifiedLabel = (value?: number) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

type FolderEntry =
  | { kind: "folder"; node: FolderNode }
  | { kind: "song"; song: Song };

const entriesFor = (node: FolderNode): FolderEntry[] => [
  ...node.folders.map((child): FolderEntry => ({ kind: "folder", node: child })),
  ...node.songs.map((song): FolderEntry => ({ kind: "song", song })),
];

const sortEntries = (entries: FolderEntry[], sort: SortMode): FolderEntry[] => {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const nameOf = (entry: FolderEntry) =>
    entry.kind === "folder" ? entry.node.name : entry.song.title;
  const sizeOf = (entry: FolderEntry) =>
    entry.kind === "folder" ? entry.node.totalBytes : entry.song.size || 0;
  const dateOf = (entry: FolderEntry) =>
    entry.kind === "folder"
      ? entry.node.modified || 0
      : entry.song.localModified || 0;
  const kindOf = (entry: FolderEntry) =>
    entry.kind === "folder" ? "Folder" : kindLabel(entry.song);
  return [...entries].sort((left, right) => {
    // Folders stay above songs in every sort, as Finder does.
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    if (sort === "size") return sizeOf(right) - sizeOf(left) || collator.compare(nameOf(left), nameOf(right));
    if (sort === "date") return dateOf(right) - dateOf(left) || collator.compare(nameOf(left), nameOf(right));
    if (sort === "kind")
      return collator.compare(kindOf(left), kindOf(right)) || collator.compare(nameOf(left), nameOf(right));
    return collator.compare(nameOf(left), nameOf(right));
  });
};

export function FolderView({
  client,
  songs,
  loading,
  onPlay,
  onContextMenu,
}: {
  client: Navidrome;
  songs: Song[];
  loading: boolean;
  onPlay: (songs: Song[], index: number) => void;
  onContextMenu?: (event: ReactMouseEvent, song: Song) => void;
}) {
  const tree = useMemo(() => buildFolderTree(songs), [songs]);
  const [view, setView] = useState<ViewMode>(() =>
    readStored(VIEW_KEY, ["columns", "list", "icons"] as const, "columns"),
  );
  const [sort, setSort] = useState<SortMode>(() =>
    readStored(SORT_KEY, ["name", "kind", "size", "date"] as const, "name"),
  );
  const [selectedPath, setSelectedPath] = useState("");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const columnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => writeStored(VIEW_KEY, view), [view]);
  useEffect(() => writeStored(SORT_KEY, sort), [sort]);

  // A folder can disappear when the library refreshes; fall back to its parent
  // rather than rendering an empty view.
  useEffect(() => {
    if (selectedPath && !tree.byPath.has(selectedPath)) setSelectedPath("");
  }, [selectedPath, tree]);

  const selected = tree.byPath.get(selectedPath) || tree.root;
  const chain = useMemo(
    () => folderAncestors(tree, selected.path),
    [tree, selected.path],
  );
  const results = useMemo(
    () => searchFolderTree(tree, search),
    [tree, search],
  );
  const searching = Boolean(search.trim());

  const goTo = useCallback(
    (path: string) => {
      setSelectedPath(path);
      setHistory((previous) => {
        const trimmed = previous.slice(0, historyIndex + 1);
        if (trimmed[trimmed.length - 1] === path) return previous;
        return [...trimmed, path];
      });
      setHistoryIndex((index) => Math.min(index + 1, history.length));
    },
    [history.length, historyIndex],
  );

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    setSelectedPath(history[next]);
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const next = historyIndex + 1;
    setHistoryIndex(next);
    setSelectedPath(history[next]);
  }, [history, historyIndex]);

  const openFolder = useCallback(
    (node: FolderNode) => goTo(node.path),
    [goTo],
  );

  const playFolder = useCallback(
    (node: FolderNode) => {
      const list = collectFolderSongs(node);
      if (list.length) onPlay(list, 0);
    },
    [onPlay],
  );

  const playSong = useCallback(
    (song: Song, folder: FolderNode) => {
      const list = collectFolderSongs(folder);
      const index = list.findIndex((candidate) => candidate.id === song.id);
      onPlay(list, index >= 0 ? index : 0);
    },
    [onPlay],
  );

  // Keep the deepest column in view as the user descends.
  useEffect(() => {
    const element = columnsRef.current;
    if (!element) return;
    element.scrollTo({ left: element.scrollWidth, behavior: "smooth" });
  }, [selected.path, view]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Backspace" && selected.path) {
      event.preventDefault();
      goTo(selected.path.split("/").slice(0, -1).join("/"));
    }
  };

  if (!loading && !tree.hasPaths) {
    return (
      <EmptyState
        title="No folder information"
        message="This library does not expose file paths, so folders cannot be browsed. Songs, albums, and artists are still available."
      />
    );
  }

  const breadcrumb = (
    <nav className="finder-path" aria-label="Folder path">
      <Tooltip label="Library">
        <button className={selected.path ? "" : "current"} onClick={() => goTo("")}>
          <HardDrive size={13} />
          <span>Library</span>
        </button>
      </Tooltip>
      {chain.slice(1).map((node) => (
        <span className="finder-path-step" key={node.path}>
          <ChevronRight size={12} aria-hidden="true" />
          <button
            className={node.path === selected.path ? "current" : ""}
            onClick={() => goTo(node.path)}
          >
            {node.name}
          </button>
        </span>
      ))}
    </nav>
  );

  const toolbar = (
    <div className="finder-toolbar">
      <div className="finder-toolbar-group">
        <IconButton
          label="Back"
          disabled={historyIndex <= 0}
          onClick={goBack}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={historyIndex >= history.length - 1}
          onClick={goForward}
        >
          <ArrowRight size={16} />
        </IconButton>
      </div>
      <div className="finder-toolbar-group finder-view-switcher" role="group" aria-label="Folder view">
        {(
          [
            ["columns", "Columns", <Columns3 size={15} key="c" />],
            ["list", "List", <List size={15} key="l" />],
            ["icons", "Icons", <LayoutGrid size={15} key="i" />],
          ] as const
        ).map(([mode, label, icon]) => (
          <Tooltip label={label} key={mode}>
            <button
              className={view === mode ? "selected" : ""}
              aria-pressed={view === mode}
              aria-label={label}
              onClick={() => setView(mode)}
            >
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <label className="finder-sort">
        <span className="visually-hidden">Sort folders by</span>
        <select
          aria-label="Sort folders by"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
        >
          <option value="name">Name</option>
          <option value="kind">Kind</option>
          <option value="size">Size</option>
          <option value="date">Date Modified</option>
        </select>
      </label>
      <label className="finder-search">
        <Search size={14} />
        <input
          aria-label="Search folders and songs"
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
    </div>
  );

  const songRow = (song: Song, folder: FolderNode) => (
    <Tooltip label={song.title} key={song.id}>
      <button
        className="finder-song"
        onClick={() => playSong(song, folder)}
        onContextMenu={(event) => onContextMenu?.(event, song)}
      >
        <Artwork
          client={client}
          id={song.coverArt}
          imageUrl={song.localArtworkUrl}
          size={80}
        />
        <span className="finder-song-copy">
          <b>{song.title}</b>
          <small>{song.artist || "Unknown artist"}</small>
        </span>
        <span className="finder-song-time">{duration(song.duration)}</span>
      </button>
    </Tooltip>
  );

  const folderRow = (
    node: FolderNode,
    active: boolean,
    onOpen: () => void,
  ) => (
    <Tooltip label={node.name} key={node.path}>
      <button
        className={"finder-folder" + (active ? " selected" : "")}
        onClick={onOpen}
        onDoubleClick={() => playFolder(node)}
      >
        {active ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span className="finder-folder-name">{node.name}</span>
        <span className="finder-folder-count">{node.totalSongs}</span>
        <ChevronRight size={13} className="finder-folder-chevron" aria-hidden="true" />
      </button>
    </Tooltip>
  );

  const columnsView = (
    <div className="finder-columns" ref={columnsRef}>
      {chain.map((node, columnIndex) => {
        const next = chain[columnIndex + 1];
        const entries = sortEntries(entriesFor(node), sort);
        return (
          <div className="finder-column" key={node.path || "root"}>
            {entries.length === 0 && (
              <p className="finder-column-empty">Empty</p>
            )}
            {entries.map((entry) =>
              entry.kind === "folder"
                ? folderRow(entry.node, next?.path === entry.node.path, () =>
                    openFolder(entry.node),
                  )
                : songRow(entry.song, node),
            )}
          </div>
        );
      })}
    </div>
  );

  const currentEntries = sortEntries(entriesFor(selected), sort);

  const listView = (
    <div className="finder-list">
      <div className="finder-list-heading">
        <span>Name</span>
        <span>Date Modified</span>
        <span>Size</span>
        <span>Kind</span>
      </div>
      {currentEntries.map((entry) =>
        entry.kind === "folder" ? (
          <div className="finder-list-row" key={entry.node.path}>
            <button
              className="finder-list-name"
              onClick={() => openFolder(entry.node)}
              onDoubleClick={() => playFolder(entry.node)}
            >
              <Folder size={15} />
              <span>{entry.node.name}</span>
            </button>
            <span>{modifiedLabel(entry.node.modified)}</span>
            <span>{formatBytes(entry.node.totalBytes)}</span>
            <span>Folder — {entry.node.totalSongs} songs</span>
          </div>
        ) : (
          <div
            className="finder-list-row"
            key={entry.song.id}
            onContextMenu={(event) => onContextMenu?.(event, entry.song)}
          >
            <button
              className="finder-list-name"
              onClick={() => playSong(entry.song, selected)}
            >
              <Music2 size={15} />
              <span>{entry.song.title}</span>
            </button>
            <span>{modifiedLabel(entry.song.localModified)}</span>
            <span>{formatBytes(entry.song.size || 0)}</span>
            <span>{kindLabel(entry.song)}</span>
          </div>
        ),
      )}
      {currentEntries.length === 0 && (
        <p className="finder-column-empty">This folder is empty.</p>
      )}
    </div>
  );

  const iconsView = (
    <div className="finder-icons">
      {currentEntries.map((entry) =>
        entry.kind === "folder" ? (
          <button
            className="finder-icon"
            key={entry.node.path}
            onClick={() => openFolder(entry.node)}
            onDoubleClick={() => playFolder(entry.node)}
          >
            <Folder size={54} strokeWidth={1.1} />
            <span>{entry.node.name}</span>
            <small>{entry.node.totalSongs} songs</small>
          </button>
        ) : (
          <button
            className="finder-icon"
            key={entry.song.id}
            onClick={() => playSong(entry.song, selected)}
            onContextMenu={(event) => onContextMenu?.(event, entry.song)}
          >
            <Artwork
              client={client}
              id={entry.song.coverArt}
              imageUrl={entry.song.localArtworkUrl}
              size={200}
            />
            <span>{entry.song.title}</span>
            <small>{entry.song.artist || "Unknown artist"}</small>
          </button>
        ),
      )}
      {currentEntries.length === 0 && (
        <p className="finder-column-empty">This folder is empty.</p>
      )}
    </div>
  );

  const searchView = (
    <div className="finder-search-results">
      {results.folders.length > 0 && (
        <section className="finder-result-group">
          <h3>Folders</h3>
          <div className="finder-result-list">
            {results.folders.map((node) => (
              <button
                className="finder-result"
                key={node.path}
                onClick={() => {
                  setSearch("");
                  goTo(node.path);
                }}
              >
                <Folder size={15} />
                <span className="finder-result-name">{node.name}</span>
                <span className="finder-result-path">{node.path}</span>
                <span className="finder-result-meta">{node.totalSongs} songs</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {results.songs.length > 0 && (
        <section className="finder-result-group">
          <h3>Songs</h3>
          <div className="finder-result-list">
            {results.songs.map(({ song, folder }) => (
              <button
                className="finder-result"
                key={song.id}
                onClick={() => playSong(song, folder)}
                onContextMenu={(event) => onContextMenu?.(event, song)}
              >
                <Music2 size={15} />
                <span className="finder-result-name">{song.title}</span>
                <span className="finder-result-path">
                  {songFolderPath(song) || "Library"}
                </span>
                <span className="finder-result-meta">
                  {song.artist || "Unknown artist"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {results.folders.length === 0 && results.songs.length === 0 && (
        <EmptyState
          title="No matches"
          message={`Nothing in your folders matches “${search.trim()}”.`}
        />
      )}
    </div>
  );

  const previewSongs = selected.songs.slice(0, 6);

  return (
    <div className="finder" onKeyDown={onKeyDown} tabIndex={-1}>
      {toolbar}
      {searching ? (
        searchView
      ) : (
        <div className="finder-body">
          <div className="finder-main">
            {view === "columns" && columnsView}
            {view === "list" && listView}
            {view === "icons" && iconsView}
          </div>
          <aside className="finder-preview" aria-label="Folder details">
            <div className="finder-preview-icon">
              {selected.path ? (
                <FolderOpen size={62} strokeWidth={1} />
              ) : (
                <HardDrive size={62} strokeWidth={1} />
              )}
            </div>
            <h2>{selected.path ? selected.name : "Library"}</h2>
            <p className="finder-preview-kind">
              Folder — {selected.totalSongs} songs
            </p>
            <dl className="finder-preview-meta">
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(selected.totalBytes)}</dd>
              </div>
              <div>
                <dt>Subfolders</dt>
                <dd>{selected.folders.length}</dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{modifiedLabel(selected.modified)}</dd>
              </div>
            </dl>
            <div className="finder-preview-actions">
              <button
                className="secondary-button"
                disabled={selected.totalSongs === 0}
                onClick={() => playFolder(selected)}
              >
                <Play size={14} fill="currentColor" />
                Play folder
              </button>
            </div>
            {previewSongs.length > 0 && (
              <div className="finder-preview-songs">
                <h3>In this folder</h3>
                {previewSongs.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => playSong(song, selected)}
                    onContextMenu={(event) => onContextMenu?.(event, song)}
                  >
                    <Music2 size={12} />
                    <span>{song.title}</span>
                  </button>
                ))}
                {selected.songs.length > previewSongs.length && (
                  <small>
                    +{selected.songs.length - previewSongs.length} more
                  </small>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      {breadcrumb}
    </div>
  );
}
