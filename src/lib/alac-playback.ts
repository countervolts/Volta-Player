import type { Song } from "./navidrome";
import { decodeAlacM4a } from "./alac-container";

export type AlacRequest = { index: number; song: Song; url: string };
export type AlacTrack = AlacRequest & { buffer: AudioBuffer };

type ActiveTrack = {
  track: AlacTrack;
  source: AudioBufferSourceNode | null;
  startedAt: number;
  offset: number;
  playing: boolean;
};

type ScheduledTrack = {
  track: AlacTrack;
  source: AudioBufferSourceNode;
  startsAt: number;
  timer: number;
};

export type AlacPlaybackEvents = {
  loading: (request: AlacRequest) => void;
  ready: (track: AlacTrack) => void;
  started: (track: AlacTrack, position: number) => void;
  paused: (track: AlacTrack, position: number) => void;
  time: (track: AlacTrack, position: number) => void;
  boundary: (track: AlacTrack) => void;
  ended: (track: AlacTrack) => void;
  error: (error: unknown) => void;
};

/** A Web Audio scheduler around Volta's own ALAC WebAssembly decoder. */
export class AlacPlayback {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private current: ActiveTrack | null = null;
  private scheduled: ScheduledTrack | null = null;
  private nextRequest: AlacRequest | null = null;
  private generation = 0;
  private ticker: number | null = null;
  private scheduleKey = "";
  private volume = 0.8;
  private readonly decoded = new Map<string, Promise<AlacTrack>>();

  constructor(private readonly events: AlacPlaybackEvents) {}

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  private requestKey(request: AlacRequest) {
    return `${request.song.id}:${request.url}`;
  }

  private async decode(request: AlacRequest): Promise<AlacTrack> {
    const response = await fetch(request.url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`ALAC HTTP ${response.status}`);
    const buffer = await decodeAlacM4a(await response.arrayBuffer(), this.ensureContext());
    return { ...request, buffer };
  }

  private decodedTrack(request: AlacRequest) {
    const key = this.requestKey(request);
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const pending = this.decode(request).catch((error) => {
      this.decoded.delete(key);
      throw error;
    });
    this.decoded.set(key, pending);
    return pending;
  }

  private stopTicker() {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private startTicker() {
    if (this.ticker !== null) return;
    this.ticker = window.setInterval(() => {
      if (this.current) this.events.time(this.current.track, this.currentTime());
    }, 100);
  }

  private stopSource(source: AudioBufferSourceNode | null) {
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Already stopped or ended. */
    }
    source.disconnect();
  }

  private cancelScheduled() {
    if (!this.scheduled) return;
    window.clearTimeout(this.scheduled.timer);
    this.stopSource(this.scheduled.source);
    this.scheduled = null;
    this.scheduleKey = "";
  }

  private stopSources() {
    this.cancelScheduled();
    this.stopSource(this.current?.source ?? null);
    if (this.current) this.current.source = null;
  }

  private start(active: ActiveTrack, position: number) {
    const context = this.ensureContext();
    const source = context.createBufferSource();
    const safePosition = Math.max(0, Math.min(position, active.track.buffer.duration));
    source.buffer = active.track.buffer;
    source.connect(this.gain!);
    active.offset = safePosition;
    active.startedAt = context.currentTime - safePosition;
    active.source = source;
    active.playing = true;
    source.onended = () => {
      if (this.current?.source !== source) return;
      this.current.source = null;
      if (this.scheduled) return;
      this.stopTicker();
      this.events.ended(active.track);
    };
    source.start(0, safePosition);
    this.events.started(active.track, safePosition);
    this.startTicker();
    this.scheduleNext();
  }

  private scheduleNext() {
    const active = this.current;
    const next = this.nextRequest;
    const context = this.context;
    if (!active?.playing || !next || !context || this.scheduled) return;
    const key = this.requestKey(next);
    if (key === this.scheduleKey) return;
    this.scheduleKey = key;
    void this.decodedTrack(next)
      .then((track) => {
        if (
          this.current !== active ||
          !active.playing ||
          this.nextRequest !== next ||
          this.scheduled
        )
          return;
        const startsAt = active.startedAt + active.track.buffer.duration;
        if (startsAt <= context.currentTime + 0.02) {
          this.scheduleKey = "";
          return;
        }
        const source = context.createBufferSource();
        source.buffer = track.buffer;
        source.connect(this.gain!);
        const timer = window.setTimeout(
          () => this.promote(track, source, startsAt),
          Math.max(0, (startsAt - context.currentTime) * 1000),
        );
        this.scheduled = { track, source, startsAt, timer };
        source.start(startsAt);
      })
      .catch(() => {
        this.scheduleKey = "";
        // A queued M4A may be AAC rather than ALAC. Let the controller reach
        // the boundary and select its normal HTMLAudioElement fallback.
      });
  }

  private promote(track: AlacTrack, source: AudioBufferSourceNode, startsAt: number) {
    if (this.scheduled?.source !== source) return;
    this.scheduled = null;
    this.scheduleKey = "";
    this.current = { track, source, startedAt: startsAt, offset: 0, playing: true };
    source.onended = () => {
      if (this.current?.source !== source) return;
      this.current.source = null;
      if (this.scheduled) return;
      this.stopTicker();
      this.events.ended(track);
    };
    this.events.boundary(track);
    this.events.started(track, 0);
    this.scheduleNext();
  }

  async load(request: AlacRequest, position: number, autoplay: boolean) {
    const generation = ++this.generation;
    this.stopSources();
    this.current = null;
    this.nextRequest = null;
    this.events.loading(request);
    const context = this.ensureContext();
    const resume = autoplay ? context.resume() : Promise.resolve();
    try {
      const track = await this.decodedTrack(request);
      if (generation !== this.generation) return;
      this.current = { track, source: null, startedAt: 0, offset: position, playing: false };
      this.events.ready(track);
      if (autoplay) {
        await resume;
        if (generation !== this.generation) return;
        this.start(this.current, position);
      } else {
        this.events.paused(track, position);
      }
    } catch (error) {
      if (generation === this.generation) this.events.error(error);
    }
  }

  setNext(request: AlacRequest | null) {
    if (this.nextRequest && (!request || this.requestKey(request) !== this.requestKey(this.nextRequest)))
      this.cancelScheduled();
    this.nextRequest = request;
    this.scheduleNext();
  }

  async play() {
    const active = this.current;
    if (!active) return;
    await this.ensureContext().resume();
    if (!active.playing) this.start(active, active.offset);
  }

  pause() {
    const active = this.current;
    if (!active || !active.playing) return;
    active.offset = this.currentTime();
    active.playing = false;
    this.cancelScheduled();
    this.stopSource(active.source);
    active.source = null;
    this.events.paused(active.track, active.offset);
  }

  seek(position: number) {
    const active = this.current;
    if (!active) return;
    active.offset = Math.max(0, Math.min(position, active.track.buffer.duration));
    const playing = active.playing;
    active.playing = false;
    this.cancelScheduled();
    this.stopSource(active.source);
    active.source = null;
    if (playing) void this.play();
    else this.events.time(active.track, active.offset);
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }

  currentTime() {
    const active = this.current;
    if (!active || !active.playing || !this.context) return active?.offset ?? 0;
    return Math.max(0, Math.min(active.track.buffer.duration, this.context.currentTime - active.startedAt));
  }

  duration() {
    return this.current?.track.buffer.duration ?? 0;
  }

  hasTrack() {
    return this.current !== null;
  }

  stop() {
    this.generation++;
    this.stopSources();
    this.current = null;
    this.nextRequest = null;
    this.decoded.clear();
    this.stopTicker();
    if (this.context) void this.context.suspend();
  }
}
