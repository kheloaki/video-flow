import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  formatCostUsd,
  formatTokens,
  formatUsageDayLabel,
  type AiUsageDaySummary,
} from "../utils/aiUsage";

const RANGE_OPTIONS = [7, 14, 30, 90] as const;
export type DailyUsageRange = (typeof RANGE_OPTIONS)[number];

function cn(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  days: AiUsageDaySummary[];
  loading?: boolean;
  rangeDays: number;
  onRangeChange: (days: DailyUsageRange) => void;
  title?: string;
  description?: string;
  /** When true, list every day in the range (including $0). Default: only days with API calls. */
  defaultShowAllDays?: boolean;
  hideRangeSelector?: boolean;
};

export function DailyUsageBreakdown({
  days,
  loading,
  rangeDays,
  onRangeChange,
  title = "Usage by day",
  description = "Cost and tokens for each calendar day.",
  defaultShowAllDays = false,
  hideRangeSelector = false,
}: Props) {
  const [showAllDays, setShowAllDays] = useState(defaultShowAllDays);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const visibleDays = useMemo(() => {
    if (showAllDays) return days;
    return days.filter((d) => d.callCount > 0);
  }, [days, showAllDays]);

  const maxCost = useMemo(
    () => Math.max(0.000_001, ...days.map((d) => d.totalCostUsd)),
    [days]
  );

  const rangeTotal = useMemo(
    () =>
      days.reduce(
        (acc, d) => ({
          cost: acc.cost + d.totalCostUsd,
          tokens: acc.tokens + d.totalTokens,
          calls: acc.calls + d.callCount,
        }),
        { cost: 0, tokens: 0, calls: 0 }
      ),
    [days]
  );

  const daysWithUsage = days.filter((d) => d.callCount > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hideRangeSelector ? (
            <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {RANGE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onRangeChange(n)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-md transition-colors",
                    rangeDays === n
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {n}d
                </button>
              ))}
            </div>
          ) : null}
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAllDays}
              onChange={(e) => setShowAllDays(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show empty days
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-2 py-2">
          <p className="text-[10px] uppercase font-semibold text-gray-500">Period total</p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums mt-0.5">
            {formatCostUsd(rangeTotal.cost)}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-2 py-2">
          <p className="text-[10px] uppercase font-semibold text-gray-500">Active days</p>
          <p className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
            {daysWithUsage} / {days.length}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-2 py-2">
          <p className="text-[10px] uppercase font-semibold text-gray-500">Avg / active day</p>
          <p className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
            {daysWithUsage > 0
              ? formatCostUsd(rangeTotal.cost / daysWithUsage)
              : formatCostUsd(0)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : visibleDays.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No API usage in this period.
          {!showAllDays ? " Try “Show empty days” or a longer range." : null}
        </p>
      ) : (
        <ul className="space-y-1 max-h-[min(28rem,60vh)] overflow-y-auto pr-1">
          {visibleDays.map((d) => {
            const hasOps = Object.keys(d.byOperation).length > 0;
            const expanded = expandedDay === d.day;
            const barPct = Math.max(2, Math.round((d.totalCostUsd / maxCost) * 100));
            return (
              <li
                key={d.day}
                className={cn(
                  "rounded-xl border transition-colors",
                  d.callCount > 0 ? "border-gray-100 bg-gray-50/50" : "border-transparent"
                )}
              >
                <button
                  type="button"
                  disabled={!hasOps}
                  onClick={() => hasOps && setExpandedDay(expanded ? null : d.day)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-3",
                    hasOps && "hover:bg-gray-50 cursor-pointer",
                    !hasOps && "cursor-default"
                  )}
                >
                  <div className="w-[7.5rem] sm:w-36 shrink-0">
                    <div className="text-sm font-medium text-gray-900">
                      {formatUsageDayLabel(d.day)}
                    </div>
                    <div className="text-[11px] text-gray-400 tabular-nums">{d.day}</div>
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${d.callCount > 0 ? barPct : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums min-w-[5.5rem]">
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        d.callCount > 0 ? "text-emerald-700" : "text-gray-400"
                      )}
                    >
                      {formatCostUsd(d.totalCostUsd)}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {formatTokens(d.totalTokens)} · {d.callCount} call
                      {d.callCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  {hasOps ? (
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                        expanded && "rotate-180"
                      )}
                    />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                </button>
                {expanded && hasOps ? (
                  <ul className="px-3 pb-3 pt-0 space-y-1 border-t border-gray-100 mt-0">
                    {Object.entries(d.byOperation)
                      .sort((a, b) => b[1].costUsd - a[1].costUsd)
                      .map(([op, v]) => (
                        <li
                          key={op}
                          className="flex justify-between gap-2 text-xs py-1.5 px-2 rounded-lg bg-white"
                        >
                          <span className="text-gray-700 truncate">{op}</span>
                          <span className="shrink-0 tabular-nums text-gray-600">
                            {formatCostUsd(v.costUsd)} · {formatTokens(v.tokens)} · {v.count}×
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
