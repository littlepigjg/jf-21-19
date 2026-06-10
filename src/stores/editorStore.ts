import { create } from 'zustand';
import type { Frame, Caption, CropConfig, ExportConfig, AudioData } from '@/types';
import { generateId, cloneImageData, createBlankImageData } from '@/utils/imageUtils';
import { mapBeatsToFrames } from '@/utils/audioAnalyzer';

interface EditorStore {
  frames: Frame[];
  selectedFrameIndex: number;
  captions: Caption[];
  crop: CropConfig;
  exportConfig: ExportConfig;
  isPlaying: boolean;
  playbackSpeed: number;
  currentFrameIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  showImportDialog: boolean;
  showExportDialog: boolean;

  audio: AudioData | null;
  isAudioPlaying: boolean;
  audioCurrentTime: number;
  audioVolume: number;
  beatSensitivity: number;
  syncWithAudio: boolean;

  setFrames: (frames: Frame[]) => void;
  setSelectedFrameIndex: (index: number) => void;
  setCurrentFrameIndex: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setShowImportDialog: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;

  addFrame: (imageData?: ImageData, afterIndex?: number) => void;
  deleteFrame: (index: number) => void;
  duplicateFrame: (index: number) => void;
  moveFrame: (fromIndex: number, toIndex: number) => void;
  setFrameDelay: (index: number, delay: number) => void;
  setAllFrameDelays: (delay: number) => void;

  addCaption: (caption?: Partial<Caption>) => void;
  updateCaption: (id: string, updates: Partial<Caption>) => void;
  deleteCaption: (id: string) => void;

  setCrop: (crop: Partial<CropConfig>) => void;
  setExportConfig: (config: Partial<ExportConfig>) => void;

  setAudio: (audio: AudioData | null) => void;
  setIsAudioPlaying: (playing: boolean) => void;
  setAudioCurrentTime: (time: number) => void;
  setAudioVolume: (volume: number) => void;
  setBeatSensitivity: (sensitivity: number) => void;
  setSyncWithAudio: (sync: boolean) => void;
  remapBeatsToFrames: () => void;
  addKeyframesAtBeats: (intensityThreshold?: number) => number[];

  clearAll: () => void;
}

const defaultCrop: CropConfig = {
  enabled: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

const defaultExportConfig: ExportConfig = {
  colors: 256,
  quality: 80,
  fps: 15,
  dither: true,
  repeat: 0,
  width: 0,
  height: 0,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  frames: [],
  selectedFrameIndex: -1,
  captions: [],
  crop: defaultCrop,
  exportConfig: defaultExportConfig,
  isPlaying: false,
  playbackSpeed: 1,
  currentFrameIndex: 0,
  canvasWidth: 640,
  canvasHeight: 480,
  showImportDialog: false,
  showExportDialog: false,

  audio: null,
  isAudioPlaying: false,
  audioCurrentTime: 0,
  audioVolume: 1,
  beatSensitivity: 0.7,
  syncWithAudio: true,

  setFrames: (frames) => {
    if (frames.length > 0) {
      const firstFrame = frames[0];
      const exportCfg = get().exportConfig;
      set({
        frames,
        selectedFrameIndex: 0,
        currentFrameIndex: 0,
        canvasWidth: firstFrame.width,
        canvasHeight: firstFrame.height,
        crop: {
          ...get().crop,
          width: firstFrame.width,
          height: firstFrame.height,
        },
        exportConfig: {
          ...exportCfg,
          width: exportCfg.width || firstFrame.width,
          height: exportCfg.height || firstFrame.height,
        },
      });
    } else {
      set({ frames, selectedFrameIndex: -1, currentFrameIndex: 0 });
    }
  },

  setSelectedFrameIndex: (index) => set({ selectedFrameIndex: index }),
  setCurrentFrameIndex: (index) => set({ currentFrameIndex: index }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setShowImportDialog: (show) => set({ showImportDialog: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  addFrame: (imageData, afterIndex) => {
    const state = get();
    const width = state.canvasWidth;
    const height = state.canvasHeight;
    const newFrame: Frame = {
      id: generateId(),
      imageData: imageData || createBlankImageData(width, height),
      delay: 100,
      width,
      height,
      disposalMethod: 2,
    };

    const newFrames = [...state.frames];
    if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < newFrames.length) {
      newFrames.splice(afterIndex + 1, 0, newFrame);
      set({ frames: newFrames, selectedFrameIndex: afterIndex + 1 });
    } else {
      newFrames.push(newFrame);
      set({ frames: newFrames, selectedFrameIndex: newFrames.length - 1 });
    }
  },

  deleteFrame: (index) => {
    const state = get();
    if (state.frames.length <= 1) {
      set({ frames: [], selectedFrameIndex: -1, currentFrameIndex: 0 });
      return;
    }
    const newFrames = state.frames.filter((_, i) => i !== index);
    const newSelected = index >= newFrames.length ? newFrames.length - 1 : index;
    set({
      frames: newFrames,
      selectedFrameIndex: newSelected,
      currentFrameIndex: Math.min(state.currentFrameIndex, newFrames.length - 1),
    });
  },

  duplicateFrame: (index) => {
    const state = get();
    const frame = state.frames[index];
    if (!frame) return;

    const newFrame: Frame = {
      ...frame,
      id: generateId(),
      imageData: cloneImageData(frame.imageData),
    };

    const newFrames = [...state.frames];
    newFrames.splice(index + 1, 0, newFrame);
    set({ frames: newFrames, selectedFrameIndex: index + 1 });
  },

  moveFrame: (fromIndex, toIndex) => {
    const state = get();
    if (fromIndex === toIndex) return;
    const newFrames = [...state.frames];
    const [removed] = newFrames.splice(fromIndex, 1);
    newFrames.splice(toIndex, 0, removed);
    set({ frames: newFrames, selectedFrameIndex: toIndex });
  },

  setFrameDelay: (index, delay) => {
    const state = get();
    const newFrames = [...state.frames];
    if (newFrames[index]) {
      newFrames[index] = { ...newFrames[index], delay: Math.max(10, delay) };
      set({ frames: newFrames });
    }
  },

  setAllFrameDelays: (delay) => {
    const state = get();
    const newFrames = state.frames.map((f) => ({ ...f, delay: Math.max(10, delay) }));
    set({ frames: newFrames });
  },

  addCaption: (caption) => {
    const state = get();
    const maxFrames = Math.max(0, state.frames.length - 1);
    const newCaption: Caption = {
      id: generateId(),
      text: caption?.text || '新字幕',
      frameRange: caption?.frameRange || [0, maxFrames],
      x: caption?.x ?? state.canvasWidth / 2,
      y: caption?.y ?? state.canvasHeight - 60,
      fontSize: caption?.fontSize || 32,
      fontFamily: caption?.fontFamily || 'Arial, sans-serif',
      color: caption?.color || '#FFFFFF',
      strokeColor: caption?.strokeColor || '#000000',
      strokeWidth: caption?.strokeWidth ?? 2,
      align: caption?.align || 'center',
    };
    set({ captions: [...state.captions, newCaption] });
  },

  updateCaption: (id, updates) => {
    const state = get();
    const newCaptions = state.captions.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );
    set({ captions: newCaptions });
  },

  deleteCaption: (id) => {
    const state = get();
    set({ captions: state.captions.filter((c) => c.id !== id) });
  },

  setCrop: (crop) => set({ crop: { ...get().crop, ...crop } }),
  setExportConfig: (config) => set({ exportConfig: { ...get().exportConfig, ...config } }),

  setAudio: (audio) => {
    const state = get();
    if (audio && state.frames.length > 0) {
      const fps = state.exportConfig.fps || 15;
      const mappedBeats = mapBeatsToFrames(audio.beatMarkers, audio.duration, state.frames.length, fps);
      set({
        audio: { ...audio, beatMarkers: mappedBeats },
        audioCurrentTime: 0,
        isAudioPlaying: false,
      });
    } else {
      set({ audio, audioCurrentTime: 0, isAudioPlaying: false });
    }
  },
  setIsAudioPlaying: (playing) => set({ isAudioPlaying: playing }),
  setAudioCurrentTime: (time) => set({ audioCurrentTime: time }),
  setAudioVolume: (volume) => set({ audioVolume: Math.max(0, Math.min(1, volume)) }),
  setBeatSensitivity: (sensitivity) => set({ beatSensitivity: Math.max(0, Math.min(1, sensitivity)) }),
  setSyncWithAudio: (sync) => set({ syncWithAudio: sync }),
  remapBeatsToFrames: () => {
    const state = get();
    if (!state.audio || state.frames.length === 0) return;
    const fps = state.exportConfig.fps || 15;
    const mappedBeats = mapBeatsToFrames(state.audio.beatMarkers, state.audio.duration, state.frames.length, fps);
    set({ audio: { ...state.audio, beatMarkers: mappedBeats } });
  },
  addKeyframesAtBeats: (intensityThreshold = 0.5) => {
    const state = get();
    if (!state.audio || state.frames.length === 0) return [];
    const affectedFrames: number[] = [];
    const newFrames = [...state.frames];
    const beatFrames = new Set<number>();

    for (const beat of state.audio.beatMarkers) {
      if (beat.intensity >= intensityThreshold) {
        beatFrames.add(beat.frameIndex);
      }
    }

    beatFrames.forEach((frameIdx) => {
      if (frameIdx >= 0 && frameIdx < newFrames.length) {
        const frame = newFrames[frameIdx];
        newFrames[frameIdx] = { ...frame, delay: Math.max(10, Math.floor(frame.delay * 0.6)) };
        affectedFrames.push(frameIdx);
      }
    });

    if (affectedFrames.length > 0) {
      set({ frames: newFrames });
    }
    return affectedFrames;
  },

  clearAll: () => {
    const state = get();
    if (state.audio?.url) {
      URL.revokeObjectURL(state.audio.url);
    }
    set({
      frames: [],
      selectedFrameIndex: -1,
      captions: [],
      crop: defaultCrop,
      isPlaying: false,
      currentFrameIndex: 0,
      showImportDialog: false,
      showExportDialog: false,
      audio: null,
      isAudioPlaying: false,
      audioCurrentTime: 0,
    });
  },
}));
