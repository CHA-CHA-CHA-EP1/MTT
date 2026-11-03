import { useCallback, useEffect, useRef, useState } from "react";
import { Player } from "./Player";

export interface DVRChunk {
  path: string;   // convertFileSrc URL
  offset: number; // start time in seconds (0, 30, 60, ...)
}

interface DVRPlayerProps {
  chunks: DVRChunk[];
  chunkDuration: number; // nominal seconds per chunk (30)
  onTimeUpdate: (absoluteTime: number) => void;
  onSeek: (seek: (absoluteTime: number) => void) => void;
}

export function DVRPlayer({ chunks, chunkDuration, onTimeUpdate, onSeek }: DVRPlayerProps) {
  const [chunkIdx, setChunkIdx] = useState(0);
  // offset within current chunk, kept in ref to avoid stale closure in seek callback
  const chunkIdxRef = useRef(0);

  const innerSeekRef = useRef<(t: number) => void>(() => {});

  // keep ref in sync with state
  useEffect(() => {
    chunkIdxRef.current = chunkIdx;
  }, [chunkIdx]);

  // Total playable duration = completed chunks × chunkDuration
  const totalDuration = chunks.length * chunkDuration;

  // Expose seekTo(absoluteTime) to parent (for clicking transcript segments)
  useEffect(() => {
    onSeek((absoluteTime: number) => {
      const clamped = Math.max(0, Math.min(absoluteTime, totalDuration - 0.01));
      const targetIdx = Math.min(
        Math.floor(clamped / chunkDuration),
        chunks.length - 1,
      );
      const offsetInChunk = clamped - targetIdx * chunkDuration;

      if (targetIdx === chunkIdxRef.current) {
        // same chunk — seek directly
        innerSeekRef.current(offsetInChunk);
      } else {
        // different chunk — switch src first, then seek after load
        setChunkIdx(targetIdx);
        // Player will call onSeek again once new src loads;
        // store pending seek so handleInnerSeekReady can apply it
        pendingSeekRef.current = offsetInChunk;
      }
    });
  }, [onSeek, chunks.length, chunkDuration, totalDuration]);

  const pendingSeekRef = useRef<number | null>(null);

  const handleInnerSeekReady = useCallback((seek: (t: number) => void) => {
    innerSeekRef.current = seek;
    if (pendingSeekRef.current !== null) {
      seek(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }, []);

  const handleTimeUpdate = useCallback(
    (t: number) => {
      onTimeUpdate(chunkIdxRef.current * chunkDuration + t);
    },
    [onTimeUpdate, chunkDuration],
  );

  const handleEnded = useCallback(() => {
    if (chunkIdxRef.current < chunks.length - 1) {
      setChunkIdx((i) => i + 1);
    }
  }, [chunks.length]);

  const src = chunks[chunkIdx]?.path ?? null;

  // reuse same logic as the onSeek callback for progress bar clicks
  const handleAbsoluteSeek = useCallback((absoluteTime: number) => {
    const clamped = Math.max(0, Math.min(absoluteTime, totalDuration - 0.01));
    const targetIdx = Math.min(
      Math.floor(clamped / chunkDuration),
      chunks.length - 1,
    );
    const offsetInChunk = clamped - targetIdx * chunkDuration;
    if (targetIdx === chunkIdxRef.current) {
      innerSeekRef.current(offsetInChunk);
    } else {
      setChunkIdx(targetIdx);
      pendingSeekRef.current = offsetInChunk;
    }
  }, [chunks.length, chunkDuration, totalDuration]);

  return (
    <Player
      src={src}
      totalDuration={totalDuration}
      chunkOffset={chunkIdx * chunkDuration}
      onTimeUpdate={handleTimeUpdate}
      onSeek={handleInnerSeekReady}
      onEnded={handleEnded}
      onAbsoluteSeek={handleAbsoluteSeek}
    />
  );
}
