import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plug } from "lucide-react";
import {
  fillSceneInGoogleFlowNow,
  pingFlowExtension,
  queueAllScenesForGoogleFlow,
  queueSceneForGoogleFlow,
  type FlowSceneExport,
} from "../utils/flowExtension";

export { toFlowSceneExport } from "../utils/flowExtension";

type Props = {
  scenes: FlowSceneExport[];
  disabled?: boolean;
};

export function FlowExtensionBar({ scenes, disabled }: Props) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void pingFlowExtension().then(setConnected);
  }, []);

  const readyScenes = scenes.filter(
    (s) => s.prompt.trim() && s.debutImageUrl && s.finImageUrl
  );

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string; queueLength?: number }>) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fn();
        if (!res.ok) {
          setMessage(res.error ?? "Failed");
          return;
        }
        if (res.queueLength != null) {
          setMessage(`${res.queueLength} f queue — open extension sidebar → Web app queue → select scene → Fill.`);
        } else {
          setMessage("T-3mer Google Flow! Dir Generate f Flow.");
        }
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="w-4 h-4 text-indigo-700" />
        <span className="text-sm font-semibold text-indigo-900">Google Flow extension</span>
        {connected === null ? (
          <span className="text-xs text-gray-500">Checking…</span>
        ) : connected ? (
          <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
            Connected
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
            Not installed
          </span>
        )}
      </div>
      <p className="text-xs text-indigo-900/80 leading-snug">
        Extension sidebar saves to DB + local storage. Configure Supabase in extension Settings.
        Google Flow: auto 9:16, model, Generate — in Settings tab.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy || readyScenes.length === 0}
          onClick={() =>
            void run(() => queueAllScenesForGoogleFlow(readyScenes))
          }
          className="text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
          Queue all ({readyScenes.length})
        </button>
      </div>
      {message ? <p className="text-xs text-indigo-800">{message}</p> : null}
    </div>
  );
}

export function FlowExtensionSceneButton({
  scene,
  disabled,
}: {
  scene: FlowSceneExport;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const hasPrompt = scene.prompt.trim().length > 0;

  return (
    <button
      type="button"
      disabled={disabled || busy || !hasPrompt}
      title="Fill Google Flow (Start + End + full JSON package)"
      onClick={() => {
        setBusy(true);
        void fillSceneInGoogleFlowNow(scene)
          .then((res) => {
            if (!res.ok) window.alert(res.error ?? "Extension failed");
          })
          .finally(() => setBusy(false));
      }}
      className="text-sm px-3 py-2 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50 hover:bg-indigo-100"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
      Google Flow
    </button>
  );
}
