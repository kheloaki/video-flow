import { useCallback, useEffect, useRef, useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Download, Share2, Smartphone, X } from "lucide-react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STORAGE_KEY = "videoFlow_pwa_install_dismissed_at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const t = parseInt(raw, 10);
    if (Number.isNaN(t)) return false;
    return Date.now() - t < DISMISS_MS;
  } catch {
    return false;
  }
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Popup to install the PWA on home screen (Chrome/Edge/Android).
 * iOS Safari: shows how to use Share → Add to Home Screen (no native install prompt).
 */
export function InstallAppPrompt() {
  const [visible, setVisible] = useState(false);
  const [iosMode, setIosMode] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const bipReceivedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (isDismissedRecently()) return;

    const isIOS = detectIOS();

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      bipReceivedRef.current = true;
      deferredRef.current = e as BeforeInstallPromptEvent;
      setIosMode(false);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIOS) {
      timer = setTimeout(() => {
        if (bipReceivedRef.current || isStandalone() || isDismissedRecently()) return;
        deferredRef.current = null;
        setIosMode(true);
        setVisible(true);
      }, 4000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
    deferredRef.current = null;
  }, []);

  const install = useCallback(async () => {
    const ev = deferredRef.current;
    if (!ev) return;
    try {
      await ev.prompt();
      await ev.userChoice.catch(() => {});
    } catch {
      /* ignore */
    }
    deferredRef.current = null;
    dismiss();
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-3 sm:p-4 bg-black/50 backdrop-blur-[1px]"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        className={cn(
          "w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-0 motion-safe:animate-[fadeSlide_0.25s_ease-out]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes fadeSlide {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 bg-gradient-to-br from-orange-50 to-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-12 h-12 rounded-2xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200">
              <Smartphone className="w-6 h-6 text-white" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 id="pwa-install-title" className="font-bold text-lg text-gray-900 leading-tight">
                {iosMode ? "Zid Video Flow f l-écran" : "Installer Video Flow"}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {iosMode
                  ? "Safari ma-kay3tikch bouton install — derni étapes:"
                  : "Zid l-app f home screen bach t7ellha b ser3a, bla bar dial navigateur."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {iosMode ? (
            <ol className="text-sm text-gray-700 space-y-3 list-decimal list-inside">
              <li className="pl-1">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Share2 className="w-4 h-4 text-orange-500 shrink-0" />
                  Dghya 3la <strong>Share</strong> (l-mocharaka) f Safari
                </span>
              </li>
              <li>
                Khtar <strong>Add to Home Screen</strong> / <strong>Sur l&apos;écran d&apos;accueil</strong>
              </li>
              <li>
                Confirmi b <strong>Add</strong> — ghadi tl9a icon Video Flow f home dialk
              </li>
            </ol>
          ) : (
            <p className="text-sm text-gray-600">
              Ghadi t9der t7ell l-app b7al application: bla bar dial navigateur, sari3, o katbqaa f téléphone.
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={dismiss}
              className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Daba la
            </button>
            {!iosMode && deferredRef.current && (
              <button
                type="button"
                onClick={() => void install()}
                className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Installer
              </button>
            )}
            {iosMode && (
              <button
                type="button"
                onClick={dismiss}
                className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition-colors"
              >
                Fhamt
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
