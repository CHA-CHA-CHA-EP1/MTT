import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function ZoomableContainer({ children, className }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Track container size for minimap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const clamp = (ox: number, oy: number, s: number, W: number, H: number) => {
    const maxX = W * (s - 1) / 2;
    const maxY = H * (s - 1) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, ox)),
      y: Math.min(maxY, Math.max(-maxY, oy)),
    };
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = rect.width;
    const H = rect.height;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;

    setScale(prevS => {
      const newS = Math.min(Math.max(prevS * factor, 1), 8);
      if (newS === prevS) return prevS;
      setOffset(prevO => {
        const raw = {
          x: mx - W / 2 - (mx - W / 2 - prevO.x) * (newS / prevS),
          y: my - H / 2 - (my - H / 2 - prevO.y) * (newS / prevS),
        };
        return clamp(raw.x, raw.y, newS, W, H);
      });
      return newS;
    });
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, [scale]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const { w: W, h: H } = containerSize;
    setOffset(o => clamp(o.x + dx, o.y + dy, scale, W, H));
  }, [scale, containerSize]);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden", position: "relative" }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onDoubleClick={scale > 1 ? reset : undefined}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: "center center",
        cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : undefined,
        userSelect: "none",
      }}>
        {children}
      </div>

      {scale > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); reset(); }}
          className="absolute right-2 top-2 z-10 rounded bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70"
        >
          {scale.toFixed(1)}× · reset
        </button>
      )}

      {/* Minimap */}
      {scale > 1 && containerSize.w > 0 && (() => {
        const { w: W, h: H } = containerSize;
        const mmW = 120;
        const mmH = mmW * (H / W);

        // Viewport top-left in content space (transformOrigin: center center)
        const vpX = W / 2 - (offset.x + W / 2) / scale;
        const vpY = H / 2 - (offset.y + H / 2) / scale;

        // Map to minimap coords
        const rx = (vpX / W) * mmW;
        const ry = (vpY / H) * mmH;
        const rw = mmW / scale;
        const rh = mmH / scale;

        return (
          <div
            className="absolute bottom-10 left-2 z-10 overflow-hidden rounded border border-white/20 bg-black/60"
            style={{ width: mmW, height: mmH }}
            title="Minimap — double-click video to reset zoom"
          >
            {/* Grid lines to suggest content */}
            <div className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)",
                backgroundSize: `${mmW / 4}px ${mmH / 4}px`,
              }}
            />
            {/* Viewport indicator */}
            <div
              className="absolute rounded-sm border border-white bg-white/20"
              style={{
                left: Math.max(0, rx),
                top: Math.max(0, ry),
                width: Math.min(mmW - Math.max(0, rx), rw),
                height: Math.min(mmH - Math.max(0, ry), rh),
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
