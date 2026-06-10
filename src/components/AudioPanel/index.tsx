import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Upload,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Music,
  X,
  Zap,
  Link,
  Unlink,
  Loader2,
  Activity,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { analyzeAudioFile } from '@/utils/audioAnalyzer';
import { cn } from '@/lib/utils';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export default function AudioPanel() {
  const {
    audio,
    isAudioPlaying,
    audioCurrentTime,
    audioVolume,
    beatSensitivity,
    syncWithAudio,
    frames,
    currentFrameIndex,
    setAudio,
    setIsAudioPlaying,
    setAudioCurrentTime,
    setAudioVolume,
    setBeatSensitivity,
    setSyncWithAudio,
    addKeyframesAtBeats,
    setSelectedFrameIndex,
    setCurrentFrameIndex,
  } = useEditorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [beatFlash, setBeatFlash] = useState<Record<number, boolean>>({});

  const handleAudioUpload = async (file: File) => {
    setLoading(true);
    setProgress(0);
    try {
      const result = await analyzeAudioFile(file, {
        sensitivity: beatSensitivity,
        onProgress: (p) => {
          setProgress(p);
        },
      });
      setAudio(result.audioData);
    } catch (err) {
      console.error('Audio analysis failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleAudioUpload(files[0]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audio) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
      setIsAudioPlaying(true);
    } else {
      audioRef.current.pause();
      setIsAudioPlaying(false);
    }
  }, [audio, setIsAudioPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audio || !audioRef.current) return;
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const newTime = ratio * audio.duration;
    audioRef.current.currentTime = newTime;
    setAudioCurrentTime(newTime);
  };

  const handleBeatClick = (beat: { frameIndex: number; time: number }) => {
    if (frames.length > 0) {
      const frameIdx = Math.min(frames.length - 1, Math.max(0, beat.frameIndex));
      setSelectedFrameIndex(frameIdx);
      setCurrentFrameIndex(frameIdx);
    }
    if (audioRef.current && audio) {
      audioRef.current.currentTime = beat.time;
    }
  };

  const handleAutoKeyframes = () => {
    const affected = addKeyframesAtBeats(0.5);
    if (affected.length > 0) {
      setBeatFlash(Object.fromEntries(affected.map((i) => [i, true])));
      setTimeout(() => setBeatFlash({}), 500);
    }
  };

  const handleRemoveAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setAudio(null);
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
  };

  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    const barCount = audio.waveformData.length;
    const barWidth = width / barCount;
    const centerY = height / 2;

    audio.waveformData.forEach((value, i) => {
      const barHeight = value * (height * 0.8);
      const x = i * barWidth;
      const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);
      gradient.addColorStop(0, '#a78bfa');
      gradient.addColorStop(0.5, '#8b5cf6');
      gradient.addColorStop(1, '#a78bfa');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    });

    const beatXPositions = audio.beatMarkers.map((beat) => (beat.time / audio.duration) * width);
    beatXPositions.forEach((x, i) => {
      const intensity = audio.beatMarkers[i].intensity;
      ctx.fillStyle = `rgba(251, 146, 60, ${0.3 + intensity * 0.7})`;
      ctx.fillRect(x - 1, 0, 2, height);
    });

    const progressX = (audioCurrentTime / audio.duration) * width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(progressX - 1, 0, 2, height);

    if (frames.length > 0 && syncWithAudio) {
      const frameProgress = currentFrameIndex / frames.length;
      const frameX = frameProgress * width;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.fillRect(frameX - 2, 0, 4, height);
    }
  }, [audio, audioCurrentTime, currentFrameIndex, frames.length, syncWithAudio]);

  const drawSpectrum = useCallback(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const timeIndex = Math.floor(
      (audioCurrentTime / audio.duration) * audio.frequencyData.length
    );
    const freqData = audio.frequencyData[Math.min(timeIndex, audio.frequencyData.length - 1)] || [];

    if (freqData.length === 0) return;

    const barCount = freqData.length;
    const barWidth = width / barCount;
    const gap = 1;

    freqData.forEach((value, i) => {
      const barHeight = value * height;
      const x = i * barWidth;
      const hue = (i / barCount) * 280;
      ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
      ctx.fillRect(x, height - barHeight, Math.max(1, barWidth - gap), barHeight);
    });
  }, [audio, audioCurrentTime]);

  useEffect(() => {
    if (!audioRef.current || !audio) return;
    audioRef.current.volume = audioVolume;
  }, [audioVolume, audio]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(function loop() {
      drawWaveform();
      drawSpectrum();
      rafRef.current = requestAnimationFrame(loop);
    });
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [drawWaveform, drawSpectrum]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    (window as unknown as { __audioRef?: HTMLAudioElement }).__audioRef = audioEl;
    return () => {
      delete (window as unknown as { __audioRef?: HTMLAudioElement }).__audioRef;
    };
  }, []);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const onTimeUpdate = () => {
      setAudioCurrentTime(audioEl.currentTime);
      if (syncWithAudio && frames.length > 0 && audio) {
        const frameIndex = Math.min(
          frames.length - 1,
          Math.floor((audioEl.currentTime / audio.duration) * frames.length)
        );
        setCurrentFrameIndex(frameIndex);
      }
    };

    const onEnded = () => {
      setIsAudioPlaying(false);
      setAudioCurrentTime(0);
    };

    const onPlay = () => setIsAudioPlaying(true);
    const onPause = () => setIsAudioPlaying(false);

    audioEl.addEventListener('timeupdate', onTimeUpdate);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('play', onPlay);
    audioEl.addEventListener('pause', onPause);

    return () => {
      audioEl.removeEventListener('timeupdate', onTimeUpdate);
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('play', onPlay);
      audioEl.removeEventListener('pause', onPause);
    };
  }, [audio, frames.length, syncWithAudio, setAudioCurrentTime, setIsAudioPlaying, setCurrentFrameIndex]);

  return (
    <div className="w-full bg-slate-900/50 border-t border-slate-700 flex-shrink-0">
      <audio ref={audioRef} src={audio?.url} preload="metadata" />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-200">音频同步</h3>
          </div>
          <div className="flex items-center gap-1">
            {audio && (
              <>
                <span className="text-xs text-slate-500 font-mono mr-2">
                  {audio.bpm} BPM
                </span>
                <button
                  onClick={() => setSyncWithAudio(!syncWithAudio)}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    syncWithAudio
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'hover:bg-slate-800 text-slate-400'
                  )}
                  title={syncWithAudio ? '已同步到帧' : '未同步到帧'}
                >
                  {syncWithAudio ? <Link className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleRemoveAudio}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-orange-400 rounded-lg transition-colors"
                  title="移除音频"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {!audio ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-600 hover:border-violet-500 rounded-xl p-4 text-center cursor-pointer transition-colors group"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                <div className="text-slate-300 text-sm">正在分析音频... {progress}%</div>
              </div>
            ) : (
              <>
                <Upload className="w-6 h-6 text-slate-500 group-hover:text-violet-400 mx-auto mb-2 transition-colors" />
                <p className="text-slate-300 text-sm">点击上传音频文件</p>
                <p className="text-xs text-slate-500 mt-1">支持 MP3, WAV, OGG 等格式</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="truncate max-w-[200px]">{audio.name}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono">{formatTime(audio.duration)}</span>
              <span className="text-slate-600">·</span>
              <span>{audio.beatMarkers.length} 个节奏点</span>
            </div>

            <div
              className="relative rounded-lg overflow-hidden cursor-pointer"
              onClick={handleSeek}
            >
              <canvas
                ref={waveformCanvasRef}
                className="w-full h-20 rounded-lg"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={togglePlay}
                className={cn(
                  'p-2 rounded-lg text-white transition-all',
                  isAudioPlaying
                    ? 'bg-orange-500 hover:bg-orange-400'
                    : 'bg-violet-600 hover:bg-violet-500'
                )}
              >
                {isAudioPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <div className="flex items-center gap-1 bg-slate-800 px-2 py-1.5 rounded-lg flex-1">
                <button
                  onClick={() => setAudioVolume(audioVolume === 0 ? 1 : 0)}
                  className="p-1 hover:bg-slate-700 text-slate-400 rounded transition-colors"
                >
                  {audioVolume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={audioVolume}
                  onChange={(e) => setAudioVolume(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                />
                <span className="text-xs text-slate-500 font-mono w-8 text-right">
                  {Math.round(audioVolume * 100)}
                </span>
              </div>

              <button
                onClick={handleAutoKeyframes}
                disabled={frames.length === 0}
                className="flex items-center gap-1 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
                title="在节奏点自动标记关键帧（加速动画）"
              >
                <Zap className="w-3.5 h-3.5" />
                自动打帧
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-800 px-2 py-1.5 rounded-lg flex-1">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs text-slate-400">节奏灵敏度</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={beatSensitivity}
                  onChange={(e) => setBeatSensitivity(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <span className="text-xs text-slate-500 font-mono w-8 text-right">
                  {Math.round(beatSensitivity * 100)}
                </span>
              </div>
            </div>

            {audio.beatMarkers.length > 0 && (
              <div className="max-h-24 overflow-y-auto">
                <div className="text-xs text-slate-500 mb-1">节奏点标记：</div>
                <div className="flex flex-wrap gap-1">
                  {audio.beatMarkers.slice(0, 40).map((beat, i) => (
                    <button
                      key={beat.id}
                      onClick={() => handleBeatClick(beat)}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-mono transition-all',
                        beatFlash[beat.frameIndex]
                          ? 'bg-amber-400 text-amber-900'
                          : 'bg-slate-800 hover:bg-violet-600 text-slate-400 hover:text-white',
                        beat.intensity > 0.7 && 'ring-1 ring-amber-500/50'
                      )}
                      style={{ opacity: 0.4 + beat.intensity * 0.6 }}
                      title={`第${beat.frameIndex + 1}帧 ${formatTime(beat.time)} 强度:${(beat.intensity * 100).toFixed(0)}%`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  {audio.beatMarkers.length > 40 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{audio.beatMarkers.length - 40} 更多
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg overflow-hidden">
              <canvas
                ref={spectrumCanvasRef}
                className="w-full h-12 rounded-lg"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
