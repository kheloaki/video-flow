import { Clapperboard, LogOut, Sparkles } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Props = {
  onOpenFlow: () => void;
  onOpenClone: () => void;
  onLogout: () => void;
  userEmail?: string | null;
};

export function ProductHub({ onOpenFlow, onOpenClone, onLogout, userEmail }: Props) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-orange-500 p-1.5 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">Video Flow</span>
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
              l-Google Veo.
            </p>
            <span className="inline-block mt-5 text-sm font-semibold text-violet-600">Bda →</span>
          </button>
        </div>
      </main>
    </div>
  );
}
