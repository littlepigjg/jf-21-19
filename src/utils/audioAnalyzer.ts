import type { AudioData, BeatMarker } from '@/types';
import { generateId } from './imageUtils';

export interface AnalyzeAudioOptions {
  waveformSamples?: number;
  fftSize?: number;
  sensitivity?: number;
  onProgress?: (percent: number) => void;
}

export interface AudioAnalysisResult {
  audioData: AudioData;
  audioBuffer: AudioBuffer;
}

function normalizeArray(arr: number[]): number[] {
  if (arr.length === 0) return arr;
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    const abs = Math.abs(arr[i]);
    if (abs > max) max = abs;
  }
  if (max === 0) return arr.map(() => 0);
  return arr.map((v) => v / max);
}

function downsample(data: Float32Array, targetSamples: number): number[] {
  if (data.length <= targetSamples) {
    return Array.from(data);
  }
  const result: number[] = new Array(targetSamples);
  const blockSize = data.length / targetSamples;
  for (let i = 0; i < targetSamples; i++) {
    const start = Math.floor(i * blockSize);
    const end = Math.floor((i + 1) * blockSize);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += Math.abs(data[j]);
    }
    result[i] = sum / (end - start);
  }
  return normalizeArray(result);
}

function detectBeats(
  channelData: Float32Array,
  sampleRate: number,
  sensitivity: number = 0.7
): { beats: BeatMarker[]; bpm: number } {
  const beats: BeatMarker[] = [];
  const windowSize = Math.floor(sampleRate * 0.05);
  const hopSize = Math.floor(sampleRate * 0.01);
  const energies: number[] = [];
  const times: number[] = [];

  for (let i = 0; i + windowSize < channelData.length; i += hopSize) {
    let energy = 0;
    for (let j = i; j < i + windowSize; j++) {
      energy += channelData[j] * channelData[j];
    }
    energies.push(energy / windowSize);
    times.push(i / sampleRate);
  }

  if (energies.length === 0) {
    return { beats, bpm: 120 };
  }

  const localWindow = 43;
  const threshold: number[] = new Array(energies.length).fill(0);
  for (let i = 0; i < energies.length; i++) {
    const start = Math.max(0, i - localWindow);
    const end = Math.min(energies.length, i + localWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += energies[j];
    }
    threshold[i] = (sum / (end - start)) * (1 + (1 - sensitivity) * 0.5);
  }

  const minBeatInterval = 0.25;
  let lastBeatTime = -Infinity;
  for (let i = 1; i < energies.length - 1; i++) {
    if (
      energies[i] > threshold[i] &&
      energies[i] > energies[i - 1] &&
      energies[i] > energies[i + 1] &&
      times[i] - lastBeatTime >= minBeatInterval
    ) {
      const maxEnergy = Math.max(...energies);
      const intensity = Math.min(1, energies[i] / maxEnergy);
      beats.push({
        id: generateId(),
        time: times[i],
        intensity,
        frameIndex: 0,
      });
      lastBeatTime = times[i];
    }
  }

  let bpm = 120;
  if (beats.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      intervals.push(beats[i].time - beats[i - 1].time);
    }
    intervals.sort();
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median > 0) {
      bpm = Math.round(60 / median);
    }
  }

  return { beats, bpm };
}

function computeFrequencyBands(
  audioBuffer: AudioBuffer,
  numBands: number = 32,
  numFrames: number = 200
): number[][] {
  const result: number[][] = [];
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerFrame = Math.floor(channelData.length / numFrames);
  const fftSize = Math.min(2048, samplesPerFrame);

  for (let f = 0; f < numFrames; f++) {
    const start = f * samplesPerFrame;
    const frameData = channelData.slice(start, start + fftSize);
    const bandValues: number[] = new Array(numBands).fill(0);

    const windowed = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
      windowed[i] = (frameData[i] || 0) * hann;
    }

    const bandSize = fftSize / 2 / numBands;
    for (let b = 0; b < numBands; b++) {
      let energy = 0;
      for (let k = 0; k < bandSize; k++) {
        const idx = Math.floor(b * bandSize + k);
        if (idx < windowed.length) {
          energy += Math.abs(windowed[idx]);
        }
      }
      bandValues[b] = energy / bandSize;
    }

    let maxBand = 0;
    for (let b = 0; b < numBands; b++) {
      if (bandValues[b] > maxBand) maxBand = bandValues[b];
    }
    if (maxBand > 0) {
      for (let b = 0; b < numBands; b++) {
        bandValues[b] /= maxBand;
      }
    }

    result.push(bandValues);
  }

  return result;
}

export async function analyzeAudioFile(
  file: File,
  options: AnalyzeAudioOptions = {}
): Promise<AudioAnalysisResult> {
  const {
    waveformSamples = 500,
    sensitivity = 0.7,
    onProgress,
  } = options;

  onProgress?.(5);

  const arrayBuffer = await file.arrayBuffer();
  onProgress?.(20);

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioCtx();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  onProgress?.(50);

  const channelData = audioBuffer.getChannelData(0);
  const waveformData = downsample(channelData, waveformSamples);
  onProgress?.(70);

  const { beats, bpm } = detectBeats(channelData, audioBuffer.sampleRate, sensitivity);
  onProgress?.(85);

  const frequencyData = computeFrequencyBands(audioBuffer);
  onProgress?.(95);

  const url = URL.createObjectURL(file);

  const audioData: AudioData = {
    id: generateId(),
    name: file.name,
    url,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    waveformData,
    frequencyData,
    beatMarkers: beats,
    bpm,
  };

  onProgress?.(100);
  audioContext.close();

  return { audioData, audioBuffer };
}

export function mapBeatsToFrames(
  beats: BeatMarker[],
  duration: number,
  frameCount: number,
  fps: number = 15
): BeatMarker[] {
  if (frameCount === 0 || duration === 0) {
    return beats.map((b) => ({ ...b, frameIndex: 0 }));
  }
  return beats.map((beat) => {
    const totalFramesForDuration = duration * fps;
    const ratio = totalFramesForDuration > 0 ? frameCount / totalFramesForDuration : 1;
    const frameIndex = Math.min(frameCount - 1, Math.floor((beat.time / duration) * frameCount * ratio));
    return { ...beat, frameIndex: Math.max(0, frameIndex) };
  });
}

export function getFrequencyAtTime(
  frequencyData: number[][],
  currentTime: number,
  duration: number
): number[] {
  if (frequencyData.length === 0 || duration === 0) return [];
  const index = Math.min(
    frequencyData.length - 1,
    Math.floor((currentTime / duration) * frequencyData.length)
  );
  return frequencyData[Math.max(0, index)] || [];
}

export function getCurrentBeats(
  beats: BeatMarker[],
  currentTime: number,
  window: number = 0.05
): BeatMarker[] {
  return beats.filter((b) => Math.abs(b.time - currentTime) <= window);
}
