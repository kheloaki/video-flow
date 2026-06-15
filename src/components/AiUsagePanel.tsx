import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import {
  AI_USAGE_CHANGED_EVENT,
  AI_USAGE_DB_CHANGED_EVENT,
  formatCostUsd,
  formatTokens,
  formatUsageLine,
  getRecentDailySummaries,
  getRecentEntries,
  getTodaySummary,
  getAllTimeSummary,
  type AiUsageDaySummary,
} from "../utils/aiUsage";
import { fetchUsageBalance } from "../utils/aiUsageDb";

function DayRow({ s }: { s: AiUsageDaySummary }) {
  const isToday = s.day === new Date().toISOString().slice(0, 10);
  if (s.callCount === 0 && !isToday) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
      <div>
        <span className="font-medium text-gray-800">
          {isToday ? "Today" : s.day}
        </span>
        <span className="text-gray-500 ml-2">{s.callCount} call{s.callCount !== 1 ? "s" : ""}</span>
      </div>
      <div className="text-right tabular-nums shrink-0">
        <div className="font-semibold text-emerald-700">{formatCostUsd(s.totalCostUsd)}</div>
        <div className="text-xs text-gray-500">{formatTokens(s.totalTokens)} tok</div>
      </div>
    </div>
  );
}

type Props = {
  variant?: "compact" | "full";
};

export function AiUsageTodayBadge({ userId }: { userId?: string }) {
  const [localToday, setLocalToday] = useState(getTodaySummary);
  const [localAll, setLocalAll] = useState(getAllTimeSummary);
  const [dbToday, setDbToday] = useState<number | null>(null);
  const [dbAll, setDbAll] = useState<number | null>(null);

  useEffect(() => {
    const refreshLocal = () => {
      setLocalToday(getTodaySummary());
      setLocalAll(getAllTimeSummary());
    };
    window.addEventListener(AI_USAGE_CHANGED_EVENT, refreshLocal);
    return () => window.removeEventListener(AI_USAGE_CHANGED_EVENT, refreshLocal);
  }, []);

  useEffect(() => {
    if (!userId) {
      setDbToday(null);
      setDbAll(null);
      return;
    }
    const load = () => {
      void fetchUsageBalance(userId)
        .then((b) => {
          setDbToday(b.today.totalCostUsd);
          setDbAll(b.allTime.totalCostUsd);
        })
        .catch(() => {
          setDbToday(null);
          setDbAll(null);
        });
    };
    load();
    window.addEventListener(AI_USAGE_DB_CHANGED_EVENT, load);
    return () => window.removeEventListener(AI_USAGE_DB_CHANGED_EVENT, load);
  }, [userId]);

  const todayCost = userId && dbToday != null ? dbToday : localToday.totalCostUsd;
  const allCost = userId && dbAll != null ? dbAll : localAll.totalCostUsd;
  const hasUsage = todayCost > 0 || allCost > 0;
  if (!userId && !hasUsage) return null;

  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full tabular-nums"
      title={userId ? "AI spend (database)" : "AI spend (local)"}
    >
      <Coins className="w-3.5 h-3.5 shrink-0" />
      <span>
        Today <span className="font-semibold">{formatCostUsd(todayCost)}</span>
      </span>
      <span className="text-emerald-300" aria-hidden>
        |
      </span>
      <span>
        All <span className="font-semibold">{formatCostUsd(allCost)}</span>
      </span>
    </span>
  );
}

export function AiUsagePanel({ variant = "full" }: Props) {
  const [today, setToday] = useState(getTodaySummary);
  const [days, setDays] = useState(() => getRecentDailySummaries(14));
  const [recent, setRecent] = useState(() => getRecentEntries(20));

  useEffect(() => {
    const refresh = () => {
      setToday(getTodaySummary());
      setDays(getRecentDailySummaries(14));
      setRecent(getRecentEntries(20));
    };
    window.addEventListener(AI_USAGE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AI_USAGE_CHANGED_EVENT, refresh);
  }, []);

  if (variant === "compact") {
    return (
      <div className="text-sm">
        <div className="flex justify-between items-baseline">
          <span className="text-gray-600">Today</span>
          <span className="font-bold text-emerald-700 tabular-nums">
            {formatCostUsd(today.totalCostUsd)}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
          {formatTokens(today.totalTokens)} tokens · {today.callCount} calls
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-emerald-50/80 border border-emerald-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800 mb-1">
          Today (estimate)
        </p>
        <p className="text-2xl font-bold text-emerald-900 tabular-nums">
          {formatCostUsd(today.totalCostUsd)}
        </p>
        <p className="text-sm text-emerald-800/80 mt-1 tabular-nums">
          {formatTokens(today.totalTokens)} tokens · {today.callCount} API call
          {today.callCount !== 1 ? "s" : ""}
        </p>
      </div>

      {Object.keys(today.byOperation).length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Today by action
          </p>
          <ul className="space-y-1.5 text-sm">
            {Object.entries(today.byOperation)
              .sort((a, b) => b[1].costUsd - a[1].costUsd)
              .map(([op, v]) => (
                <li key={op} className="flex justify-between gap-2">
                  <span className="text-gray-700 truncate">{op}</span>
                  <span className="shrink-0 tabular-nums text-gray-600">
                    {formatCostUsd(v.costUsd)} · {formatTokens(v.tokens)}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Last 14 days
        </p>
        <div>
          {days.map((s) => (
            <DayRow key={s.day} s={s} />
          ))}
        </div>
      </div>

      {recent.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Recent calls
          </p>
          <ul className="space-y-2 max-h-48 overflow-y-auto text-xs">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-0.5 py-1.5 border-b border-gray-50 last:border-0"
              >
                <span className="font-medium text-gray-800">{e.label}</span>
                <span className="text-gray-500 tabular-nums">{formatUsageLine(e)}</span>
                <span className="text-gray-400">
                  {new Date(e.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[11px] text-gray-400 leading-snug">
        Estimates from OpenAI/Gemini token counts × published rates. When signed in, also saved to
        Supabase (see Usage page).
      </p>
    </div>
  );
}

export function AiUsageCostChip({ usage }: { usage: { totalTokens: number; costUsd: number; model: string } }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full tabular-nums">
      <Coins className="w-3 h-3" />
      {formatUsageLine(usage as import("../utils/aiUsage").AiUsagePayload)}
    </span>
  );
}
