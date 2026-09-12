"use client";

export function ViewerHint({
  show,
  wheelMode,
}: {
  show: boolean;
  wheelMode: "pan" | "zoom";
}) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
      <span className="rounded-md border border-border bg-white/95 px-2 py-1 text-xs text-muted shadow-sm">
        {wheelMode === "zoom"
          ? "колёсико — зум · Ctrl — сдвиг · Shift+рамка — приблизить"
          : "тяни мышью · колёсико — сдвиг · Ctrl — зум · Shift+рамка — приблизить"}
      </span>
    </div>
  );
}
