import type { ListeningEvent } from "./listening-history";
import type { FeatureVector } from "./interactions";

/**
 * A tiny, fully local learning-to-rank layer.
 *
 * The hand-tuned recommender already encodes sensible priors. This module lets
 * the player *adapt* those priors per user: every recommendation we show is
 * logged with its feature vector, and whenever the user acts on a shelf item
 * we attribute a reward and run a few steps of regularized logistic regression.
 * The learned weights are then blended in as a residual correction on top of
 * the prior score.
 *
 * Everything is on-device and deterministic. With no data the model is inert,
 * so the recommender behaves exactly like the prior; as evidence accumulates,
 * it progressively personalizes.
 */

export const RANKER_MODEL_VERSION = 2;
export const IMPRESSION_LOG_VERSION = 2;

export type RankerModel = {
  version: 2;
  weights: Record<string, number>;
  bias: number;
  samples: number;
  positives: number;
  updatedAt: number;
};

export type PendingImpression = {
  id: string;
  at: number;
  albumId: string;
  artistId: string;
  genres: string[];
  features: FeatureVector;
  position: number;
};

export type ImpressionLog = {
  version: 2;
  items: PendingImpression[];
};

export type RankerExample = {
  features: FeatureVector;
  /** Reward in roughly [-1, 1]; positives mean "this was a good call". */
  reward: number;
};

export type RewardTarget = {
  albumId?: string;
  artistId?: string;
  genres?: readonly string[];
};

const MAX_IMPRESSIONS = 400;
const MAX_IMPRESSION_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const ATTRIBUTION_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_WEIGHT = 4;
const L2 = 0.02;
const LEARNING_RATE = 0.12;

export const rankerModelStorageKey = (server: string, username: string) =>
  `volta-ranker-model:v1:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;

export const impressionStorageKey = (server: string, username: string) =>
  `volta-ranker-impressions:v1:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;

export const emptyRankerModel = (): RankerModel => ({
  version: RANKER_MODEL_VERSION,
  weights: {},
  bias: 0,
  samples: 0,
  positives: 0,
  updatedAt: 0,
});

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const sigmoid = (value: number) => {
  const bounded = clamp(value, -30, 30);
  return 1 / (1 + Math.exp(-bounded));
};

const isFiniteRecord = (value: unknown): value is Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
};

export function readRankerModel(
  storage: Storage,
  key: string,
): RankerModel {
  if (!key) return emptyRankerModel();
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptyRankerModel();
    const value = JSON.parse(raw) as Partial<RankerModel>;
    if (
      value?.version !== RANKER_MODEL_VERSION ||
      !isFiniteRecord(value.weights) ||
      !Number.isFinite(value.bias)
    )
      return emptyRankerModel();
    return {
      version: RANKER_MODEL_VERSION,
      weights: { ...value.weights },
      bias: clamp(value.bias as number, -4, 4),
      samples: Math.max(0, Math.trunc(Number(value.samples) || 0)),
      positives: Math.max(0, Math.trunc(Number(value.positives) || 0)),
      updatedAt: Number(value.updatedAt) || 0,
    };
  } catch {
    return emptyRankerModel();
  }
}

export function writeRankerModel(
  storage: Storage,
  key: string,
  model: RankerModel,
) {
  try {
    storage.setItem(key, JSON.stringify(model));
  } catch {
    /* Learning is best-effort. */
  }
  return model;
}

export function clearRankerState(
  storage: Storage,
  modelKey: string,
  impressionKey: string,
) {
  try {
    storage.removeItem(modelKey);
    storage.removeItem(impressionKey);
  } catch {
    /* Storage is optional. */
  }
}

const isImpression = (value: unknown): value is PendingImpression => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingImpression>;
  return (
    typeof item.id === "string" &&
    Number.isFinite(item.at) &&
    typeof item.albumId === "string" &&
    typeof item.artistId === "string" &&
    Array.isArray(item.genres) &&
    isFiniteRecord(item.features)
  );
};

export function readImpressions(
  storage: Storage,
  key: string,
  now = Date.now(),
): PendingImpression[] {
  if (!key) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw) as Partial<ImpressionLog>;
    if (value?.version !== IMPRESSION_LOG_VERSION || !Array.isArray(value.items))
      return [];
    return value.items
      .filter(isImpression)
      .filter((item) => now - item.at <= MAX_IMPRESSION_AGE_MS)
      .slice(-MAX_IMPRESSIONS);
  } catch {
    return [];
  }
}

export function writeImpressions(
  storage: Storage,
  key: string,
  items: readonly PendingImpression[],
  now = Date.now(),
) {
  const next = items
    .filter((item) => now - item.at <= MAX_IMPRESSION_AGE_MS)
    .slice(-MAX_IMPRESSIONS);
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: IMPRESSION_LOG_VERSION, items: next }),
    );
  } catch {
    /* Storage is optional. */
  }
  return next;
}

export function recordImpressions(
  storage: Storage,
  key: string,
  impressions: readonly PendingImpression[],
  now = Date.now(),
) {
  if (!impressions.length) return readImpressions(storage, key, now);
  const existing = readImpressions(storage, key, now);
  const known = new Set(existing.map((item) => item.id));
  const additions = impressions.filter((item) => !known.has(item.id));
  if (!additions.length) return existing;
  return writeImpressions(storage, key, [...existing, ...additions], now);
}

/**
 * Attribute a reward to recent recommendations.
 *
 * Use the latest matching album exposure. Artist-only actions may match an
 * artist at reduced weight; shared genre alone is not causal evidence.
 */
export function attributeReward(
  items: readonly PendingImpression[],
  target: RewardTarget,
  reward: number,
  now = Date.now(),
): { examples: RankerExample[]; remaining: PendingImpression[] } {
  if (!items.length || reward === 0) return { examples: [], remaining: [...items] };
  const albumId = target.albumId?.trim().toLowerCase() || "";
  const artistId = target.artistId?.trim().toLowerCase() || "";
  const examples: RankerExample[] = [];
  const remaining: PendingImpression[] = [];
  let bestIndex = -1;
  let bestMatch = 0;
  items.forEach((item, index) => {
    if (item.at > now || now - item.at > ATTRIBUTION_WINDOW_MS) return;
    let match = 0;
    if (albumId && item.albumId === albumId) match = 1;
    else if (!albumId && artistId && item.artistId === artistId) match = 0.45;
    // Shared genre alone cannot establish that a recommendation caused an action.
    if (match > bestMatch || (match > 0 && match === bestMatch && item.at > items[bestIndex].at)) {
      bestMatch = match;
      bestIndex = index;
    }
  });
  if (bestIndex < 0 || bestMatch <= 0) return { examples: [], remaining: [...items] };
  const matched = items[bestIndex];
  examples.push({ features: matched.features, reward: clamp(reward * bestMatch, -1, 1) });
  items.forEach((item) => {
    // One action cannot repeatedly reward older exposures of the same album.
    if (item.albumId !== matched.albumId) remaining.push(item);
  });
  return { examples, remaining };
}

/** One regularized logistic-regression pass over the supplied examples. */
export function trainRanker(
  model: RankerModel,
  examples: readonly RankerExample[],
  passes = 3,
): RankerModel {
  if (!examples.length) return model;
  const weights = { ...model.weights };
  let bias = model.bias;
  const samples = model.samples + examples.length;
  const positives = model.positives + examples.filter((example) => example.reward > 0).length;
  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    for (const example of examples) {
      const target = clamp((example.reward + 1) / 2, 0, 1);
      let logit = bias;
      for (const [feature, value] of Object.entries(example.features)) {
        if (feature === "learned" || !Number.isFinite(value) || value === 0) continue;
        logit += (weights[feature] || 0) * value;
      }
      const prediction = sigmoid(logit);
      const error = target - prediction;
      bias = clamp(bias + LEARNING_RATE * error, -4, 4);
      for (const [feature, value] of Object.entries(example.features)) {
        if (feature === "learned" || !Number.isFinite(value) || value === 0) continue;
        const current = weights[feature] || 0;
        const gradient = error * value - L2 * current;
        weights[feature] = clamp(current + LEARNING_RATE * gradient, -MAX_WEIGHT, MAX_WEIGHT);
      }

    }
  }
  return {
    version: RANKER_MODEL_VERSION,
    weights,
    bias,
    samples,
    positives,
    updatedAt: Date.now(),
  };
}

/** Confidence in the learned model, 0 (cold) to 1 (well-trained). */
export const rankerConfidence = (model: RankerModel | undefined) => {
  if (!model || model.samples <= 0) return 0;
  return clamp(model.samples / 80, 0, 1);
};

export const predictRanker = (
  model: RankerModel | undefined,
  features: FeatureVector,
) => {
  if (!model || model.samples <= 0) return 0.5;
  let logit = model.bias;
  for (const [feature, value] of Object.entries(features)) {
    if (feature === "learned" || !Number.isFinite(value) || value === 0) continue;
    logit += (model.weights[feature] || 0) * value;
  }
  return sigmoid(logit);
};

/**
 * Add the learned residual to the prior score. The correction is intentionally
 * bounded and scaled by confidence so early, noisy feedback can't destabilize
 * ranking, while a well-trained model can meaningfully re-rank the shelf.
 */
export const blendLearnedScore = (
  priorScore: number,
  model: RankerModel | undefined,
  features: FeatureVector,
) => {
  const confidence = rankerConfidence(model);
  if (!confidence) return priorScore;
  const residual = predictRanker(model, features) - 0.5;
  return priorScore + residual * 0.6 * confidence;
};

/** Starting or queueing is intent; wait for consumption before judging it.
 * A late skip is not the same signal as abandoning the opening seconds. */
export function playbackRecommendationReward(event: Pick<ListeningEvent, "kind" | "completionRatio">) {
  if (event.kind === "complete") return 0.9;
  if (event.kind === "skip") return event.completionRatio >= 0.8 ? 0.3
    : event.completionRatio <= 0.2 ? -0.8 : -0.15;
  if (event.kind === "stop" && event.completionRatio > 0.5) return 0.2;
  return 0;
}
