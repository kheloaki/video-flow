import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Save, Shield } from "lucide-react";
import {
  fetchAdminUsageOverview,
  formatCostUsd,
  formatTokens,
  updateAdminUserLimits,
  updateAdminUserStatus,
  type AdminUsageOverview,
  type AdminUserRow,
} from "./utils/adminUsageDb.ts";
import type { AccountStatus } from "./utils/profileDb.ts";
import { accountStatusLabel } from "./utils/profileDb.ts";
import { daysElapsedThisMonth, formatUsageDayLabel } from "./utils/aiUsage.ts";
import { DailyUsageBreakdown } from "./components/DailyUsageBreakdown.tsx";
import { PAGE_X } from "./utils/pageLayout.ts";

type Props = {
  onBack: () => void;
};

type LimitDraft = {
  dailyBudgetUsd: string;
  dailyTokenLimit: string;
  monthlyBudgetUsd: string;
};

function limitsToDraft(limits: AdminUserRow["limits"]): LimitDraft {
  return {
    dailyBudgetUsd:
      limits.dailyBudgetUsd != null ? String(limits.dailyBudgetUsd) : "",
    dailyTokenLimit:
      limits.dailyTokenLimit != null ? String(limits.dailyTokenLimit) : "",
    monthlyBudgetUsd:
      limits.monthlyBudgetUsd != null ? String(limits.monthlyBudgetUsd) : "",
  };
}

function parseLimitInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Limits must be positive numbers or empty.");
  return n;
}

export default function AdminUsagePage({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminUsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LimitDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await fetchAdminUsageOverview();
      setData(overview);
      const next: Record<string, LimitDraft> = {};
      for (const u of overview.users) {
        next[u.userId] = limitsToDraft(u.limits);
      }
      setDrafts(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveLimits = async (user: AdminUserRow) => {
    setSavingId(user.userId);
    setRowError(null);
    try {
      const draft = drafts[user.userId] ?? limitsToDraft(user.limits);
      await updateAdminUserLimits(user.userId, {
        dailyBudgetUsd: parseLimitInput(draft.dailyBudgetUsd),
        dailyTokenLimit: parseLimitInput(draft.dailyTokenLimit),
        monthlyBudgetUsd: parseLimitInput(draft.monthlyBudgetUsd),
      });
      await reload();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const saveStatus = async (user: AdminUserRow, accountStatus: AccountStatus) => {
    setSavingStatusId(user.userId);
    setRowError(null);
    try {
      await updateAdminUserStatus(user.userId, accountStatus);
      await reload();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setSavingStatusId(null);
    }
  };

  const setDraft = (userId: string, field: keyof LimitDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? { dailyBudgetUsd: "", dailyTokenLimit: "", monthlyBudgetUsd: "" }), [field]: value },
    }));
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-16">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className={`${PAGE_X} py-3 flex items-center gap-3`}>
          <button
            type="button"
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="bg-slate-800 p-1.5 rounded-lg">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg">Admin — users & limits</h1>
            <p className="text-xs text-gray-500">
              All accounts · usage this month · set daily $ / tokens / monthly $
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className={`${PAGE_X} py-6 space-y-6`}>
        {loading && !data ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
            <p className="mt-2 text-xs text-red-700">
              Run <code className="bg-red-100 px-1 rounded">supabase/admin_rls_fix.sql</code> in
              Supabase SQL Editor, then{" "}
              <code className="bg-red-100 px-1 rounded">
                update profiles set is_admin = true where email = &apos;you@…&apos;;
              </code>
            </p>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["All users", String(data.totalUsers)],
                ["API calls (month)", String(data.totalCalls)],
                ["Tokens (month)", formatTokens(data.totalTokens)],
                ["Cost (month)", formatCostUsd(data.totalCostUsd)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4"
                >
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <DailyUsageBreakdown
              days={data.platformDailyThisMonth}
              rangeDays={daysElapsedThisMonth()}
              onRangeChange={() => {}}
              hideRangeSelector
              title="Platform usage by day (this month)"
              description="Combined API spend across all users, per calendar day."
            />

            {rowError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {rowError}
              </div>
            ) : null}

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 overflow-hidden">
              <h2 className="font-bold mb-3">All users</h2>
              <p className="text-xs text-gray-500 mb-4">
                New users start as <strong>Pending</strong> until you set them to Active. Empty limit
                = no cap. Daily limits reset at midnight.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Today</th>
                      <th className="py-2 pr-3">Month</th>
                      <th className="py-2 pr-3">Daily $ cap</th>
                      <th className="py-2 pr-3">Daily tokens</th>
                      <th className="py-2 pr-3">Monthly $ cap</th>
                      <th className="py-2">Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-500">
                          <p className="font-medium text-gray-700">No users in profiles table</p>
                          <p className="text-xs mt-2 max-w-md mx-auto">
                            Run{" "}
                            <code className="bg-gray-100 px-1 rounded">supabase/admin_rls_fix.sql</code>{" "}
                            in Supabase SQL Editor — it syncs all accounts from Auth and fixes admin
                            permissions. Then set{" "}
                            <code className="bg-gray-100 px-1 rounded">
                              is_admin = true
                            </code>{" "}
                            on your email.
                          </p>
                        </td>
                      </tr>
                    ) : (
                    data.users.map((u) => {
                      const draft = drafts[u.userId] ?? limitsToDraft(u.limits);
                      const overDailyUsd =
                        u.limits.dailyBudgetUsd != null &&
                        u.today.totalCostUsd >= u.limits.dailyBudgetUsd;
                      const overDailyTokens =
                        u.limits.dailyTokenLimit != null &&
                        u.today.totalTokens >= u.limits.dailyTokenLimit;
                      const overMonthly =
                        u.limits.monthlyBudgetUsd != null &&
                        u.month.totalCostUsd >= u.limits.monthlyBudgetUsd;
                      return (
                        <tr key={u.userId} className="border-b border-gray-50 last:border-0 align-top">
                          <td className="py-3 pr-3">
                            <div className="font-medium">
                              {u.email || (
                                <span className="text-gray-400">{u.userId.slice(0, 8)}…</span>
                              )}
                            </div>
                            {u.isAdmin ? (
                              <span className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold">
                                admin
                              </span>
                            ) : null}
                            <div className="text-xs text-gray-400 mt-1">
                              {u.lastCallAt
                                ? `Last: ${new Date(u.lastCallAt).toLocaleString()}`
                                : "No calls this month"}
                            </div>
                            {u.dailyThisMonth.some((d) => d.callCount > 0) ? (
                              <details className="mt-2">
                                <summary className="text-xs font-semibold text-violet-700 cursor-pointer">
                                  Daily breakdown
                                </summary>
                                <ul className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                                  {u.dailyThisMonth
                                    .filter((d) => d.callCount > 0)
                                    .map((d) => (
                                      <li
                                        key={d.day}
                                        className="flex justify-between gap-2 text-[11px] tabular-nums"
                                      >
                                        <span className="text-gray-600">
                                          {formatUsageDayLabel(d.day)}
                                        </span>
                                        <span className="text-emerald-700 font-medium">
                                          {formatCostUsd(d.totalCostUsd)}
                                        </span>
                                      </li>
                                    ))}
                                </ul>
                              </details>
                            ) : null}
                          </td>
                          <td className="py-3 pr-3">
                            <select
                              value={u.accountStatus}
                              disabled={savingStatusId === u.userId}
                              onChange={(e) =>
                                void saveStatus(u, e.target.value as AccountStatus)
                              }
                              className={`px-2 py-1.5 border rounded-lg text-xs font-semibold ${
                                u.accountStatus === "active"
                                  ? "border-green-200 bg-green-50 text-green-800"
                                  : u.accountStatus === "pending"
                                    ? "border-amber-200 bg-amber-50 text-amber-900"
                                    : "border-gray-200 bg-gray-100 text-gray-700"
                              }`}
                            >
                              <option value="pending">{accountStatusLabel("pending")}</option>
                              <option value="active">{accountStatusLabel("active")}</option>
                              <option value="inactive">{accountStatusLabel("inactive")}</option>
                            </select>
                          </td>
                          <td className="py-3 pr-3 tabular-nums text-xs">
                            <div className={overDailyUsd || overDailyTokens ? "text-red-600 font-semibold" : ""}>
                              {formatCostUsd(u.today.totalCostUsd)}
                            </div>
                            <div className="text-gray-500">{formatTokens(u.today.totalTokens)}</div>
                            <div className="text-gray-400">{u.today.callCount} calls</div>
                          </td>
                          <td className="py-3 pr-3 tabular-nums text-xs">
                            <div className={overMonthly ? "text-red-600 font-semibold" : "text-emerald-700 font-semibold"}>
                              {formatCostUsd(u.month.totalCostUsd)}
                            </div>
                            <div className="text-gray-500">{formatTokens(u.month.totalTokens)}</div>
                            <div className="text-gray-400">{u.month.callCount} calls</div>
                          </td>
                          <td className="py-3 pr-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="—"
                              value={draft.dailyBudgetUsd}
                              onChange={(e) => setDraft(u.userId, "dailyBudgetUsd", e.target.value)}
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="py-3 pr-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="—"
                              value={draft.dailyTokenLimit}
                              onChange={(e) => setDraft(u.userId, "dailyTokenLimit", e.target.value)}
                              className="w-24 px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="py-3 pr-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="—"
                              value={draft.monthlyBudgetUsd}
                              onChange={(e) => setDraft(u.userId, "monthlyBudgetUsd", e.target.value)}
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="py-3">
                            <button
                              type="button"
                              disabled={savingId === u.userId}
                              onClick={() => void saveLimits(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50"
                            >
                              {savingId === u.userId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="font-bold mb-3">Recent API calls (all users)</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex justify-between gap-3 text-sm border-b border-gray-50 pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{log.label}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(log.at).toLocaleString()} · {log.model}
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="font-semibold text-emerald-700">
                        {formatCostUsd(log.costUsd)}
                      </div>
                      <div className="text-xs text-gray-500">{formatTokens(log.totalTokens)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
