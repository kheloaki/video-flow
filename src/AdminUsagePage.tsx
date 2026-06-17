import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import {
  fetchAdminUsageOverview,
  formatCostUsd,
  formatTokens,
  type AdminUsageOverview,
} from "./utils/adminUsageDb.ts";

type Props = {
  onBack: () => void;
};

export default function AdminUsagePage({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminUsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminUsageOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-16">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
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
          <div>
            <h1 className="font-bold text-lg">Admin — all users usage</h1>
            <p className="text-xs text-gray-500">This month · requires is_admin on your profile</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
            <p className="mt-2 text-xs text-red-700">
              Run <code className="bg-red-100 px-1 rounded">supabase/admin_profiles.sql</code> then{" "}
              <code className="bg-red-100 px-1 rounded">
                update profiles set is_admin = true where email = &apos;you@…&apos;;
              </code>
            </p>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Users active", String(data.totalUsers)],
                ["API calls", String(data.totalCalls)],
                ["Tokens", formatTokens(data.totalTokens)],
                ["Cost", formatCostUsd(data.totalCostUsd)],
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

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="font-bold mb-3">Per user (this month)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Calls</th>
                      <th className="py-2 pr-3">Tokens</th>
                      <th className="py-2 pr-3">Cost</th>
                      <th className="py-2">Last call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.userId} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-3 font-medium">
                          {u.email || <span className="text-gray-400">{u.userId.slice(0, 8)}…</span>}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{u.callCount}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatTokens(u.totalTokens)}</td>
                        <td className="py-2 pr-3 tabular-nums text-emerald-700 font-semibold">
                          {formatCostUsd(u.totalCostUsd)}
                        </td>
                        <td className="py-2 text-gray-500 text-xs">
                          {u.lastCallAt ? new Date(u.lastCallAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
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
