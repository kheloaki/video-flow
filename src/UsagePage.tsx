import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Coins, Loader2 } from "lucide-react";
import {
  fetchDailySummariesFromDb,
  fetchRecentUsageLogs,
  fetchUsageBalance,
  formatCostUsd,
  formatTokens,
  type UsageBalanceSummary,
} from "./utils/aiUsageDb.ts";
import { formatUsageLine, type AiUsageDaySummary, type AiUsageLogEntry, AI_USAGE_DB_CHANGED_EVENT } from "./utils/aiUsage.ts";
import { listCloneProjects, type CloneProject } from "./utils/cloneProjectDb.ts";

type Props = {
  userId: string;
  onBack: () => void;
  onContinueClone?: (projectId: string) => void;
};

function DayRow({ s }: { s: AiUsageDaySummary }) {
  const isToday = s.day === new Date().toISOString().slice(0, 10);
  if (s.callCount === 0 && !isToday) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
      <div>
        <span className="font-medium text-gray-800">{isToday ? "Today" : s.day}</span>
        <span className="text-gray-500 ml-2">
          {s.callCount} call{s.callCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="text-right tabular-nums shrink-0">
        <div className="font-semibold text-emerald-700">{formatCostUsd(s.totalCostUsd)}</div>
        <div className="text-xs text-gray-500">{formatTokens(s.totalTokens)} tok</div>
      </div>
    </div>
  );
}

export default function UsagePage({ userId, onBack, onContinueClone }: Props) {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<UsageBalanceSummary | null>(null);
  const [days, setDays] = useState<AiUsageDaySummary[]>([]);
  const [recent, setRecent] = useState<AiUsageLogEntry[]>([]);
  const [cloneProjects, setCloneProjects] = useState<CloneProject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bal, dayRows, logs, clones] = await Promise.all([
        fetchUsageBalance(userId),
        fetchDailySummariesFromDb(userId, 30),
        fetchRecentUsageLogs(userId, 40),
        listCloneProjects(userId),
      ]);
      setBalance(bal);
      setDays(dayRows);
      setRecent(logs);
      setCloneProjects(clones);
    } catch (e) {
      console.error("UsagePage load failed", e);
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Failed to load usage";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onDbChange = () => void reload();
    window.addEventListener(AI_USAGE_DB_CHANGED_EVENT, onDbChange);
    return () => window.removeEventListener(AI_USAGE_DB_CHANGED_EVENT, onDbChange);
  }, [reload]);

  const hasLimits =
    balance &&
    (balance.dailyBudgetUsd != null ||
      balance.dailyTokenLimit != null ||
      balance.monthlyBudgetUsd != null);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-16">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="bg-emerald-600 p-1.5 rounded-lg">
            <Coins className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-lg">Usage & balance</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {error ? (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          </div>
        ) : balance ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 uppercase">Today</p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                  {formatCostUsd(balance.today.totalCostUsd)}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  {formatTokens(balance.today.totalTokens)} · {balance.today.callCount} calls
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 uppercase">This month</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1">
                  {formatCostUsd(balance.month.totalCostUsd)}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  {formatTokens(balance.month.totalTokens)} · {balance.month.callCount} calls
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 uppercase">All time</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1">
                  {formatCostUsd(balance.allTime.totalCostUsd)}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  {formatTokens(balance.allTime.totalTokens)} · {balance.allTime.callCount} calls
                </p>
              </div>
            </div>

            {hasLimits ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
                <h2 className="font-semibold text-gray-800">Your limits (set by admin)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Daily $</p>
                    <p className="font-bold tabular-nums mt-1">
                      {balance.dailyBudgetUsd != null
                        ? `${formatCostUsd(balance.today.totalCostUsd)} / ${formatCostUsd(balance.dailyBudgetUsd)}`
                        : "No cap"}
                    </p>
                    {balance.dailyBudgetRemainingUsd != null ? (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatCostUsd(balance.dailyBudgetRemainingUsd)} left today
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Daily tokens</p>
                    <p className="font-bold tabular-nums mt-1">
                      {balance.dailyTokenLimit != null
                        ? `${formatTokens(balance.today.totalTokens)} / ${formatTokens(balance.dailyTokenLimit)}`
                        : "No cap"}
                    </p>
                    {balance.dailyTokensRemaining != null ? (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatTokens(balance.dailyTokensRemaining)} left today
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Monthly $</p>
                    <p className="font-bold tabular-nums mt-1">
                      {balance.monthlyBudgetUsd != null
                        ? `${formatCostUsd(balance.month.totalCostUsd)} / ${formatCostUsd(balance.monthlyBudgetUsd)}`
                        : "No cap"}
                    </p>
                    {balance.budgetRemainingUsd != null ? (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatCostUsd(balance.budgetRemainingUsd)} left this month
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {Object.keys(balance.today.byOperation).length > 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <h2 className="font-semibold text-gray-800 mb-3">Today by action</h2>
                <ul className="space-y-2 text-sm">
                  {Object.entries(balance.today.byOperation)
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

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-3">Last 30 days</h2>
              <div>
                {days.map((s) => (
                  <DayRow key={s.day} s={s} />
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-3">Recent API calls (saved)</h2>
              {recent.length === 0 ? (
                <p className="text-sm text-gray-500">Ma-kayn hta usage m-sauvegardé.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto text-xs">
                  {recent.map((e) => (
                    <li
                      key={e.id}
                      className="py-2 border-b border-gray-50 last:border-0"
                    >
                      <div className="font-medium text-gray-800">{e.label}</div>
                      <div className="text-gray-500 tabular-nums">{formatUsageLine(e)}</div>
                      <div className="text-gray-400">{new Date(e.at).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-3">Clone projects (saved)</h2>
              {cloneProjects.length === 0 ? (
                <p className="text-sm text-gray-500">Ma-kayn hta clone project f DB.</p>
              ) : (
                <ul className="space-y-3">
                  {cloneProjects.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100"
                    >
                      <div>
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500">
                          Step {p.step} · {p.status} · {p.data.scenes.length} scene(s)
                        </div>
                        <div className="text-xs text-gray-400">
                          Updated {new Date(p.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right tabular-nums flex flex-col items-end gap-1">
                        <div className="text-sm font-semibold text-emerald-700">
                          {formatCostUsd(p.totalCostUsd)}
                        </div>
                        <div className="text-[10px] text-gray-500">project AI cost</div>
                        {onContinueClone ? (
                          <button
                            type="button"
                            onClick={() => onContinueClone(p.id)}
                            className="text-sm font-semibold text-violet-700 hover:underline"
                          >
                            Continue →
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[11px] text-gray-400 leading-snug">
              Costs are estimates from token counts × published OpenAI/Gemini rates. Data is stored
              in your Supabase account per user.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
