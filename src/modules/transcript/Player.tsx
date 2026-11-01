import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, ChevronDown,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface PlayerProps {
  src: string | null;
  onTimeUpdate: (t: number) => void;
  onSeek: (seek: (time: number) => void) => void;
}

export function Player({ src, onTimeUpdate, onSeek }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeeds, setShowSpeeds] = useState(false);
  const [dragging, setDragging] = useState(false);

  // expose seekTo to parent
  useEffect(() => {
    onSeek((time: number) => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    });
  }, [onSeek]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    playing ? v.pause() : v.play();
  };

  const skip = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), duration);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !muted;
    setMuted(!muted);
  };

  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    setVolume(val);
    setMuted(val === 0);
  };

  const changeSpeed = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
    setSpeed(s);
    setShowSpeeds(false);
  };

  const seekFromEvent = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    v.currentTime = ratio * duration;
  }, [duration]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "ArrowLeft") skip(-5);
      if (e.code === "ArrowRight") skip(5);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playing, duration]);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex h-full flex-col bg-black">
      {/* Video */}
      <video
        ref={videoRef}
        src={src ?? undefined}
        className="min-h-0 w-full flex-1 object-contain"
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (!dragging) setCurrentTime(t);
          onTimeUpdate(t);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {/* Controls */}
      <div className="flex flex-col gap-2 bg-black/90 px-4 pb-3 pt-3">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="group relative h-1 cursor-pointer rounded-full bg-white/20 hover:h-2 transition-all"
          onClick={seekFromEvent}
          onMouseDown={(e) => { setDragging(true); seekFromEvent(e); }}
          onMouseMove={(e) => { if (dragging) seekFromEvent(e); }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
        >
          <div
            className="h-full rounded-full bg-white transition-none"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity shadow"
            style={{ left: `${progress}%`, transform: "translate(-50%, -50%)" }}
          />
        </div>

        {/* Buttons row */}
        <div className="flex items-center gap-2 text-white">
          {/* Skip back */}
          <button onClick={() => skip(-10)} title="Back 10s (←)" className="rounded p-1 hover:bg-white/10">
            <SkipBack className="h-4 w-4" />
          </button>

          {/* Play/Pause */}
          <button onClick={togglePlay} title="Play/Pause (Space)" className="rounded p-1.5 hover:bg-white/10">
            {playing
              ? <Pause className="h-5 w-5 fill-white" />
              : <Play className="h-5 w-5 fill-white" />}
          </button>

          {/* Skip forward */}
          <button onClick={() => skip(10)} title="Forward 10s (→)" className="rounded p-1 hover:bg-white/10">
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Time */}
          <span className="ml-1 text-xs tabular-nums text-white/70">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div className="flex-1" />

          {/* Volume */}
          <div className="flex items-center gap-1.5">
            <button onClick={toggleMute} className="rounded p-1 hover:bg-white/10">
              {muted || volume === 0
                ? <VolumeX className="h-4 w-4" />
                : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range" min={0} max={1} step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="w-16 accent-white"
            />
          </div>

          {/* Speed */}
          <div className="relative">
            <button
              onClick={() => setShowSpeeds((s) => !s)}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs hover:bg-white/10"
            >
              {speed}×<ChevronDown className="h-3 w-3" />
            </button>
            {showSpeeds && (
              <div className="absolute bottom-full right-0 mb-1 rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={cn(
                      "block w-full px-4 py-1 text-left text-xs hover:bg-white/10",
                      s === speed && "text-white font-medium"
                    )}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
