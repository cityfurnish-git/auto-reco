"use client";

// Two tabs, not one scroll: each half owns a different date control (one business
// day vs an arbitrary range). On a single scrolling page the owner sets one picker
// and wonders why the other half did not move.

import { useRef, useState } from "react";
import { PageHeader } from "@/components/kit/layout";
import DayRecheckPanel from "./day-recheck-panel";
import MovementVolumesPanel from "./movement-volumes-panel";

const TABS = [
  { id: "recheck", label: "Day re-check" },
  { id: "volumes", label: "Movement volumes" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function StockAnalyserClient({
  today,
  defaultDate,
}: {
  today: string;
  defaultDate: string;
}) {
  const [tab, setTab] = useState<TabId>("recheck");
  const panelRef = useRef<HTMLDivElement>(null);

  const select = (id: TabId) => {
    setTab(id);
    // Move focus into the newly-shown panel so a keyboard user is not dumped back
    // at the top of the document.
    requestAnimationFrame(() => panelRef.current?.focus());
  };

  return (
    <div className="p-container-margin space-y-6">
      <PageHeader
        icon="fact_check"
        title="Stock Analyser"
        subtitle="Two views of the warehouses — how one day changed when we checked it again, and how much stock each warehouse handled over time."
      />

      <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist" aria-label="Stock Analyser views">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              id={`sa-tab-${t.id}`}
              aria-selected={active}
              aria-controls="sa-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              className={
                active
                  ? "px-4 py-2.5 text-sm font-semibold text-accent border-b-2 border-accent whitespace-nowrap"
                  : "px-4 py-2.5 text-sm text-text-secondary hover:text-accent whitespace-nowrap"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        id="sa-panel"
        role="tabpanel"
        aria-labelledby={`sa-tab-${tab}`}
        tabIndex={-1}
        ref={panelRef}
        className="outline-none"
      >
        {tab === "recheck" ? (
          <DayRecheckPanel defaultDate={defaultDate} today={today} />
        ) : (
          <MovementVolumesPanel today={today} />
        )}
      </div>
    </div>
  );
}
