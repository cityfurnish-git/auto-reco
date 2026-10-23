// Page furniture shared by every dashboard page (23 Oct 2026): one header
// shape and one boxed-card shape, so ten pages cannot grow ten looks.
//
// No "use client": plain markup.

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";

/** Title, one line saying what the page is for, and an optional right slot. */
export function PageHeader({ title, subtitle, icon, right }: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {icon && (
          <span className="w-12 h-12 rounded-2xl bg-accent-soft text-accent grid place-items-center shrink-0">
            <Icon name={icon} size={24} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-headline text-2xl md:text-3xl text-text-primary leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** A soft card with a titled header row. */
export function BoxCard({ title, icon, right, children, className = "" }: {
  title: ReactNode;
  icon?: IconName;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`soft-card p-5 flex flex-col gap-4 min-w-0 ${className}`}>
      {/* One line, always: a title that wrapped pushed its side label onto
          two lines beside it (owner, 23 Oct 2026). */}
      <div className="flex items-center justify-between gap-3 min-w-0">
        <h3 className="font-headline text-lg text-text-primary flex items-center gap-2 min-w-0 whitespace-nowrap">
          {icon && <Icon name={icon} size={18} className="text-accent shrink-0" />}
          <span className="truncate">{title}</span>
        </h3>
        {right && <span className="text-xs text-text-muted whitespace-nowrap shrink-0">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** A row of mutually exclusive choices — time windows, views. */
export function Pills<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="bg-surface-card rounded-xl p-1 flex shadow-sm" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={
            value === o.key
              ? "px-4 py-1.5 text-sm font-semibold rounded-lg bg-accent text-on-accent"
              : "px-4 py-1.5 text-sm text-text-secondary rounded-lg hover:bg-accent-soft transition-colors duration-150"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
