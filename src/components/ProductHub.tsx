import { Clapperboard, Coins, LogOut, Shield, Sparkles } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AiUsageTodayBadge } from "./AiUsagePanel";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Props = {
  onOpenFlow: () => void;
  onOpenClone: () => void;
  onOpenUsage: () => void;
  onOpenAdmin?: () => void;
  onLogout: () => void;
  userEmail?: string | null;
  userId?: string;
  isAdmin?: boolean;
};

export function ProductHub({
  onOpenFlow,
  onOpenClone,
  onOpenUsage,
  onOpenAdmin,
  onLogout,
  userEmail,
  userId,
  isAdmin,
}: Props) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-orange-500 p-1.5 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">Video Flow</span>
            <AiUsageTodayBadge userId={userId} />
          </div>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10 sm:py-16">
        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Chno bghiti t-dir?</h1>
          {userEmail ? (
            <p className="text-sm text-gray-500 mt-2 truncate">{userEmail}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            type="button"
            onClick={onOpenFlow}
            className={cn(
              "text-left bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8",
              "hover:border-orange-200 hover:shadow-md transition-all group"
            )}
          >
            <div className="bg-orange-500 w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold mb-2">Video Flow</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Generi scripts Darija, produits, webhook Make, Veo packages — l-workflow dialk l-9dim.
            </p>
            <span className="inline-block mt-5 text-sm font-semibold text-orange-600">Fte7 →</span>
          </button>

          <button
            type="button"
            onClick={onOpenClone}
            className={cn(
              "text-left bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8",
              "hover:border-violet-200 hover:shadow-md transition-all group"
            )}
          >
            <div className="bg-violet-600 w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <Clapperboard className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold mb-2">Clone Video</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Upload video, split frames, analyze chno tbeddel scene b scene, w generi prompts + images
              l-Veo. Auto-save f DB.
            </p>
            <span className="inline-block mt-5 text-sm font-semibold text-violet-600">Fte7 →</span>
          </button>

          <button
            type="button"
            onClick={onOpenUsage}
            className={cn(
              "text-left bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 sm:col-span-2",
              "hover:border-emerald-200 hover:shadow-md transition-all group"
            )}
          >
            <div className="bg-emerald-600 w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <Coins className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold mb-2">Usage & balance</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Chof tokens w cost dial kol API call, total dial l-youm w d-chhr, budget remaining, w
              clone projects li t-sauvegardaw.
            </p>
            <span className="inline-block mt-5 text-sm font-semibold text-emerald-600">Fte7 →</span>
          </button>

          {isAdmin && onOpenAdmin ? (
            <button
              type="button"
              onClick={onOpenAdmin}
              className={cn(
                "text-left bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 sm:col-span-2",
                "hover:border-slate-300 hover:shadow-md transition-all group"
              )}
            >
              <div className="bg-slate-800 w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-xl font-bold mb-2">Admin — users & limits</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                Chof kol l-users, usage dial l-youm w d-chhr, w 7dd caps: daily $, daily tokens, monthly $.
              </p>
              <span className="inline-block mt-5 text-sm font-semibold text-slate-700">Fte7 →</span>
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
