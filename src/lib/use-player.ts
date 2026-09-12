import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isLocalSong, Navidrome, type Song } from "./navidrome";
import {
  createListeningEvent,
  listeningHistoryKey,
  type ListeningEvent,
  type ListeningEventKind,
} from "./listening-history";
import {
  AlacPlayback,
  type AlacRequest,
  type AlacTrack,
} from "./alac-playback";

export type Repeat = "off" | "all" | "one";
export type PlaybackSession = {
  queue: Song[];
  currentIndex: number;
  position: number;
  shuffle: boolean;
  repeat: Repeat;
  original: boolean;
  wasPlaying: boolean;
};
type PlayerState = {
  queue: Song[];
  currentIndex: number;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  original: boolean;
  activeStream: "original" | "compatible";
  shuffle: boolean;
  repeat: Repeat;
};
type Entry = { key: number; song: Song };
type Listen = {
  song: Song;
  client: Navidrome;
  seconds: number;
  reportedSeconds: number;
  mediaTime: number;
  wallTime: number;
  active: boolean;
  announced: boolean;
  submitted: boolean;
  finished: boolean;
  sessionId: string;
  sessionIndex: number;
};
export type PlaybackEventHandler = (
  event: ListeningEvent,
  storageKey: string,
) => void;
type WarmDeck = {
  index: number;
  entryKey: number;
  audio: HTMLAudioElement;
  ready: boolean;
  readyListener: EventListener;
};
const WARM_DECK_COUNT = 2;
const HANDOFF_LEAD_SECONDS = 0.01;
const HANDOFF_POLL_MS = 4;
const LISTENING_SESSION_GAP_MS = 20 * 60 * 1000;
let listeningSessionSequence = 0;

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const shuffled = <T>(items: T[]): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

// The controller owns transient audio state. React receives only display changes;
// events and Media Session actions always read the current queue and source.
class PlaybackController {
  private state: PlayerState = {
    queue: [],
    currentIndex: -1,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    original: true,
    activeStream: "original",
    shuffle: false,
    repeat: "off",
  };
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private client: Navidrome | null = null;
  private entries: Entry[] = [];
  private orderedEntries: Entry[] = [];
  private entryKey = 0;
  private sourceVersion = 0;
  private playVersion = 0;
  private reportedErrorVersion = -1;
  private desiredPlaying = false;
  private pendingSeek: number | null = null;
  private listen: Listen | null = null;
  private handoffTimer: number | null = null;
  private loadTimer: number | null = null;
  private compatibleFallbackUsed = false;
  private usingAlacDecoder = false;
  private readonly nativeAlacFallbackSongs = new Set<string>();
  private audioObjectUrls = new Map<HTMLAudioElement, string>();
  private audioFetchControllers = new Map<HTMLAudioElement, AbortController>();
  // Separate decoder/network decks keep the next two tracks warm. HTML media
  // does not offer a sample-perfect queue player, but promotion of a ready deck
  // avoids a new request and metadata wait at the boundary.
  private standby: WarmDeck[] = [];
  private alac: AlacPlayback;
  private listeningSessionId = "";
  private listeningSessionIndex = -1;
  private lastListeningActivity = 0;

  constructor(
    private onError: (message: string) => void,
    private onPlaybackEvent: PlaybackEventHandler = () => {},
  ) {
    this.alac = new AlacPlayback({
      loading: () => this.update({ loading: true, playing: false }),
      ready: (track) => this.alacReady(track),
      started: (track, position) => this.alacStarted(track, position),
      paused: (track, position) => this.alacPaused(track, position),
      time: (track, position) => this.alacTime(track, position),
      boundary: (track) => this.alacBoundary(track),
      ended: (track) => this.alacEnded(track),
      error: (error) => this.alacFailed(error),
    });
  }

  setErrorHandler(onError: (message: string) => void) {
    this.onError = onError;
  }

  setPlaybackEventHandler(onPlaybackEvent: PlaybackEventHandler) {
    this.onPlaybackEvent = onPlaybackEvent;
  }

  private isAlacCandidate(song?: Song) {
    const suffix = song?.suffix?.toLowerCase().replace(/^\./, "");
    const contentType = song?.contentType?.toLowerCase().split(";", 1)[0].trim();
    return (
      suffix === "alac" ||
      suffix === "m4a" ||
      suffix === "mp4" ||
      contentType === "audio/alac" ||
      contentType === "audio/x-alac" ||
      contentType === "audio/mp4" ||
      contentType === "audio/x-m4a"
    );
  }

  private shouldUseAlac(song = this.current) {
    return Boolean(
      this.state.original &&
      song &&
      this.isAlacCandidate(song) &&
      !this.nativeAlacFallbackSongs.has(song.id),
    );
  }

  private alacRequest(index = this.state.currentIndex): AlacRequest | null {
    const song = this.entries[index]?.song;
    if (!song || !this.client || !this.shouldUseAlac(song)) return null;
    return { index, song, url: this.client.stream(song, true) };
  }

  private playbackTime() {
    return this.usingAlacDecoder
      ? this.alac.currentTime()
      : this.audio?.currentTime ?? this.state.currentTime;
  }

  private playbackDuration() {
    return this.usingAlacDecoder
      ? this.alac.duration()
      : finite(this.audio?.duration ?? this.state.duration, this.state.duration);
  }

  private alacReady(track: AlacTrack) {
    if (!this.usingAlacDecoder) return;
    this.update({ duration: track.buffer.duration, loading: false });
    this.positionState();
  }

  private alacStarted(track: AlacTrack, position: number) {
    if (!this.usingAlacDecoder) return;
    this.update({
      currentIndex: track.index,
      currentTime: position,
      duration: track.buffer.duration,
      loading: false,
      playing: true,
    });
    this.baseline();
    if (this.listen) {
      this.listen.active = true;
      if (!this.listen.announced) {
        this.listen.announced = true;
        this.emitListeningEvent("start", "play");
        if (!isLocalSong(this.listen.song))
          void this.listen.client.scrobble(this.listen.song, false).catch(() => {
            /* Playback can continue if history is unavailable. */
          });
      } else {
        this.emitListeningEvent("resume", "resume");
      }
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
    this.positionState();
  }

  private alacPaused(track: AlacTrack, position: number) {
    if (!this.usingAlacDecoder) return;
    this.finishListening("pause", "pause");
    this.desiredPlaying = false;
    this.update({
      currentIndex: track.index,
      currentTime: position,
      duration: track.buffer.duration,
      loading: false,
      playing: false,
    });
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = this.current ? "paused" : "none";
    this.positionState();
  }

  private alacTime(track: AlacTrack, position: number) {
    if (!this.usingAlacDecoder) return;
    this.sampleListen();
    this.update({
      currentIndex: track.index,
      currentTime: Math.floor(position * 4) / 4,
      duration: track.buffer.duration,
    });
    this.positionState();
  }

  private alacBoundary(track: AlacTrack) {
    if (!this.usingAlacDecoder) return;
    this.finishListening("complete", "boundary");
    this.update({
      currentIndex: track.index,
      currentTime: 0,
      duration: track.buffer.duration,
      playing: true,
      loading: false,
    });
    this.resetListen();
    this.baseline();
    this.setMetadata();
    this.primeUpcoming();
  }

  private alacEnded(track: AlacTrack) {
    if (!this.usingAlacDecoder || !this.desiredPlaying) return;
    const nextIndex = this.automaticNextIndex();
    if (nextIndex === null) {
      this.finishListening("complete", "ended");
      this.pause();
      return;
    }
    this.select(nextIndex, true, "complete");
  }

  private alacFailed(error: unknown) {
    if (!this.usingAlacDecoder) return;
    const message = error instanceof Error ? error.message : "ALAC playback failed.";
    const song = this.current;
    if (song && message.includes("not an ALAC M4A stream")) {
      const position = this.playbackTime();
      const autoplay = this.desiredPlaying;
      this.nativeAlacFallbackSongs.add(song.id);
      this.usingAlacDecoder = false;
      this.loadCurrent(position, autoplay, true);
      return;
    }
    this.usingAlacDecoder = false;
    this.desiredPlaying = false;
    this.finishListening("stop", "playback-error");
    this.update({ loading: false, playing: false });
    this.reportError(`ALAC decoder failed: ${message}`);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;

  private update(patch: Partial<PlayerState>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.state[key as keyof PlayerState] === value,
      )
    )
      return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private clearLoadTimer() {
    if (this.loadTimer !== null) {
      window.clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  private armLoadTimer() {
    this.clearLoadTimer();
    const source = this.sourceVersion;
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = null;
      const audio = this.audio;
      const song = this.current;
      if (!audio || !song || source !== this.sourceVersion || !this.desiredPlaying || audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
      if (
        this.state.original &&
        !this.compatibleFallbackUsed &&
        this.client &&
        !isLocalSong(song)
      ) {
        this.compatibleFallbackUsed = true;
        this.sourceVersion++;
        this.playVersion++;
        audio.pause();
        audio.src = this.client.stream(song, false);
        audio.load();
        this.update({
          activeStream: "compatible",
          loading: true,
          playing: false,
        });
        this.armLoadTimer();
        this.play();
        return;
      }
      this.desiredPlaying = false;
      this.update({ loading: false, playing: false });
      this.reportError(this.playbackError());
    }, 10000);
  }

  private needsMediaBridge(url: string) {
    try {
      const target = new URL(url);
      return (
        location.protocol === "https:" &&
        target.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(target.hostname)
      );
    } catch {
      return false;
    }
  }

  private releaseAudioSource(audio: HTMLAudioElement) {
    this.audioFetchControllers.get(audio)?.abort();
    this.audioFetchControllers.delete(audio);
    const objectUrl = this.audioObjectUrls.get(audio);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    this.audioObjectUrls.delete(audio);
  }

  private async attachAudioSource(
    audio: HTMLAudioElement,
    url: string,
    source?: number,
  ) {
    this.releaseAudioSource(audio);
    if (!this.needsMediaBridge(url)) {
      audio.src = url;
      audio.load();
      return;
    }
    const controller = new AbortController();
    this.audioFetchControllers.set(audio, controller);
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    const blob = await response.blob();
    if (source !== undefined && (source !== this.sourceVersion || controller.signal.aborted)) return;
    const objectUrl = URL.createObjectURL(blob);
    this.audioObjectUrls.set(audio, objectUrl);
    audio.src = objectUrl;
    audio.load();
  }

  private get current() {
    return this.entries[this.state.currentIndex]?.song;
  }

  setClient(client: Navidrome | null) {
    if (client === this.client) return;
    if (
      client &&
      this.client &&
      client.server === this.client.server &&
      client.username === this.client.username &&
      client.auth.token === this.client.auth.token
    ) {
      // HMR/reconnect may create a new client object. Keep live audio alive.
      this.client = client;
      this.setMetadata();
      return;
    }
    this.stop();
    this.client = client;
  }

  mount = () => {
    if (this.audio) return () => {};
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = this.state.volume;
    this.audio = audio;
    this.attachPlaybackListeners(audio);
    const flushOnPageHide = () => {
      if (this.listen && this.desiredPlaying)
        this.finishListening("stop", "pagehide");
    };
    window.addEventListener("pagehide", flushOnPageHide);
    const actions: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: this.play,
      pause: this.pause,
      stop: this.stop,
      previoustrack: this.previous,
      nexttrack: this.next,
      seekto: (details) => {
        if (details.seekTime !== undefined) this.seek(details.seekTime);
      },
      seekbackward: (details) =>
        this.seek((this.audio?.currentTime ?? 0) - (details.seekOffset ?? 10)),
      seekforward: (details) =>
        this.seek((this.audio?.currentTime ?? 0) + (details.seekOffset ?? 10)),
    };
    const media = navigator.mediaSession;
    if (media) {
      Object.entries(actions).forEach(([action, handler]) => {
        try {
          media.setActionHandler(action as MediaSessionAction, handler);
        } catch {
          /* Optional browser action. */
        }
      });
    }
    return () => {
      // During Vite Fast Refresh, keep the live audio element and controller.
      // A normal application teardown still stops playback and releases it.
      if (import.meta.hot) return;
      window.removeEventListener("pagehide", flushOnPageHide);
      this.stop();
      this.detachPlaybackListeners(this.audio);
      this.audio = null;
      if (media) {
        Object.keys(actions).forEach((action) => {
          try {
            media.setActionHandler(action as MediaSessionAction, null);
          } catch {
            /* Optional browser action. */
          }
        });
        media.metadata = null;
        media.playbackState = "none";
      }
    };
  };

  private attachPlaybackListeners(audio: HTMLAudioElement) {
    audio.addEventListener("timeupdate", this.timeUpdate);
    audio.addEventListener("loadedmetadata", this.metadataLoaded);
    audio.addEventListener("durationchange", this.metadataLoaded);
    audio.addEventListener("playing", this.didPlay);
    audio.addEventListener("pause", this.didPause);
    audio.addEventListener("waiting", this.waiting);
    audio.addEventListener("stalled", this.stalled);
    audio.addEventListener("ended", this.ended);
    audio.addEventListener("error", this.failed);
    audio.addEventListener("seeking", this.seeking);
    audio.addEventListener("seeked", this.seeked);
    audio.addEventListener("ratechange", this.positionState);
  }

  private detachPlaybackListeners(audio: HTMLAudioElement | null) {
    if (!audio) return;
    audio.removeEventListener("timeupdate", this.timeUpdate);
    audio.removeEventListener("loadedmetadata", this.metadataLoaded);
    audio.removeEventListener("durationchange", this.metadataLoaded);
    audio.removeEventListener("playing", this.didPlay);
    audio.removeEventListener("pause", this.didPause);
    audio.removeEventListener("waiting", this.waiting);
    audio.removeEventListener("stalled", this.stalled);
    audio.removeEventListener("ended", this.ended);
    audio.removeEventListener("error", this.failed);
    audio.removeEventListener("seeking", this.seeking);
    audio.removeEventListener("seeked", this.seeked);
    audio.removeEventListener("ratechange", this.positionState);
  }

  private automaticNextIndex() {
    if (!this.entries.length) return null;
    if (this.state.repeat === "one") return this.state.currentIndex;
    if (this.state.currentIndex < this.entries.length - 1)
      return this.state.currentIndex + 1;
    return this.state.repeat === "all" ? 0 : null;
  }

  private clearStandby() {
    const standby = this.standby;
    this.standby = [];
    standby.forEach((deck) => {
      deck.audio.removeEventListener("canplay", deck.readyListener);
      deck.audio.removeEventListener("canplaythrough", deck.readyListener);
      deck.audio.pause();
      this.releaseAudioSource(deck.audio);
      deck.audio.removeAttribute("src");
      deck.audio.load();
    });
  }

  private upcomingIndexes() {
    if (!this.entries.length || this.state.repeat === "one") return [];
    const indexes: number[] = [];
    for (let offset = 1; offset <= WARM_DECK_COUNT; offset++) {
      let index = this.state.currentIndex + offset;
      if (index >= this.entries.length) {
        if (this.state.repeat !== "all") break;
        index %= this.entries.length;
      }
      if (index === this.state.currentIndex || indexes.includes(index)) break;
      indexes.push(index);
    }
    return indexes;
  }

  private primeUpcoming() {
    if (this.usingAlacDecoder) {
      this.clearStandby();
      const nextIndex = this.automaticNextIndex();
      this.alac.setNext(nextIndex === null ? null : this.alacRequest(nextIndex));
      return;
    }
    this.alac.setNext(null);
    if (!this.client) {
      this.clearStandby();
      return;
    }
    const desired = this.upcomingIndexes()
      .map((index) => ({ index, entry: this.entries[index] }))
      .filter(({ entry }) => Boolean(entry));
    const desiredKeys = new Set(desired.map(({ entry }) => entry.key));
    this.standby = this.standby.filter((deck) => {
      const keep = desiredKeys.has(deck.entryKey);
      if (!keep) {
        deck.audio.removeEventListener("canplay", deck.readyListener);
        deck.audio.removeEventListener("canplaythrough", deck.readyListener);
        deck.audio.pause();
        deck.audio.removeAttribute("src");
        deck.audio.load();
      }
      return keep;
    });
    desired.forEach(({ index, entry }) => {
      if (this.standby.some((deck) => deck.entryKey === entry.key)) return;
      const audio = new Audio();
      audio.preload = "auto";
      audio.volume = this.state.volume;
      const standby: WarmDeck = {
        index,
        entryKey: entry.key,
        audio,
        ready: audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
        readyListener: () => {
          if (this.standby.includes(standby)) standby.ready = true;
        },
      };
      audio.addEventListener("canplay", standby.readyListener, { once: true });
      audio.addEventListener("canplaythrough", standby.readyListener, {
        once: true,
      });
      void this.attachAudioSource(
        audio,
        this.client!.stream(entry.song, this.state.original),
      ).catch(() => undefined);
      this.standby.push(standby);
    });
  }

  private promoteStandby(
    nextIndex: number,
    endKind: "skip" | "complete" = "skip",
  ) {
    const standby = this.standby.find((deck) => deck.index === nextIndex);
    if (
      !standby ||
      !standby.ready ||
      standby.index !== nextIndex ||
      standby.entryKey !== this.entries[nextIndex]?.key
    )
      return false;
    this.finishListening(
      endKind,
      endKind === "complete" ? "automatic-complete" : "manual-next",
    );
    const outgoing = this.audio;
    this.detachPlaybackListeners(outgoing);
    if (outgoing) {
      outgoing.pause();
      this.releaseAudioSource(outgoing);
      outgoing.removeAttribute("src");
      outgoing.load();
    }
    standby.audio.removeEventListener("canplay", standby.readyListener);
    standby.audio.removeEventListener("canplaythrough", standby.readyListener);
    this.standby = this.standby.filter((deck) => deck !== standby);
    this.audio = standby.audio;
    this.attachPlaybackListeners(standby.audio);
    this.sourceVersion++;
    this.playVersion++;
    this.compatibleFallbackUsed = false;
    this.pendingSeek = null;
    this.update({
      currentIndex: nextIndex,
      currentTime: 0,
      duration: finite(
        standby.audio.duration,
        this.entries[nextIndex].song.duration ?? 0,
      ),
      playing: false,
      loading: true,
      activeStream: this.state.original ? "original" : "compatible",
    });
    this.resetListen();
    this.baseline();
    this.clearLoadTimer();
    this.setMetadata();
    this.primeUpcoming();
    this.play();
    return true;
  }

  private startHandoffMonitor() {
    if (this.handoffTimer !== null) return;
    this.handoffTimer = window.setInterval(
      this.checkHandoff,
      HANDOFF_POLL_MS,
    );
  }

  private stopHandoffMonitor() {
    if (this.handoffTimer === null) return;
    window.clearInterval(this.handoffTimer);
    this.handoffTimer = null;
  }

  private checkHandoff = () => {
    const audio = this.audio;
    if (!audio || !this.desiredPlaying || audio.paused || audio.ended) return;
    const nextIndex = this.automaticNextIndex();
    if (
      nextIndex === null ||
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0 ||
      audio.duration - audio.currentTime > HANDOFF_LEAD_SECONDS
    )
      return;
    if (this.promoteStandby(nextIndex, "complete")) this.stopHandoffMonitor();
  };

  private ensureListeningSession() {
    const now = Date.now();
    if (
      !this.listeningSessionId ||
      now - this.lastListeningActivity > LISTENING_SESSION_GAP_MS
    ) {
      listeningSessionSequence += 1;
      this.listeningSessionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${now}-${listeningSessionSequence}`;
      this.listeningSessionIndex = -1;
    }
    this.listeningSessionIndex += 1;
    return {
      id: this.listeningSessionId,
      index: this.listeningSessionIndex,
    };
  }

  private emitListeningEvent(
    kind: ListeningEventKind,
    reason: string,
    seekDeltaSeconds?: number,
    countDelta = true,
  ) {
    const listen = this.listen;
    if (!listen) return;
    if (listen.finished) return;
    const totalSeconds = this.playbackTime();
    const total = Math.max(0, finite(listen.seconds, totalSeconds));
    const deltaSeconds = Math.max(0, total - listen.reportedSeconds);
    if (countDelta) listen.reportedSeconds = total;
    const event = createListeningEvent(listen.song, {
      kind,
      sessionId: listen.sessionId,
      sessionIndex: listen.sessionIndex,
      durationSeconds: this.playbackDuration() || listen.song.duration,
      deltaSeconds: countDelta ? deltaSeconds : 0,
      totalSeconds: total,
      positionSeconds: totalSeconds,
      source: isLocalSong(listen.song) ? "local" : "navidrome",
      queueIndex: this.state.currentIndex,
      shuffle: this.state.shuffle,
      repeat: this.state.repeat,
      reason,
      seekDeltaSeconds,
    });
    this.lastListeningActivity = event.at;
    this.onPlaybackEvent(
      event,
      listeningHistoryKey(listen.client.server, listen.client.username),
    );
    if (["skip", "complete", "stop"].includes(kind)) listen.finished = true;
  }

  private finishListening(kind: "skip" | "complete" | "stop" | "pause", reason: string) {
    if (
      kind !== "pause" &&
      this.lastListeningActivity > 0 &&
      Date.now() - this.lastListeningActivity > LISTENING_SESSION_GAP_MS
    ) {
      this.listeningSessionId = "";
      this.listeningSessionIndex = -1;
    }
    this.sampleListen();
    this.emitListeningEvent(kind, reason);
    if (this.listen) this.listen.active = false;
  }

  private resetListen() {
    const song = this.current;
    if (!song || !this.client) {
      this.listen = null;
      return;
    }
    const session = this.ensureListeningSession();
    this.listen = {
      song,
      client: this.client,
      seconds: 0,
      reportedSeconds: 0,
      mediaTime: this.playbackTime(),
      wallTime: performance.now(),
      active: false,
      announced: false,
      submitted: false,
      finished: false,
      sessionId: session.id,
      sessionIndex: session.index,
    };
  }

  private baseline() {
    if (!this.listen || (!this.audio && !this.usingAlacDecoder)) return;
    this.listen.mediaTime = this.usingAlacDecoder
      ? this.alac.currentTime()
      : this.audio?.currentTime ?? 0;
    this.listen.wallTime = performance.now();
  }

  private sampleListen() {
    const listen = this.listen;
    const audio = this.audio;
    if (!listen || (!audio && !this.usingAlacDecoder)) return;
    const now = performance.now();
    const mediaTime = this.playbackTime();
    const delta = mediaTime - listen.mediaTime;
    const elapsed = Math.max(0, (now - listen.wallTime) / 1000);
    const naturalAdvance = elapsed * (this.usingAlacDecoder ? 1 : audio!.playbackRate);
    // Seeked time does not count toward a listen. Wall time also prevents a
    // discontinuous media timestamp from being counted as heard audio.
    if (
      listen.active &&
      (this.usingAlacDecoder || !audio!.seeking) &&
      delta > 0 &&
      delta <= Math.max(1.5, naturalAdvance + 0.75)
    ) {
      listen.seconds += Math.min(delta, naturalAdvance + 0.25);
    }
    listen.mediaTime = mediaTime;
    listen.wallTime = now;
    const duration = finite(this.playbackDuration(), listen.song.duration ?? 0);
    if (
      !listen.submitted &&
      !isLocalSong(listen.song) &&
      duration > 0 &&
      listen.seconds > Math.min(duration / 2, 240)
    ) {
      listen.submitted = true;
      void listen.client.scrobble(listen.song, true).catch(() => {
        this.onError("Listening history could not be updated on Navidrome.");
      });
    }
  }

  private loadCurrent(position = 0, autoplay = true, preserveListen = false) {
    const audio = this.audio;
    const song = this.current;
    if (!audio || !song || !this.client) return;
    this.sampleListen();
    this.sourceVersion++;
    this.playVersion++;
    this.desiredPlaying = autoplay;
    this.compatibleFallbackUsed = false;
    if (this.listen) this.listen.active = false;
    this.clearStandby();

    if (this.shouldUseAlac(song)) {
      this.usingAlacDecoder = true;
      audio.pause();
      this.releaseAudioSource(audio);
      audio.removeAttribute("src");
      audio.load();
      this.pendingSeek = null;
      if (!preserveListen) this.resetListen();
      this.update({
        currentTime: Math.max(0, position),
        duration: song.duration ?? 0,
        playing: false,
        loading: true,
        activeStream: this.state.original ? "original" : "compatible",
      });
      this.setMetadata();
      const request = this.alacRequest();
      if (request) {
        void this.alac.load(request, position, autoplay);
        this.primeUpcoming();
      }
      return;
    }

    this.usingAlacDecoder = false;
    this.alac.stop();
    audio.pause();
    this.pendingSeek = Math.max(0, position);
    const source = this.sourceVersion;
    const streamUrl = this.client.stream(song, this.state.original);
    void this.attachAudioSource(audio, streamUrl, source).then(() => {
      if (source !== this.sourceVersion || !autoplay) return;
      this.armLoadTimer();
      this.play();
    }).catch((error: unknown) => {
      if (source !== this.sourceVersion) return;
      this.desiredPlaying = false;
      this.update({ loading: false, playing: false });
      this.reportError(error instanceof Error ? error.message : this.playbackError());
    });
    if (!preserveListen) this.resetListen();
    this.baseline();
    this.update({
      currentTime: Math.max(0, position),
      duration: song.duration ?? 0,
      playing: false,
      loading: autoplay,
      activeStream: this.state.original ? "original" : "compatible",
    });
    this.setMetadata();
    this.primeUpcoming();
  }

  private select(
    index: number,
    autoplay = true,
    endKind: "skip" | "complete" = "skip",
  ) {
    if (!this.entries[index]) return;
    this.finishListening(
      endKind,
      endKind === "complete" ? "automatic-complete" : "manual-next",
    );
    this.update({ currentIndex: index });
    // Selecting the same entry intentionally restarts it as well.
    this.loadCurrent(0, autoplay);
  }

  playSongs = (
    songs: Song[],
    start = 0,
    autoplay = true,
    position = 0,
  ) => {
    if (!songs.length || !this.client) return;
    this.finishListening("skip", "queue-replaced");
    const index = clamp(Math.trunc(finite(start)), 0, songs.length - 1);
    this.orderedEntries = songs.map((song) => ({ song, key: ++this.entryKey }));
    this.entries = this.state.shuffle
      ? [
          this.orderedEntries[index],
          ...shuffled(
            this.orderedEntries.filter((_, itemIndex) => itemIndex !== index),
          ),
        ]
      : [...this.orderedEntries];
    this.update({
      queue: this.entries.map((entry) => entry.song),
      currentIndex: this.state.shuffle ? 0 : index,
    });
    this.loadCurrent(position, autoplay);
  };

  restoreSession = (session: PlaybackSession) => {
    if (!session.queue.length || !this.client) return;
    this.finishListening("skip", "session-restored");
    const index = clamp(
      Math.trunc(finite(session.currentIndex)),
      0,
      session.queue.length - 1,
    );
    this.orderedEntries = session.queue.map((song) => ({
      song,
      key: ++this.entryKey,
    }));
    this.entries = [...this.orderedEntries];
    this.update({
      queue: this.entries.map((entry) => entry.song),
      currentIndex: index,
      shuffle: Boolean(session.shuffle),
      repeat: session.repeat,
      original: Boolean(session.original),
    });
    this.loadCurrent(
      Math.max(0, finite(session.position)),
      Boolean(session.wasPlaying),
    );
  };

  restoreSong = (song: Song, position = 0) => {
    this.restoreSession({
      queue: [song],
      currentIndex: 0,
      position,
      shuffle: false,
      repeat: "off",
      original: this.state.original,
      wasPlaying: false,
    });
  };

  private play = () => {
    const audio = this.audio;
    if (!this.client) return;
    if (!this.current) {
      if (this.entries.length) this.select(0);
      return;
    }
    if (this.usingAlacDecoder) {
      if (this.playbackDuration() > 0 && this.playbackTime() >= this.playbackDuration())
        this.seek(0);
      this.desiredPlaying = true;
      if (!this.alac.hasTrack()) {
        this.loadCurrent(this.state.currentTime, true, true);
        return;
      }
      void this.alac.play().catch((error: unknown) => this.alacFailed(error));
      return;
    }
    if (!audio) return;
    if (
      audio.ended ||
      (this.state.duration > 0 && audio.currentTime >= this.state.duration)
    ) {
      this.finishListening("complete", "replay");
      this.resetListen();
      this.seek(0);
    }
    this.desiredPlaying = true;
    this.update({
      loading: audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
    });
    const source = this.sourceVersion;
    const request = ++this.playVersion;
    void audio
      .play()
      .then(() => {
        if (source !== this.sourceVersion || request !== this.playVersion)
          return;
        if (!this.desiredPlaying) audio.pause();
      })
      .catch((error: unknown) => {
        if (
          source !== this.sourceVersion ||
          request !== this.playVersion ||
          !this.desiredPlaying
        )
          return;
        this.desiredPlaying = false;
        this.update({ playing: false, loading: false });
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        this.reportError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Your browser blocked playback. Press Play to start."
            : this.playbackError(),
        );
      });
  };

  private pause = () => {
    this.sampleListen();
    this.clearLoadTimer();
    this.desiredPlaying = false;
    this.stopHandoffMonitor();
    this.playVersion++;
    if (this.listen) this.listen.active = false;
    if (this.usingAlacDecoder) {
      if (this.alac.hasTrack()) this.alac.pause();
      else this.alac.stop();
      this.update({ playing: false, loading: false });
      if (navigator.mediaSession)
        navigator.mediaSession.playbackState = this.current ? "paused" : "none";
      return;
    }
    this.audio?.pause();
    this.update({ playing: false, loading: false });
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = this.current ? "paused" : "none";
  };

  toggle = () => {
    this.desiredPlaying ? this.pause() : this.play();
  };

  previous = () => {
    if (!this.current) return;
    if (this.playbackTime() > 3) {
      this.seek(0);
      this.play();
    } else if (this.state.currentIndex > 0)
      this.select(this.state.currentIndex - 1);
    else if (this.state.repeat === "all") this.select(this.entries.length - 1);
    else {
      this.seek(0);
      this.play();
    }
  };

  next = () => {
    if (!this.entries.length) return;
    if (this.state.currentIndex < this.entries.length - 1) {
      const nextIndex = this.state.currentIndex + 1;
      if (!this.promoteStandby(nextIndex, "skip")) this.select(nextIndex);
    } else if (this.state.repeat === "all") {
      if (!this.promoteStandby(0, "skip")) this.select(0);
    } else this.pause();
  };

  seek = (seconds: number) => {
    const audio = this.audio;
    if (!this.current || !Number.isFinite(seconds)) return;
    this.sampleListen();
    const previous = this.playbackTime();
    const position = clamp(
      seconds,
      0,
      this.state.duration || Math.max(0, seconds),
    );
    if (Math.abs(position - previous) >= 3)
      this.emitListeningEvent(
        "seek",
        position > previous ? "seek-forward" : "seek-backward",
        position - previous,
        false,
      );
    if (this.usingAlacDecoder) {
      this.alac.seek(position);
      this.update({ currentTime: position });
      this.baseline();
      this.positionState();
      return;
    }
    if (!audio) return;
    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING)
      this.pendingSeek = position;
    else {
      try {
        audio.currentTime = position;
      } catch {
        this.pendingSeek = position;
      }
    }
    this.baseline();
    this.update({ currentTime: position });
    this.positionState();
  };

  setVolume = (value: number) => {
    const volume = clamp(finite(value, this.state.volume), 0, 1);
    this.alac.setVolume(volume);
    if (this.audio) this.audio.volume = volume;
    this.standby.forEach((deck) => {
      deck.audio.volume = volume;
    });
    this.update({ volume });
  };

  setOriginal = (original: boolean) => {
    if (original === this.state.original) return;
    const position = this.pendingSeek ?? this.playbackTime();
    const autoplay = this.desiredPlaying;
    this.update({ original });
    if (this.current) this.loadCurrent(position, autoplay, true);
  };

  toggleShuffle = () => {
    const shuffle = !this.state.shuffle;
    const split = this.state.currentIndex + 1;
    const history = this.entries.slice(0, split);
    const upcoming = this.entries.slice(split);
    const order = new Map(
      this.orderedEntries.map((entry, index) => [entry.key, index]),
    );
    this.entries = [
      ...history,
      ...(shuffle
        ? shuffled(upcoming)
        : upcoming.sort((a, b) => order.get(a.key)! - order.get(b.key)!)),
    ];
    this.update({ shuffle, queue: this.entries.map((entry) => entry.song) });
    this.primeUpcoming();
  };

  cycleRepeat = () => {
    this.update({
      repeat:
        this.state.repeat === "off"
          ? "all"
          : this.state.repeat === "all"
            ? "one"
            : "off",
    });
    this.primeUpcoming();
  };
  jumpTo = (index: number) => {
    if (Number.isInteger(index)) this.select(index);
  };

  reorderQueue = (fromIndex: number, toIndex: number) => {
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex <= this.state.currentIndex ||
      toIndex <= this.state.currentIndex ||
      fromIndex >= this.entries.length ||
      toIndex >= this.entries.length ||
      fromIndex === toIndex
    )
      return;
    const nextEntries = [...this.entries];
    const [entry] = nextEntries.splice(fromIndex, 1);
    nextEntries.splice(toIndex, 0, entry);
    this.entries = nextEntries;
    this.orderedEntries = [...nextEntries];
    this.update({ queue: nextEntries.map((item) => item.song) });
    this.primeUpcoming();
  };

  removeFromQueue = (index: number) => {
    const entry = this.entries[index];
    if (!entry || !Number.isInteger(index)) return;
    const wasCurrent = index === this.state.currentIndex;
    const autoplay = this.desiredPlaying;
    if (wasCurrent) {
      this.finishListening("skip", "removed-from-queue");
    }
    this.entries = this.entries.filter((item) => item.key !== entry.key);
    this.orderedEntries = this.orderedEntries.filter(
      (item) => item.key !== entry.key,
    );
    if (!this.entries.length) {
      this.stop();
      return;
    }
    const currentIndex = wasCurrent
      ? Math.min(index, this.entries.length - 1)
      : index < this.state.currentIndex
        ? this.state.currentIndex - 1
        : this.state.currentIndex;
    this.update({ queue: this.entries.map((item) => item.song), currentIndex });
    if (wasCurrent) this.loadCurrent(0, autoplay);
    else this.primeUpcoming();
  };

  clearUpcoming = () => {
    this.entries = this.entries.slice(0, this.state.currentIndex + 1);
    const retained = new Set(this.entries.map((entry) => entry.key));
    this.orderedEntries = this.orderedEntries.filter((entry) =>
      retained.has(entry.key),
    );
    this.update({ queue: this.entries.map((entry) => entry.song) });
    this.primeUpcoming();
  };

  append = (song: Song, next = false) => {
    const entry = { song, key: ++this.entryKey };
    const index = next ? this.state.currentIndex + 1 : this.entries.length;
    const currentKey = this.entries[this.state.currentIndex]?.key;
    const orderedIndex = next
      ? this.orderedEntries.findIndex((item) => item.key === currentKey) + 1
      : this.orderedEntries.length;
    this.entries = [
      ...this.entries.slice(0, index),
      entry,
      ...this.entries.slice(index),
    ];
    this.orderedEntries = [
      ...this.orderedEntries.slice(0, orderedIndex),
      entry,
      ...this.orderedEntries.slice(orderedIndex),
    ];
    this.update({ queue: this.entries.map((item) => item.song) });
    this.primeUpcoming();
  };

  stop = () => {
    this.finishListening("stop", "stop");
    this.desiredPlaying = false;
    this.alac.stop();
    this.usingAlacDecoder = false;
    this.stopHandoffMonitor();
    this.clearLoadTimer();
    this.sourceVersion++;
    this.playVersion++;
    this.listen = null;
    this.pendingSeek = null;
    this.clearStandby();
    this.entries = [];
    this.orderedEntries = [];
    if (this.audio) {
      this.audio.pause();
      this.releaseAudioSource(this.audio);
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.update({
      queue: [],
      currentIndex: -1,
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
    });
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      try {
        navigator.mediaSession.setPositionState();
      } catch {
        /* Optional browser feature. */
      }
    }
  };

  private metadataLoaded = () => {
    const audio = this.audio;
    if (!audio || !this.current) return;
    this.update({
      duration: finite(audio.duration, this.current.duration ?? 0),
    });
    if (
      audio.readyState > HTMLMediaElement.HAVE_NOTHING &&
      this.pendingSeek !== null
    ) {
      const position = clamp(
        this.pendingSeek,
        0,
        this.state.duration || this.pendingSeek,
      );
      try {
        audio.currentTime = position;
        this.pendingSeek = null;
        this.baseline();
      } catch {
        /* Retry on the next metadata event. */
      }
    }
    this.positionState();
  };

  private timeUpdate = () => {
    if (!this.audio || !this.current) return;
    this.sampleListen();
    // Native timeupdate is already throttled. Quantization avoids rendering
    // the album browser for imperceptibly small timestamp changes.
    const currentTime = Math.floor(finite(this.audio.currentTime) * 4) / 4;
    this.update({ currentTime });
    this.positionState();
  };

  private didPlay = () => {
    if (!this.desiredPlaying) {
      this.audio?.pause();
      return;
    }
    this.baseline();
    this.clearLoadTimer();
    if (this.listen) {
      this.listen.active = true;
      if (!this.listen.announced) {
        this.listen.announced = true;
        this.emitListeningEvent("start", "play");
        if (!isLocalSong(this.listen.song))
          void this.listen.client.scrobble(this.listen.song, false).catch(() => {
            /* Playback can continue offline. */
          });
      } else {
        this.emitListeningEvent("resume", "resume");
      }
    }
    this.update({ playing: true, loading: false });
    this.startHandoffMonitor();
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = "playing";
    this.positionState();
  };

  private didPause = () => {
    // Ignore queued events from an old source that has already resumed.
    // End-of-track pause is handled by ended so it can advance the queue.
    if (!this.audio?.paused || this.audio.ended) return;
    this.finishListening("pause", "pause");
    this.clearLoadTimer();
    this.desiredPlaying = false;
    this.stopHandoffMonitor();
    this.playVersion++;
    if (this.listen) this.listen.active = false;
    this.update({ playing: false, loading: false });
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = this.current ? "paused" : "none";
  };

  private stalled = () => {
    // A stalled network request can still have enough decoded audio buffered.
    if (this.audio && this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)
      this.waiting();
  };

  private waiting = () => {
    this.sampleListen();
    if (this.listen) this.listen.active = false;
    if (this.desiredPlaying) this.update({ loading: true });
  };

  private seeking = () => {
    this.baseline();
  };
  private seeked = () => {
    this.baseline();
    if (this.listen)
      this.listen.active = this.desiredPlaying && !this.audio?.paused;
    this.timeUpdate();
  };

  private ended = () => {
    if (!this.desiredPlaying) return;
    const nextIndex = this.automaticNextIndex();
    if (nextIndex === null) {
      this.finishListening("complete", "ended");
      this.pause();
      return;
    }
    if (!this.promoteStandby(nextIndex, "complete"))
      this.select(nextIndex, true, "complete");
  };

  private playbackError() {
    if (isLocalSong(this.current))
      return "This local file could not be played by your browser. Try another audio format.";
    return this.state.original
      ? "Original audio could not be played. Check your connection or choose Compatible in Audio Quality for browser-supported playback."
      : "Audio could not be played. Check your connection and the server’s transcoding settings.";
  }

  private reportError(message: string) {
    if (this.reportedErrorVersion === this.sourceVersion) return;
    this.reportedErrorVersion = this.sourceVersion;
    this.onError(message);
  }

  private failed = () => {
    if (!this.current || !this.audio?.error) return;
    this.finishListening("stop", "playback-error");
    this.desiredPlaying = false;
    this.stopHandoffMonitor();
    if (this.listen) this.listen.active = false;
    this.update({ playing: false, loading: false });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
    this.reportError(this.playbackError());
  };

  private setMetadata() {
    const song = this.current;
    if (
      !song ||
      !navigator.mediaSession ||
      typeof MediaMetadata === "undefined"
    )
      return;
    // Local-library artwork already lives at the object URL created while the
    // folder is scanned. Publish that URL to Media Session as well so Safari
    // can hand the current cover through to the iPhone Lock Screen. Server
    // tracks continue to use Navidrome's cover-art endpoint.
    const artwork = isLocalSong(song)
      ? song.localArtworkUrl
      : this.client?.cover(song.coverArt, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist ?? "",
      album: song.album ?? "",
      artwork: artwork ? [{ src: artwork, sizes: "512x512" }] : [],
    });
  }

  private positionState = () => {
    const audio = this.audio;
    if (!navigator.mediaSession || !this.current) return;
    const duration = this.playbackDuration();
    const position = this.playbackTime();
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    if (!this.usingAlacDecoder && !audio) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.usingAlacDecoder ? 1 : audio!.playbackRate,
        position: clamp(position, 0, duration),
      });
    } catch {
      /* Position reporting is not supported in every browser. */
    }
  };
}

type VoltaGlobal = typeof globalThis & {
  __voltaPlaybackController?: PlaybackController;
};

function sharedPlaybackController(
  onError: (message: string) => void,
  onPlaybackEvent: PlaybackEventHandler,
): PlaybackController {
  const scope = globalThis as VoltaGlobal;
  const existing = scope.__voltaPlaybackController;
  if (existing) {
    existing.setErrorHandler(onError);
    existing.setPlaybackEventHandler(onPlaybackEvent);
    return existing;
  }
  const controller = new PlaybackController(onError, onPlaybackEvent);
  scope.__voltaPlaybackController = controller;
  return controller;
}

export function usePlayer(
  client: Navidrome | null,
  onError: (message: string) => void,
  onPlaybackEvent: PlaybackEventHandler = () => {},
) {
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const playbackEventRef = useRef(onPlaybackEvent);
  playbackEventRef.current = onPlaybackEvent;
  const [controller] = useState(
    () =>
      sharedPlaybackController(
        (message) => errorRef.current(message),
        (event, storageKey) => playbackEventRef.current(event, storageKey),
      ),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(controller.mount, [controller]);
  useEffect(() => {
    controller.setClient(client);
  }, [client, controller]);
  useEffect(() => {
    controller.setPlaybackEventHandler(
      (event, storageKey) => playbackEventRef.current(event, storageKey),
    );
  }, [controller]);
  return {
    ...state,
    currentSong: state.queue[state.currentIndex],
    playSongs: controller.playSongs,
    restoreSession: controller.restoreSession,
    restoreSong: controller.restoreSong,
    toggle: controller.toggle,
    previous: controller.previous,
    next: controller.next,
    seek: controller.seek,
    setVolume: controller.setVolume,
    setOriginal: controller.setOriginal,
    toggleShuffle: controller.toggleShuffle,
    cycleRepeat: controller.cycleRepeat,
    jumpTo: controller.jumpTo,
    removeFromQueue: controller.removeFromQueue,
    clearUpcoming: controller.clearUpcoming,
    append: controller.append,
    reorderQueue: controller.reorderQueue,
    stop: controller.stop,
  };
}

export type Player = ReturnType<typeof usePlayer>;
