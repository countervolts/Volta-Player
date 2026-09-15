import { useState } from "react";
import { duration, type ConnectionIssue } from "../lib/navidrome";
import type { ListeningEvent, ListeningProfile } from "../lib/listening-history";
import { rankerConfidence, type RankerModel } from "../lib/learned-ranker";
import type { EngagementEvent, EngagementProfile } from "../lib/interactions";

const LISTENING_EVENT_LABELS: Record<string, string> = {
  start: "Started",
  resume: "Resumed",
  pause: "Paused",
  skip: "Skipped",
  complete: "Finished",
  stop: "Stopped",
  seek: "Sought",
};

const ENGAGEMENT_EVENT_LABELS: Record<string, string> = {
  "album-view": "Opened album",
  "artist-view": "Opened artist",
  "genre-view": "Browsed genre",
  "favorite-add": "Favorited",
  "favorite-remove": "Unfavorited",
  "queue-add": "Queued",
  "play-next": "Play next",
  "album-play": "Played album",
  "album-shuffle": "Shuffled album",
  "playlist-add": "Added to playlist",
  search: "Searched",
  "recommendation-click": "Opened a suggestion",
  dislike: "Not interested",
  undislike: "Undid not interested",
  "artist-mute": "Muted artist",
  "artist-unmute": "Unmuted artist",
};

export function ListeningHistoryView({
  events,
  profile,
  engagementEvents,
  engagementProfile,
  rankerModel,
  enabled,
  persistent,
  onPersistenceChange,
  onResetLearning,
}: {
  events: readonly ListeningEvent[];
  profile: ListeningProfile;
  engagementEvents: readonly EngagementEvent[];
  engagementProfile: EngagementProfile;
  rankerModel: RankerModel;
  enabled: boolean;
  persistent: boolean;
  onPersistenceChange: (value: boolean) => void;
  onResetLearning: () => void;
}) {
  const recentEvents = [...events]
    .sort((left, right) => right.at - left.at)
    .slice(0, 60);
  const totalSeconds = events.reduce(
    (total, event) => total + Math.max(0, event.deltaSeconds),
    0,
  );
  const uniqueSongs = new Set(events.map((event) => event.songId)).size;
  const completion = Math.round(profile.averageCompletionRatio * 100);
  const interactions = engagementEvents.filter(
    (event) => event.kind !== "recommendation-impression",
  );
  const recentInteractions = [...interactions]
    .sort((left, right) => right.at - left.at)
    .slice(0, 12);
  const learnedSamples = rankerModel.samples;
  const learnedConfidence = Math.round(rankerConfidence(rankerModel) * 100);
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="listening-history-view">
      <div className="listening-history-intro">
        <p>
          {enabled
            ? "This is the local listening profile Volta uses to shape recommendations."
            : "Personalized recommendation tracking is turned off."}
        </p>
        <small>
          Playback history and interactions stay on this device. Normal
          Navidrome scrobbling is separate.
        </small>
      </div>
      <label className="listening-history-retention">
        <span>
          <b>Keep history across logins and restarts</b>
          <small>
            {persistent
              ? "Your profile will return when you sign in again."
              : "Keep it only for this browser session; logout clears it."}
          </small>
        </span>
        <input
          aria-label="Keep history across logins and restarts"
          type="checkbox"
          checked={persistent}
          onChange={(event) => onPersistenceChange(event.target.checked)}
        />
      </label>
      <div className="listening-history-stats" aria-label="Listening profile summary">
        <div>
          <strong>{events.length}</strong>
          <span>events retained</span>
        </div>
        <div>
          <strong>{profile.sessions}</strong>
          <span>listening sessions</span>
        </div>
        <div>
          <strong>{uniqueSongs}</strong>
          <span>songs heard</span>
        </div>
        <div>
          <strong>{duration(totalSeconds)}</strong>
          <span>audible time</span>
        </div>
        <div>
          <strong>{interactions.length}</strong>
          <span>actions tracked</span>
        </div>
        <div>
          <strong>{learnedSamples}</strong>
          <span>learning samples</span>
        </div>
      </div>
      <section className="listening-history-method">
        <h3>How recommendations use this</h3>
        <ul>
          <li>Longer listens and finished songs count as stronger interest.</li>
          <li>Early skips and "not interested" reduce that artist and genre.</li>
          <li>Favorites, queue adds, playlist adds, and album views add weight.</li>
          <li>Songs played together in one sitting teach item-to-item similarity.</li>
          <li>Time of day, weekday, and typical track length tune the context.</li>
          <li>A local model learns which signals predict what you actually play.</li>
        </ul>
        {profile.events > 0 && (
          <small>
            Average completion across recorded outcomes: {completion}%. Local
            model confidence: {learnedConfidence}%
            {engagementProfile.mutes.size
              ? ` · ${engagementProfile.mutes.size} muted artist${
                  engagementProfile.mutes.size === 1 ? "" : "s"
                }`
              : ""}
            .
          </small>
        )}
        <button
          className="secondary-button"
          type="button"
          disabled={!learnedSamples && !interactions.length}
          onClick={onResetLearning}
        >
          Reset what Volta has learned
        </button>
      </section>
      {recentInteractions.length > 0 && (
        <section className="listening-history-activity">
          <div className="listening-history-section-heading">
            <h3>Actions</h3>
            <span>Showing {recentInteractions.length}</span>
          </div>
          <div className="listening-history-list" aria-label="Recent interactions">
            {recentInteractions.map((event) => (
              <article className="listening-history-event" key={event.id}>
                <div className="listening-history-event-copy">
                  <b>{event.entity?.name || event.text || "Library"}</b>
                  <span>
                    {ENGAGEMENT_EVENT_LABELS[event.kind] || event.kind}
                    {event.entity?.artistName ? ` · ${event.entity.artistName}` : ""}
                  </span>
                </div>
                <div className="listening-history-event-meta">
                  <time dateTime={new Date(event.at).toISOString()}>
                    {dateFormatter.format(event.at)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="listening-history-activity">
        <div className="listening-history-section-heading">
          <h3>Recent activity</h3>
          <span>{recentEvents.length ? `Showing ${recentEvents.length}` : "Nothing recorded yet"}</span>
        </div>
        {recentEvents.length ? (
          <div className="listening-history-list" aria-label="Recent listening activity">
            {recentEvents.map((event) => (
              <article className="listening-history-event" key={event.id}>
                <div className="listening-history-event-copy">
                  <b>{event.title}</b>
                  <span>
                    {event.artist || "Unknown artist"}
                    {event.album ? ` · ${event.album}` : ""}
                  </span>
                </div>
                <div className="listening-history-event-meta">
                  <span className={`listening-event-kind ${event.kind}`}>
                    {LISTENING_EVENT_LABELS[event.kind] || event.kind}
                  </span>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {dateFormatter.format(event.at)}
                  </time>
                  {event.deltaSeconds > 0 && (
                    <small>{duration(event.deltaSeconds)} heard</small>
                  )}
                  {event.kind === "skip" && (
                    <small>at {duration(event.totalSeconds)}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="listening-history-empty">
            Play a song for the profile to start learning your habits.
          </p>
        )}
      </section>
    </div>
  );
}

export function ConnectionHelp({
  diagnosis,
  server,
  onDismiss,
}: {
  diagnosis: ConnectionIssue;
  server: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };
  if (diagnosis === "mixed-content")
    return (
      <div className="connection-help" role="note">
        <b>This page is secure, but the server address is not</b>
        <p>
          Browsers block a plain <code>http://</code> server from an{" "}
          <code>https://</code> page. Use your server’s HTTPS address, or forward
          its HTTPS port to Navidrome.
        </p>
        <button className="link-button" type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  return (
    <div className="connection-help" role="note">
      <b>Volta reached the server, but the browser blocked the reply</b>
      <p>
        This is a CORS restriction on{" "}
        <code>{server.replace(/^https?:\/\//, "") || "your server"}</code>. Allow
        this site’s origin there, then try again.
      </p>
      <p className="connection-help-origin">
        <code>{origin}</code>
        <button className="link-button" type="button" onClick={() => void copyOrigin()}>
          {copied ? "Copied" : "Copy origin"}
        </button>
      </p>
      <details className="connection-help-details">
        <summary>How do I allow it?</summary>
        <ul>
          <li>
            Navidrome: set <code>ND_CORSALLOWEDORIGINS</code> (or{" "}
            <code>CORSAllowedOrigins</code> in config) to the origin above.
          </li>
          <li>
            Behind a reverse proxy, add{" "}
            <code>Access-Control-Allow-Origin: {origin}</code> to the{" "}
            <code>/rest/</code> responses.
          </li>
        </ul>
      </details>
      <button className="link-button" type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
