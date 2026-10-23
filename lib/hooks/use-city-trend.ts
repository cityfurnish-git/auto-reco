"use client";

// The last 14 days' traced rate per city, for the trend lines under the city
// rings (23 Oct 2026). Read from /api/leaderboard, which already owns the
// metric — one definition, so a ring's line and the leaderboard cannot differ.
// A failed read returns null and the card prints a dash; a trend line is
// decoration on a figure that is already printed, never the figure itself.

import { useEffect, useState } from "react";
import type { SparkPoint } from "@/components/kit/charts";

export interface DailyPoint {
  date: string;
  accuracy: number | null;
  movements: number;
  real: number;
}

export function useCityTrend(): Record<string, SparkPoint[]> | null {
  const [trend, setTrend] = useState<Record<string, SparkPoint[]> | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { daily?: Record<string, DailyPoint[]> } | null) => {
        if (!live || !j?.daily) return;
        const out: Record<string, SparkPoint[]> = {};
        for (const [city, pts] of Object.entries(j.daily)) {
          out[city] = pts.map((p) => ({ label: p.date, value: p.accuracy }));
        }
        setTrend(out);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return trend;
}
