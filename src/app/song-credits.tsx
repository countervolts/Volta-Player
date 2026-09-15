import { LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Song } from "../lib/navidrome";
import {
  creditsFromMetadata,
  lookupSongCredits,
  type SongCredits,
} from "../lib/song-credits";

export function SongCreditsPanel({ song }: { song: Song }) {
  const [credits, setCredits] = useState<SongCredits | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookedUp, setLookedUp] = useState(false);
  const metadataCredits = creditsFromMetadata(song);
  const visibleCredits = credits || metadataCredits;

  const lookup = async () => {
    if (loading) return;
    setLoading(true);
    const next = (await lookupSongCredits(song)) || metadataCredits;
    setCredits(next);
    setLookedUp(true);
    setLoading(false);
  };

  return (
    <section className="song-credits" aria-labelledby="song-credits-heading">
      <div className="song-credits-heading">
        <div>
          <h4 id="song-credits-heading">Song credits</h4>
          <p>
            {metadataCredits
              ? "From this song’s metadata. Find more roles from MusicBrainz when available."
              : "MusicBrainz is searched only when you ask. Volta sends this song’s title and artist, never your library address or account."}
          </p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void lookup()}>
          {loading ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
          {loading
            ? "Finding…"
            : visibleCredits
              ? "Find more credits"
              : "Find credits"}
        </button>
      </div>
      {visibleCredits && (
        <dl className="song-credits-list">
          {visibleCredits.credits.map((credit) => (
            <div key={credit.role}>
              <dt>{credit.role}</dt>
              <dd>{credit.people.join(", ")}</dd>
            </div>
          ))}
        </dl>
      )}
      {lookedUp && !credits && (
        <p className="song-credits-empty" role="status">
          No detailed credits were available for this recording yet.
        </p>
      )}
    </section>
  );
}
