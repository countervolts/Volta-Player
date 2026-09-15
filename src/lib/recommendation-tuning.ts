export const RECOMMENDATION_TUNING_VERSION = 1;
export const RECOMMENDATION_TUNING_KEY = "volta-recommendation-tuning";

export type RecommendationTuning = {
  version: 1;
  adventurousness: number;
  familiarity: number;
  learning: number;
  diversity: number;
  recency: number;
  freshness: number;
  caution: number;
  slateSize: number;
};

export const MIN_SLATE_SIZE = 4;
export const MAX_SLATE_SIZE = 16;

export const DEFAULT_RECOMMENDATION_TUNING: RecommendationTuning = {
  version: RECOMMENDATION_TUNING_VERSION,
  adventurousness: 0.45,
  familiarity: 0.5,
  learning: 0.6,
  diversity: 0.55,
  recency: 0.5,
  freshness: 0.45,
  caution: 0.6,
  slateSize: 8,
};

export type RecommendationTuningPresetId =
  | "safe"
  | "balanced"
  | "adventurous"
  | "explorer";

export type RecommendationTuningPreset = {
  id: RecommendationTuningPresetId;
  label: string;
  description: string;
  tuning: RecommendationTuning;
};

export const RECOMMENDATION_TUNING_PRESETS: readonly RecommendationTuningPreset[] = [
  {
    id: "safe",
    label: "Safe",
    description:
      "Mostly records you already play, with the odd adjacent pick.",
    tuning: {
      version: RECOMMENDATION_TUNING_VERSION,
      adventurousness: 0.1,
      familiarity: 0.9,
      learning: 0.4,
      diversity: 0.3,
      recency: 0.6,
      freshness: 0.3,
      caution: 0.9,
      slateSize: 8,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    description:
      "A couple of records you know alongside things you have not played.",
    tuning: { ...DEFAULT_RECOMMENDATION_TUNING },
  },
  {
    id: "adventurous",
    label: "Adventurous",
    description:
      "Drops records you have worn out and leads with what you have not heard.",
    tuning: {
      version: RECOMMENDATION_TUNING_VERSION,
      adventurousness: 0.8,
      familiarity: 0.35,
      learning: 0.7,
      diversity: 0.75,
      recency: 0.45,
      freshness: 0.6,
      caution: 0.35,
      slateSize: 10,
    },
  },
  {
    id: "explorer",
    label: "Explorer",
    description:
      "Prioritizes overlooked and lightly played albums, with familiar fallback in small libraries.",
    tuning: {
      version: RECOMMENDATION_TUNING_VERSION,
      adventurousness: 1,
      familiarity: 0.15,
      learning: 0.85,
      diversity: 0.9,
      recency: 0.35,
      freshness: 0.75,
      caution: 0.2,
      slateSize: 12,
    },
  },
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const round = (value: number) => Math.round(value * 1e6) / 1e6;

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Coerce anything (including corrupt storage) into a valid tuning object. */
export function normalizeRecommendationTuning(
  value: unknown,
): RecommendationTuning {
  const source = (value || {}) as Partial<RecommendationTuning>;
  const fallback = DEFAULT_RECOMMENDATION_TUNING;
  return {
    version: RECOMMENDATION_TUNING_VERSION,
    adventurousness: clamp01(
      finiteOr(source.adventurousness, fallback.adventurousness),
    ),
    familiarity: clamp01(finiteOr(source.familiarity, fallback.familiarity)),
    learning: clamp01(finiteOr(source.learning, fallback.learning)),
    diversity: clamp01(finiteOr(source.diversity, fallback.diversity)),
    recency: clamp01(finiteOr(source.recency, fallback.recency)),
    freshness: clamp01(finiteOr(source.freshness, fallback.freshness)),
    caution: clamp01(finiteOr(source.caution, fallback.caution)),
    slateSize: Math.round(
      Math.max(
        MIN_SLATE_SIZE,
        Math.min(
          MAX_SLATE_SIZE,
          finiteOr(source.slateSize, fallback.slateSize),
        ),
      ),
    ),
  };
}

export function readRecommendationTuning(
  storage: Storage,
): RecommendationTuning {
  try {
    const raw = storage.getItem(RECOMMENDATION_TUNING_KEY);
    if (!raw) return { ...DEFAULT_RECOMMENDATION_TUNING };
    const parsed = JSON.parse(raw) as Partial<RecommendationTuning>;
    if (parsed?.version !== RECOMMENDATION_TUNING_VERSION)
      return { ...DEFAULT_RECOMMENDATION_TUNING };
    return normalizeRecommendationTuning(parsed);
  } catch {
    return { ...DEFAULT_RECOMMENDATION_TUNING };
  }
}

export function writeRecommendationTuning(
  storage: Storage,
  tuning: RecommendationTuning,
) {
  const normalized = normalizeRecommendationTuning(tuning);
  try {
    storage.setItem(RECOMMENDATION_TUNING_KEY, JSON.stringify(normalized));
  } catch {
    /* Storage is optional. */
  }
  return normalized;
}

export function clearRecommendationTuning(storage: Storage) {
  try {
    storage.removeItem(RECOMMENDATION_TUNING_KEY);
  } catch {
    /* Storage is optional. */
  }
}

/** The preset whose dials match this tuning exactly, if any. */
export function matchRecommendationTuningPreset(
  tuning: RecommendationTuning,
): RecommendationTuningPresetId | null {
  const normalized = normalizeRecommendationTuning(tuning);
  for (const preset of RECOMMENDATION_TUNING_PRESETS) {
    const candidate = normalizeRecommendationTuning(preset.tuning);
    if (
      (Object.keys(candidate) as (keyof RecommendationTuning)[]).every(
        (key) => candidate[key] === normalized[key],
      )
    )
      return preset.id;
  }
  return null;
}

export function describeRecommendationTuning(tuning: RecommendationTuning) {
  const preset = matchRecommendationTuningPreset(tuning);
  const risk = Math.round(
    clamp01(
      tuning.adventurousness * 0.6 +
        (1 - tuning.familiarity) * 0.25 +
        tuning.diversity * 0.15,
    ) * 100,
  );
  const label =
    RECOMMENDATION_TUNING_PRESETS.find((item) => item.id === preset)?.label ||
    (risk >= 75
      ? "Explorer"
      : risk >= 55
        ? "Adventurous"
        : risk >= 30
          ? "Balanced"
          : "Safe");
  return { label, risk };
}

export type RecommendationTuningWeights = {
  artist: number;
  genre: number;
  album: number;
  frequent: number;
  favorite: number;
  history: number;
  engagement: number;
  cooccurrence: number;
  loyalty: number;
  replay: number;
  rediscovery: number;
  era: number;
  recent: number;
  recentPenalty: number;
  freshness: number;
  skipPenalty: number;
  aversion: number;
  mutePenalty: number;
  learned: number;
  diversity: number;
};

export function recommendationTuningWeights(
  tuning: RecommendationTuning,
): RecommendationTuningWeights {
  const adventure = clamp01(tuning.adventurousness);
  const familiarity = clamp01(tuning.familiarity);
  const learning = clamp01(tuning.learning);
  const diversity = clamp01(tuning.diversity);
  const recency = clamp01(tuning.recency);
  const freshness = clamp01(tuning.freshness);
  const caution = clamp01(tuning.caution);
  // Familiarity and adventure are opposing forces: raising one lowers the
  // other's practical effect without ever inverting a signal's sign.
  const familiarScale = 0.35 + familiarity * 1.3;
  return {
    artist: round(familiarScale),
    genre: round(familiarScale),
    album: round(familiarScale),
    frequent: round(familiarScale),
    favorite: round(0.6 + familiarity * 0.8),
    history: round(familiarScale),
    engagement: round(0.5 + familiarity),
    cooccurrence: round(0.4 + familiarity * 1.2),
    loyalty: round(familiarScale),
    replay: round(familiarScale),
    rediscovery: round(0.5 + familiarity),
    era: round(0.5 + adventure * (10 / 9)),
    recent: round(0.3 + recency * 1.4),
    recentPenalty: round(0.3 + recency * 1.4),
    freshness: round(0.3 + freshness * (14 / 9)),
    skipPenalty: round(0.3 + caution * (7 / 6)),
    aversion: round(0.3 + caution * (7 / 6)),
    mutePenalty: round(0.4 + caution),
    learned: round(learning * (5 / 3)),
    diversity: round(0.3 + diversity * (14 / 11)),
  };
}
