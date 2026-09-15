/// <reference lib="webworker" />
import {
  ANALYSIS_SAMPLE_RATE,
  analyzeAudio,
  analyzeTransitionRegion,
  resampleMono,
  type TrackAnalysis,
} from "./audio-analysis";

export type AnalysisWorkerRequest = {
  id: number;
  /** Planar channel data transferred from the main thread. */
  channels: Float32Array[];
  sampleRate: number;
  introChannels: Float32Array[];
  outroChannels: Float32Array[];
  outroOffset: number;
  duration: number;
};

export type AnalysisWorkerResponse = {
  id: number;
  analysis: TrackAnalysis | null;
};

/**
 * AutoMix analysis worker.
 *
 * Tempo and key detection is a few hundred milliseconds of FFT work on a long
 * clip. Keeping it off the main thread means enabling AutoMix never stalls
 * playback or the UI while the queue is being scanned.
 */
self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const { id, channels, sampleRate, introChannels, outroChannels, outroOffset, duration } = event.data;
  let analysis: TrackAnalysis | null = null;
  try {
    // Resampling changes the frame rate, so the analysis must be told the
    // *output* rate. Passing the source rate here silently scales every tempo
    // by the resampling ratio.
    const mono = resampleMono(channels, sampleRate);
    analysis = analyzeAudio(mono, ANALYSIS_SAMPLE_RATE);
    if (analysis) {
      analysis.duration = duration;
      analysis.intro = analyzeTransitionRegion(resampleMono(introChannels, sampleRate), ANALYSIS_SAMPLE_RATE);
      analysis.outro = analyzeTransitionRegion(resampleMono(outroChannels, sampleRate), ANALYSIS_SAMPLE_RATE, outroOffset);
    }
  } catch {
    // A failed analysis is not an error: the caller falls back to an estimate.
    analysis = null;
  }
  const response: AnalysisWorkerResponse = { id, analysis };
  (self as unknown as Worker).postMessage(response);
};
