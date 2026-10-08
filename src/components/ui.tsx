"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button aria-label="بستن" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100" aria-label="بستن">
            ×
          </button>
        </div>
        <div className="thin-scroll overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-lime-500" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "end-0.5" : "start-0.5"}`}
      />
    </button>
  );
}

export function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "black" | "lime" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap";
  const v =
    variant === "black"
      ? "bg-[#111214] text-white hover:bg-black"
      : variant === "lime"
        ? "bg-lime-400 text-black hover:bg-lime-300"
        : "border border-line bg-white text-gray-800 hover:bg-gray-50";
  return (
    <button title={title} onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}
