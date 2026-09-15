import type { AlbumRecord, Artist, Playlist, Song } from "../lib/navidrome";

export type Page =
  | "home"
  | "recent"
  | "played"
  | "albums"
  | "artists"
  | "songs"
  | "folders"
  | "favorites"
  | "playlists"
  | "search"
  | "genre"
  | "album"
  | "artist"
  | "playlist"
  | "settings";
export type SettingsFocus = "external-lyrics" | "local-data" | "recommendation-tuning";
export type Route = {
  page: Page;
  id?: string;
  title?: string;
  focus?: SettingsFocus;
};
export type ContextTarget =
  | { type: "song"; item: Song; x: number; y: number }
  | { type: "album"; item: AlbumRecord; x: number; y: number };
export type PlaylistDraft = {
  playlist?: Playlist;
  song?: Song;
  name: string;
  comment?: string;
  public?: boolean;
};
export const PLAYLIST_DESCRIPTION_MAX_LENGTH = 494;
export type PageData = {
  albums: AlbumRecord[];
  recent: AlbumRecord[];
  recentlyPlayed: AlbumRecord[];
  frequent: AlbumRecord[];
  recommendationCandidates: AlbumRecord[];
  /** Library-wide album pool used for retrieval during ranking. */
  recommendationPool: AlbumRecord[];
  favoriteAlbumIds: string[];
  songs: Song[];
  artists: Artist[];
  playlists: Playlist[];
  recentlyPlayedSongs: Song[];
  artistSongs: Song[];
  album?: AlbumRecord;
  artist?: Artist;
  playlist?: Playlist;
  similarAlbums: AlbumRecord[];
  similarArtists: Artist[];
};
export const EMPTY: PageData = {
  albums: [],
  recent: [],
  recentlyPlayed: [],
  frequent: [],
  recommendationCandidates: [],
  recommendationPool: [],
  favoriteAlbumIds: [],
  songs: [],
  artists: [],
  playlists: [],
  recentlyPlayedSongs: [],
  artistSongs: [],
  similarAlbums: [],
  similarArtists: [],
};
export const SEARCH_ARTIST_PAGE_SIZE = 30;
export const SEARCH_ALBUM_PAGE_SIZE = 50;
export const SEARCH_SONG_PAGE_SIZE = 100;
export const pageHasMore = (page: Page, data: PageData) =>
  page === "albums" || page === "recent" || page === "played"
    ? data.albums.length === 60
    : page === "songs"
      ? data.songs.length === 100
      : page === "search"
        ? data.artists.length === SEARCH_ARTIST_PAGE_SIZE ||
          data.albums.length === SEARCH_ALBUM_PAGE_SIZE ||
          data.songs.length === SEARCH_SONG_PAGE_SIZE
        : false;
