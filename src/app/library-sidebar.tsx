import type { RefObject } from "react";
import {
  ChevronRight,
  CircleUserRound,
  Disc3,
  Folder,
  Github,
  Grid2X2,
  House,
  ListMusic,
  Mic2,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  Star,
  X,
} from "lucide-react";
import { Artwork, IconButton, Tooltip } from "../components";
import type { Navidrome, Playlist } from "../lib/navidrome";
import type { Route } from "./app-model";
import type { Pin } from "./app-storage";

type Navigate = (next: Route, nextQuery?: string) => void;
type Props = {
  account: { username: string };
  active: (page: Route["page"]) => string;
  alternateVersionUrl: string;
  client: Navidrome;
  collapsed: boolean;
  collapseShortcut: string;
  isBetaHost: boolean;
  modifierLabel: string;
  navigate: Navigate;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
  pinKey: (pin: Pin) => string;
  pins: Pin[];
  route: Route;
  searchRef: RefObject<HTMLInputElement>;
  showSearch: () => void;
  sidebarPlaylists: Playlist[];
  sourceMode: "navidrome" | "local";
  togglePin: (pin: Pin) => void;
  warmSection: (section: "albums" | "artists" | "songs") => void;
};

export function LibrarySidebar({
  account,
  active,
  alternateVersionUrl,
  client,
  collapsed,
  collapseShortcut,
  isBetaHost,
  modifierLabel,
  navigate,
  onCloseMobile,
  onToggleCollapsed,
  pinKey,
  pins,
  route,
  searchRef,
  showSearch,
  sidebarPlaylists,
  sourceMode,
  togglePin,
  warmSection,
}: Props) {
  // Collapsed rows keep their icon only, so the label moves to a tooltip.
  const hint = (label: string) => (collapsed ? label : undefined);
  return (
    <aside className="library-sidebar">
      <div className="sidebar-brand">
        <img className="brand-bolt" src="/volta-bolt.svg" alt="" />
        <span>Volta</span>
        {isBetaHost && <small className="beta-brand-label">(beta)</small>}
        <IconButton
          className="sidebar-collapse-button"
          label={collapsed ? "Expand navigation" : "Collapse navigation"}
          tooltip={`${collapsed ? "Expand" : "Collapse"} navigation (${collapseShortcut})`}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </IconButton>
        <IconButton label="Close navigation" onClick={onCloseMobile}>
          <X size={18} />
        </IconButton>
      </div>
      <Tooltip label={hint("Search")}>
        <button
          className={
            "sidebar-search sidebar-search-button" +
            (["search", "genre"].includes(route.page) ? " selected" : "")
          }
          aria-current={["search", "genre"].includes(route.page) ? "page" : undefined}
          onClick={() => {
            showSearch();
            onCloseMobile();
            searchRef.current?.focus();
          }}
        >
          <Search size={15} />
          <span>Search</span>
          <kbd aria-hidden="true">{modifierLabel} K</kbd>
        </button>
      </Tooltip>
      <nav aria-label="Music navigation">
        <Tooltip label={hint("Home")}>
          <button className={active("home")} onClick={() => navigate({ page: "home" })}>
            <House />
            <span>Home</span>
          </button>
        </Tooltip>
        <Tooltip label={hint("New in Your Library")}>
          <button className={active("recent")} onClick={() => navigate({ page: "recent" })}>
            <Grid2X2 />
            <span>New in Your Library</span>
          </button>
        </Tooltip>
        <h2>Library</h2>
        <Tooltip label={hint("Albums")}>
          <button
            className={active("albums")}
            onPointerEnter={() => warmSection("albums")}
            onFocus={() => warmSection("albums")}
            onClick={() => navigate({ page: "albums" })}
          >
            <Disc3 />
            <span>Albums</span>
          </button>
        </Tooltip>
        <Tooltip label={hint("Artists")}>
          <button
            className={active("artists")}
            onPointerEnter={() => warmSection("artists")}
            onFocus={() => warmSection("artists")}
            onClick={() => navigate({ page: "artists" })}
          >
            <Mic2 />
            <span>Artists</span>
          </button>
        </Tooltip>
        <Tooltip label={hint("Songs")}>
          <button
            className={active("songs")}
            onPointerEnter={() => warmSection("songs")}
            onFocus={() => warmSection("songs")}
            onClick={() => navigate({ page: "songs" })}
          >
            <Music2 />
            <span>Songs</span>
          </button>
        </Tooltip>
        <Tooltip label={hint("Folders")}>
          <button
            className={active("folders")}
            aria-current={route.page === "folders" ? "page" : undefined}
            onClick={() => navigate({ page: "folders" })}
          >
            <Folder />
            <span>Folders</span>
          </button>
        </Tooltip>
        <Tooltip label={hint("Favorites")}>
          <button
            className={active("favorites")}
            aria-current={route.page === "favorites" ? "page" : undefined}
            onClick={() => navigate({ page: "favorites" })}
          >
            <Star />
            <span>Favorites</span>
          </button>
        </Tooltip>
        <h2>Playlists</h2>
        <Tooltip label={hint("All Playlists")}>
          <button className={active("playlists")} onClick={() => navigate({ page: "playlists" })}>
            <ListMusic />
            <span>All Playlists</span>
          </button>
        </Tooltip>
        {sourceMode === "navidrome" &&
          sidebarPlaylists.map((playlist) => (
            <Tooltip label={hint(playlist.name)} key={playlist.id}>
              <button
                className={
                  route.page === "playlist" && route.id === playlist.id ? "selected" : ""
                }
                onClick={() =>
                  navigate({ page: "playlist", id: playlist.id, title: playlist.name })
                }
              >
                <Artwork client={client} id={playlist.coverArt} size={60} eager />
                <span>{playlist.name}</span>
              </button>
            </Tooltip>
          ))}
        {pins.length > 0 && (
          <>
            <h2>Pinned</h2>
            {pins.map((pin) => (
              <div className="sidebar-pin" key={pinKey(pin)}>
                <Tooltip label={hint(pin.name)}>
                  <button
                    className={
                      (route.page === pin.kind && route.id === pin.id
                        ? "selected"
                        : "") + " sidebar-pin-open"
                    }
                    onClick={() =>
                      navigate({ page: pin.kind, id: pin.id, title: pin.name })
                    }
                  >
                    {pin.coverArt || pin.imageUrl ? (
                      <Artwork
                        client={client}
                        id={pin.coverArt}
                        imageUrl={pin.imageUrl}
                        size={60}
                        eager
                      />
                    ) : pin.kind === "album" ? (
                      <Disc3 />
                    ) : pin.kind === "artist" ? (
                      <Mic2 />
                    ) : (
                      <ListMusic />
                    )}
                    <span>{pin.name}</span>
                  </button>
                </Tooltip>
                <IconButton label={`Unpin ${pin.name}`} onClick={() => togglePin(pin)}>
                  <X size={13} />
                </IconButton>
              </div>
            ))}
          </>
        )}
      </nav>
      <Tooltip label={hint("View source code")}>
        <a
          className="sidebar-source-link"
          href="https://github.com/countervolts/Volta-Player"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={13} aria-hidden="true" />
          View source code <span aria-hidden="true">↗</span>
        </a>
      </Tooltip>
      <Tooltip label={hint("Join the Discord")}>
        <a
          className="sidebar-source-link sidebar-discord-link"
          href="https://discord.gg/h5Hybq9SJs"
          target="_blank"
          rel="noreferrer"
        >
          Join the Discord <span aria-hidden="true">↗</span>
        </a>
      </Tooltip>
      <Tooltip label="Sign in again on the other channel">
        <a
          className="version-switch-link"
          href={alternateVersionUrl}
          target="_blank"
          rel="opener"
          aria-label={`Try the ${isBetaHost ? "stable" : "beta"} version; sign in again on the other channel`}
        >
          Try the {isBetaHost ? "stable" : "beta"} version <span aria-hidden="true">↗</span>
        </a>
      </Tooltip>
      <Tooltip label={hint("Settings")}>
        <button
          className={"settings-button" + (route.page === "settings" ? " selected" : "")}
          aria-current={route.page === "settings" ? "page" : undefined}
          onClick={() => navigate({ page: "settings" })}
        >
          <Settings2 size={17} />
          <span>Settings</span>
          <ChevronRight size={15} className="settings-button-chevron" />
        </button>
      </Tooltip>
      <Tooltip label={hint(account.username)}>
      <div className="account-button">
        <CircleUserRound size={26} />
        <span>
          {account.username}
          <small>{sourceMode === "local" ? "This device" : "Navidrome"}</small>
        </span>
      </div>
      </Tooltip>
    </aside>
  );
}
