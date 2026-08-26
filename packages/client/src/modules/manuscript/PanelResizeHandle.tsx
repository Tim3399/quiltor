import type {
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export interface PanelResizeHandleProps {
  containerRef: MutableRefObject<HTMLElement | null>;
  edge: "start" | "end";
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Keyboard- and pointer-accessible resize separator shared by manuscript side panels. */
export function PanelResizeHandle({
  containerRef,
  edge,
  label,
  value,
  min,
  max,
  step = 10,
  onChange,
}: PanelResizeHandleProps) {
  const change = (next: number) => onChange(clamp(next, min, max));
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = container.getBoundingClientRect();
    const move = (next: PointerEvent) =>
      change(edge === "end" ? next.clientX - bounds.left : bounds.right - next.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const physicalDirection = event.key === "ArrowRight" ? 1 : -1;
    change(value + physicalDirection * step * (edge === "end" ? 1 : -1));
  };

  return (
    <div
      className={`panel-resize-handle panel-resize-handle--${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
