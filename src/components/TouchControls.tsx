// Responsive on-screen touch controls (also works with mouse for desktop testing).
// Left side: directional + jump. Right side: punch / kick / block / special.

import { useEffect, useRef } from "react";
import { InputState } from "../game/engine";

interface Props {
  onChange: (i: Partial<InputState>) => void;
  meterPct: number;
}

function HoldButton({
  label,
  sub,
  color,
  big,
  onDown,
  onUp,
  disabled,
}: {
  label: string;
  sub?: string;
  color: string;
  big?: boolean;
  onDown: () => void;
  onUp: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const down = (e: Event) => {
      e.preventDefault();
      if (!disabled) {
        onDown();
        el.classList.add("scale-90", "brightness-150");
      }
    };
    const up = (e: Event) => {
      e.preventDefault();
      onUp();
      el.classList.remove("scale-90", "brightness-150");
    };
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", down);
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
      el.removeEventListener("mousedown", down);
      el.removeEventListener("mouseup", up);
      el.removeEventListener("mouseleave", up);
    };
  }, [onDown, onUp, disabled]);

  return (
    <button
      ref={ref}
      className={`select-none rounded-full font-black text-white shadow-lg active:shadow-none transition-all flex flex-col items-center justify-center leading-none border-2 border-white/30 ${
        big ? "w-20 h-20 text-3xl" : "w-16 h-16 text-2xl"
      } ${disabled ? "opacity-40" : ""}`}
      style={{
        background: `radial-gradient(circle at 30% 25%, ${color}, ${color}99)`,
        touchAction: "none",
      }}
    >
      <span>{label}</span>
      {sub && <span className="text-[9px] font-bold mt-0.5 opacity-90">{sub}</span>}
    </button>
  );
}

export default function TouchControls({ onChange, meterPct }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-between px-3 pb-3 sm:px-6 sm:pb-6">
      {/* LEFT: movement */}
      <div className="pointer-events-auto flex items-end gap-2">
        <HoldButton
          label="◀"
          color="#3b82f6"
          big
          onDown={() => onChange({ left: true })}
          onUp={() => onChange({ left: false })}
        />
        <HoldButton
          label="▶"
          color="#3b82f6"
          big
          onDown={() => onChange({ right: true })}
          onUp={() => onChange({ right: false })}
        />
      </div>

      {/* RIGHT: attacks (JUMP now lives here on the right side) */}
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <HoldButton
            label="🛡"
            sub="BLOCK"
            color="#64748b"
            onDown={() => onChange({ block: true })}
            onUp={() => onChange({ block: false })}
          />
          <HoldButton
            label="▲"
            sub="JUMP"
            color="#10b981"
            onDown={() => onChange({ jump: true })}
            onUp={() => onChange({ jump: false })}
          />
          <HoldButton
            label="💥"
            sub="SPECIAL"
            color={meterPct >= 50 ? "#f59e0b" : "#555"}
            big
            disabled={meterPct < 50}
            onDown={() => onChange({ special: true })}
            onUp={() => onChange({ special: false })}
          />
        </div>
        <div className="flex items-center gap-2">
          <HoldButton
            label="👊"
            sub="PUNCH"
            color="#ef4444"
            big
            onDown={() => onChange({ punch: true })}
            onUp={() => onChange({ punch: false })}
          />
          <HoldButton
            label="🦵"
            sub="KICK"
            color="#ec4899"
            big
            onDown={() => onChange({ kick: true })}
            onUp={() => onChange({ kick: false })}
          />
        </div>
      </div>
    </div>
  );
}
