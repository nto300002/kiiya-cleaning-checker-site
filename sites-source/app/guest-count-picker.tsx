"use client";

import { useEffect, useRef } from "react";

type Props = {
  roomCode: string;
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export default function GuestCountPicker({ roomCode, label, value, max, disabled, onChange }: Props) {
  const wheel = useRef<HTMLDivElement>(null);
  const selected = useRef(value);
  useEffect(() => {
    selected.current = value;
    wheel.current?.scrollTo({ top: value * 36 });
  }, [value]);

  const choose = (next: number) => {
    if (disabled) return;
    const count = Math.max(0, Math.min(max, next));
    selected.current = count;
    if (count !== value) onChange(count);
    wheel.current?.scrollTo({ top: count * 36 });
  };

  return <div className="guest-count-field">
    <span className="field-label">{label}</span>
    <div className="drum-picker guest-count-picker">
      <button type="button" className="drum-arrow" aria-label={`${roomCode}号室の${label}を1人減らす`} disabled={disabled || value <= 0} onClick={() => choose(value - 1)}>▲</button>
      <div
        ref={wheel}
        className="drum-window"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${roomCode}号室の${label}人数`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}人`}
        aria-disabled={disabled}
        onScroll={event => {
          if (disabled) return;
          const count = Math.max(0, Math.min(max, Math.round(event.currentTarget.scrollTop / 36)));
          if (count !== selected.current) {
            selected.current = count;
            onChange(count);
          }
        }}
        onKeyDown={event => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            choose(value + (event.key === "ArrowDown" ? 1 : -1));
          }
        }}
      >
        {Array.from({ length: max + 1 }, (_, count) => <div key={count} className={`drum-option ${count === value ? "selected" : ""}`} aria-selected={count === value} onClick={() => choose(count)}>{count}人</div>)}
      </div>
      <button type="button" className="drum-arrow" aria-label={`${roomCode}号室の${label}を1人増やす`} disabled={disabled || value >= max} onClick={() => choose(value + 1)}>▼</button>
      <small className="drum-hint">上下にスワイプして人数を選択</small>
    </div>
  </div>;
}
