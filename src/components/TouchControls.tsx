// Responsive on-screen touch controls (also works with mouse for desktop testing).
// Left side: directional + jump. Right side: punch / kick / block / special.

import { useEffect, useRef } from "react";
import { InputState } from "../game/engine";

interface Props {
  onChange: (i: Partial<InputState>) => void;
  specialReady: boolean;   // meter charged enough to fire the special
  weaponEquipped: boolean; // weapon currently in hand
  weaponThrown: boolean;   // weapon already thrown this round (gone)
  weaponEmoji: string;     // this fighter's weapon emoji
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
  // Stable refs so we attach the listeners ONCE — re-running this effect every
  // render (the old code did, via onDown/onUp deps) removed/re-added listeners
  // constantly and could drop inputs mid-tap.
  const downRef = useRef(onDown);
  const upRef = useRef(onUp);
  const disRef = useRef(disabled);
  downRef.current = onDown;
  upRef.current = onUp;
  disRef.current = disabled;

  useEffect(() => {
    const el = ref.current!;
    // Use Pointer Events: one unified handler for touch + mouse + pen, with
    // native multi-touch (setPointerCapture keeps a finger "grabbed" even if it
    // slides off the button — no more accidental releases from mouseleave).
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (disRef.current) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      downRef.current();
      el.classList.add("scale-90", "brightness-150");
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      upRef.current();
      el.classList.remove("scale-90", "brightness-150");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    // pointerleave is intentionally NOT bound — releasing only on pointerup
    // means a held button stays held while the finger drifts, matching the
    // feel of a real gamepad.
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <button
      ref={ref}
      className={`select-none rounded-full font-black text-white shadow-md active:shadow-none transition-all flex flex-col items-center justify-center leading-none border border-white/25 ${
        big ? "w-14 h-14 text-xl sm:w-16 sm:h-16 sm:text-2xl" : "w-11 h-11 text-base sm:w-12 sm:h-12 sm:text-lg"
      } ${disabled ? "opacity-35" : ""}`}
      style={{
        background: `radial-gradient(circle at 30% 25%, ${color}, ${color}99)`,
        touchAction: "none",
      }}
    >
      <span>{label}</span>
      {sub && <span className="text-[7px] sm:text-[8px] font-bold mt-0.5 opacity-90">{sub}</span>}
    </button>
  );
}

export default function TouchControls({
  onChange,
  specialReady,
  weaponEquipped,
  weaponThrown,
  weaponEmoji,
}: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-between px-2 pb-2 sm:px-4 sm:pb-4">
      {/* LEFT: movement */}
      <div className="pointer-events-auto flex items-end gap-1.5">
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
      <div className="pointer-events-auto flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
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
            color={specialReady ? "#f59e0b" : "#555"}
            big
            disabled={!specialReady}
            onDown={() => onChange({ special: true })}
            onUp={() => onChange({ special: false })}
          />
        </div>
        {/* Weapon row */}
        <div className="flex items-center gap-1.5">
          <HoldButton
            label={weaponThrown ? "∅" : weaponEquipped ? "🤚" : weaponEmoji}
            sub="HOLSTER"
            color={weaponThrown ? "#444" : "#7c5cff"}
            disabled={weaponThrown}
            onDown={() => onChange({ holster: true })}
            onUp={() => onChange({ holster: false })}
          />
          <HoldButton
            label={weaponEquipped && !weaponThrown ? weaponEmoji : "🚫"}
            sub="WEAPON"
            color={weaponEquipped && !weaponThrown ? "#16a34a" : "#444"}
            disabled={!weaponEquipped || weaponThrown}
            onDown={() => onChange({ weapon: true })}
            onUp={() => onChange({ weapon: false })}
          />
          <HoldButton
            label={weaponEquipped && !weaponThrown ? "🎯" : "🚫"}
            sub="THROW"
            color={weaponEquipped && !weaponThrown ? "#e11d48" : "#444"}
            disabled={!weaponEquipped || weaponThrown}
            onDown={() => onChange({ throwWeapon: true })}
            onUp={() => onChange({ throwWeapon: false })}
          />
        </div>
        <div className="flex items-center gap-1.5">
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
