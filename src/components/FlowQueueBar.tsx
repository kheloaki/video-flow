import { useCallback, useState } from "react";
import { Cloud, ListPlus, Loader2 } from "lucide-react";
import { addFlowQueueScenes } from "../utils/flowQueueDb";
import type { FlowSceneExport } from "../utils/flowPrompt";

export { toFlowSceneExport, buildFlowPromptJson } from "../utils/flowPrompt";
export type { FlowSceneExport } from "../utils/flowPrompt";

type Props = {
  userId: string;
  projectId?: string | null;
  scenes: FlowSceneExport[];
  disabled?: boolean;
};

export function FlowQueueBar({ userId, projectId, scenes, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const readyScenes = scenes.filter(
    (s) => s.prompt.trim() && s.debutImageUrl && s.finImageUrl
  );

  const queueAll = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const count = await addFlowQueueScenes(userId, readyScenes, projectId);
      setMessage(
        `${count} scene(s) saved to your Flow queue in Supabase. Open the Chrome extension → Flow queue tab → Run selected.`
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save queue");
    } finally {
      setBusy(false);
    }
  }, [userId, projectId, readyScenes]);

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Cloud className="w-4 h-4 text-indigo-700" />
        <span className="text-sm font-semibold text-indigo-900">Google Flow queue (database)</span>
      </div>
      <p className="text-xs text-indigo-900/80 leading-snug">
        Queue scenes to Supabase — no link to the extension required. Use the Video Flow extension
        sidebar (signed in with the same account) → <strong>Flow queue</strong> to fill Google Flow.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy || readyScenes.length === 0}
          onClick={() => void queueAll()}
          className="text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListPlus className="w-4 h-4" />}
          Queue all to DB ({readyScenes.length})
        </button>
      </div>
      {message ? <p className="text-xs text-indigo-800">{message}</p> : null}
    </div>
  );
}

export function FlowQueueSceneButton({
  userId,
  projectId,
  scene,
  disabled,
}: {
  userId: string;
  projectId?: string | null;
  scene: FlowSceneExport;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const hasPrompt = scene.prompt.trim().length > 0;

  return (
    <button
      type="button"
      disabled={disabled || busy || !hasPrompt}
      title="Add to Flow queue in Supabase"
      onClick={() => {
        setBusy(true);
        void addFlowQueueScenes(userId, [scene], projectId)
          .then(() => window.alert("Scene added to Flow queue in Supabase. Open extension → Flow queue."))
          .catch((e) => window.alert(e instanceof Error ? e.message : "Queue failed"))
          .finally(() => setBusy(false));
      }}
      className="text-sm px-3 py-2 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50 hover:bg-indigo-100"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListPlus className="w-4 h-4" />}
      Queue
    </button>
  );
}
