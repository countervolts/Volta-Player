import { useMemo } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { Modal, Tooltip } from "../components";
import { albumName } from "../lib/navidrome";
import {
  rankAlbumRecommendations,
  type AlbumRecommendationInput,
} from "../lib/recommendations";
import {
  MAX_SLATE_SIZE,
  MIN_SLATE_SIZE,
  RECOMMENDATION_TUNING_PRESETS,
  describeRecommendationTuning,
  matchRecommendationTuningPreset,
  type RecommendationTuning,
} from "../lib/recommendation-tuning";

type Props = {
  open: boolean;
  onClose: () => void;
  /**
   * The same input the Home shelf ranks with. Passing the real context (rather
   * than a bare candidate list) is what makes the preview a genuine preview:
   * without listening history every album scores identically and the dials
   * appear to do nothing.
   */
  previewContext: Omit<AlbumRecommendationInput, "tuning" | "limit">;
  tuning: RecommendationTuning;
  onChange: (patch: Partial<RecommendationTuning>) => void;
  onReset: () => void;
  rankerSamples: number;
};

type Dial = {
  key: keyof RecommendationTuning;
  label: string;
  hint: string;
  low: string;
  high: string;
};

/**
 * The seven continuous dials. Kept as data so the markup stays a single loop
 * instead of seven near-identical blocks, and so the low/high captions can
 * explain the *direction* each dial moves the ranking.
 */
const DIALS: readonly Dial[] = [
  {
    key: "adventurousness",
    label: "Risk appetite",
    hint:
      "At 0 the shelf is what it is sure you like. At 100 it only shows albums " +
      "you have never played and pushes out anything already in heavy rotation.",
    low: "Records I know",
    high: "Only what I have not heard",
  },
  {
    key: "familiarity",
    label: "Familiarity",
    hint: "Weight for artists, genres, and albums already in your rotation.",
    low: "Strangers welcome",
    high: "Only what I know",
  },
  {
    key: "diversity",
    label: "Spread",
    hint: "How hard the slate pushes for different artists instead of repeats.",
    low: "Same artist is fine",
    high: "One per artist",
  },
  {
    key: "recency",
    label: "Recency",
    hint: "Balance what you are playing this week against your long-term taste.",
    low: "My all-time taste",
    high: "My last few days",
  },
  {
    key: "freshness",
    label: "New arrivals",
    hint: "Boost records that were recently added to your collection.",
    low: "Ignore new adds",
    high: "Surface new adds",
  },
  {
    key: "caution",
    label: "Caution",
    hint: "How strongly skips, dislikes, and mutes hold something down.",
    low: "Forgiving",
    high: "Remember every skip",
  },
  {
    key: "learning",
    label: "Learned model",
    hint: "How much the on-device model may overrule the hand-tuned ranking.",
    low: "Trust the defaults",
    high: "Trust what I taught it",
  },
];
/**
 * A dedicated, self-contained screen for shaping the local recommender.
 *
 * Deliberately separate from Settings: the dials and the live slate are one
 * connected surface, and mixing them into a list of preference toggles made it
 * hard to see cause and effect. The preview re-ranks the exact candidate pool
 * the Home shelf uses, with the same scoring path, so what is shown here is
 * what the engine would actually pick.
 */
export function RecommendationEngineDialog({
  open,
  onClose,
  previewContext,
  tuning,
  onChange,
  onReset,
  rankerSamples,
}: Props) {
  const preset = matchRecommendationTuningPreset(tuning);
  const summary = describeRecommendationTuning(tuning);
  const preview = useMemo(
    () =>
      open
        ? rankAlbumRecommendations({
            ...previewContext,
            tuning,
            limit: tuning.slateSize,
          })
        : [],
    [open, previewContext, tuning],
  );
  const candidateCount = previewContext.libraryPool?.length
    ? previewContext.libraryPool.length
    : (previewContext.candidates?.length ?? 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Recommendation engine"
      className="engine-dialog"
    >
      <div className="engine-view">
        <header className="engine-hero">
          <div className="engine-hero-copy">
            <p className="engine-hero-kicker">
              <Sparkles size={13} />
              Local and explainable
            </p>
            <h2>Shape how Volta suggests music</h2>
            <p>
              These dials trade certainty for discovery. Higher risk means the
              shelf is more willing to be wrong in exchange for finding
              something you would never have searched for.
            </p>
          </div>
          <div className="engine-risk">
            <span className="engine-risk-label">{summary.label}</span>
            <span className="engine-risk-value">{summary.risk}%</span>
            <div className="engine-risk-track" aria-hidden="true">
              <div
                className="engine-risk-fill"
                style={{ width: `${summary.risk}%` }}
              />
            </div>
            <small>appetite for risk</small>
          </div>
        </header>

        <section className="engine-block">
          <div className="engine-block-heading">
            <b>Presets</b>
            <small>
              {preset
                ? RECOMMENDATION_TUNING_PRESETS.find(
                    (item) => item.id === preset,
                  )?.description
                : "Custom mix — tuned by hand below."}
            </small>
          </div>
          <div
            className="engine-presets"
            role="group"
            aria-label="Recommendation presets"
          >
            {RECOMMENDATION_TUNING_PRESETS.map((item) => (
              <Tooltip label={item.description} key={item.id}>
                <button
                  type="button"
                  className="engine-preset"
                  aria-pressed={preset === item.id}
                  onClick={() => onChange(item.tuning)}
                >
                  <b>{item.label}</b>
                  <small>{item.description}</small>
                </button>
              </Tooltip>
            ))}
          </div>
        </section>

        <div className="engine-columns">
          <section className="engine-block">
            <div className="engine-block-heading">
              <b>Dials</b>
              <small>Every change re-ranks the preview immediately.</small>
            </div>
            <div className="engine-dials">
              {DIALS.map((dial) => {
                const value = Math.round(
                  (tuning[dial.key] as number) * 100,
                );
                const inputId = `engine-dial-${dial.key}`;
                const hint =
                  dial.key === "learning"
                    ? `${dial.hint} ${
                        rankerSamples > 0
                          ? `${rankerSamples} local samples trained so far.`
                          : "No local learning yet, so this dial has no effect until you listen."
                      }`
                    : dial.hint;
                return (
                  <div className="engine-dial" key={dial.key}>
                    <div className="engine-dial-head">
                      {/* The label is associated by id and holds only the dial
                          name, so the slider's accessible name stays clean and
                          the sibling <output> is not picked up as a label. */}
                      <label htmlFor={inputId}>{dial.label}</label>
                      <output>{value}%</output>
                    </div>
                    <small>{hint}</small>                    <input
                      id={inputId}
                      type="range"
                      min={0}
                      max={100}
                      value={value}
                      onChange={(event) =>
                        onChange({
                          [dial.key]: Number(event.target.value) / 100,
                        })
                      }
                    />
                    <span className="engine-dial-ends" aria-hidden="true">
                      <small>{dial.low}</small>
                      <small>{dial.high}</small>
                    </span>
                  </div>
                );
              })}
              <div className="engine-dial engine-shelf">
                <span className="engine-dial-head">
                  <b>Shelf size</b>
                  <output>{tuning.slateSize}</output>
                </span>
                <small>
                  How many albums “Made for you” asks the engine for.
                </small>
                <span className="setting-stepper" aria-label="Shelf size">
                  <button
                    type="button"
                    aria-label="Decrease shelf size"
                    disabled={tuning.slateSize <= MIN_SLATE_SIZE}
                    onClick={() =>
                      onChange({ slateSize: tuning.slateSize - 1 })
                    }
                  >
                    −
                  </button>
                  <output>{tuning.slateSize}</output>
                  <button
                    type="button"
                    aria-label="Increase shelf size"
                    disabled={tuning.slateSize >= MAX_SLATE_SIZE}
                    onClick={() =>
                      onChange({ slateSize: tuning.slateSize + 1 })
                    }
                  >
                    +
                  </button>
                </span>
              </div>
            </div>
          </section>

          <section className="engine-block engine-preview-block">
            <div className="engine-block-heading">
              <b>Live preview</b>
              <small>
                {preview.length
                  ? `Re-ranked from ${candidateCount} candidates as you tune.`
                  : "Open Home once to load candidates, then tune here."}
              </small>
            </div>
            {preview.length > 0 && (
              <ol
                className="engine-preview-list"
                aria-label="Live recommendation preview"
              >
                {preview.map((item, index) => (
                  <li key={item.album.id} className="engine-preview-item">
                    <span className="engine-preview-rank">{index + 1}</span>
                    <span className="engine-preview-copy">
                      <b>{albumName(item.album)}</b>
                      <small>
                        {item.album.artist || "Unknown artist"} · {item.reason}
                      </small>
                    </span>
                    <Tooltip label="Listening familiarity estimate from recorded playback; not album completion">
                      <span
                        className="engine-preview-exposure"
                        data-level={
                          item.signals.exposure === 0
                            ? "new"
                            : item.signals.exposure >= 0.6
                              ? "played"
                              : "some"
                        }
                      >
                        {item.signals.exposure === 0
                          ? "no plays"
                          : item.signals.exposure >= 0.6 ? "familiar" : "lightly played"}
                      </span>
                    </Tooltip>
                    <Tooltip label="Ranker score">
                      <span className="engine-preview-score">
                        {item.score.toFixed(2)}
                      </span>
                    </Tooltip>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="engine-actions">
          <span className="engine-actions-summary">
            <b>{summary.label}</b>
            <small>
              {rankerSamples > 0
                ? `${rankerSamples} local samples trained.`
                : "The engine is running on its defaults so far."}
            </small>
          </span>
          <button className="secondary-button" onClick={onReset}>
            <RotateCcw size={15} />
            Reset dials
          </button>
        </footer>
      </div>
    </Modal>
  );
}
