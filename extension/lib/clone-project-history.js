export const CLONE_WIZARD_STEPS = ["Split video", "Scenes", "Analyze", "Veo prompts"];

export function cloneProjectThumb(project) {
  for (const s of project.data?.scenes ?? []) {
    if (s.debutUrl?.startsWith("https://")) return s.debutUrl;
    if (s.finUrl?.startsWith("https://")) return s.finUrl;
  }
  return null;
}

export function cloneProjectStepLabel(step) {
  return CLONE_WIZARD_STEPS[Math.min(3, Math.max(0, (step || 1) - 1))] ?? `Step ${step}`;
}

export function cloneProjectMaxReachableStep(project) {
  const frameMeta = project.data?.frameMeta?.length ?? 0;
  const sceneCount = project.data?.scenes?.length ?? 0;
  if (sceneCount > 0) return 4;
  if (frameMeta > 0) return 2;
  return 1;
}

export function isCloneStepReachable(project, step) {
  const n = Math.min(4, Math.max(1, step || 1));
  if (n === 1) return true;
  if (n === 2) return (project.data?.frameMeta?.length ?? 0) > 0;
  return (project.data?.scenes?.length ?? 0) > 0;
}

export function cloneProjectResumeStep(project) {
  const saved = Math.min(4, Math.max(1, project.step || 1));
  if (isCloneStepReachable(project, saved)) return saved;
  return cloneProjectMaxReachableStep(project);
}

export function cloneProjectStepDone(project, step) {
  const scenes = project.data?.scenes ?? [];
  if (step === 1) return !!project.sourceVideoName || (project.data?.frameMeta?.length ?? 0) > 0;
  if (step === 2) return (project.data?.frameMeta?.length ?? 0) > 0 && scenes.length > 0;
  if (step === 3) {
    return scenes.length > 0 && scenes.every((s) => s.analyzeStatus === "done" || !!s.analysis?.trim());
  }
  if (step === 4) return scenes.some((s) => s.promptStatus === "done" || !!s.veoPrompt?.trim());
  return false;
}

export function formatRelativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function cloneProjectSummary(project) {
  const scenes = project.data?.scenes?.length ?? 0;
  const style = project.data?.contentStyle === "timelapse" ? "Timelapse" : "Standard";
  const analyzed = (project.data?.scenes ?? []).filter((s) => s.analyzeStatus === "done").length;
  const prompted = (project.data?.scenes ?? []).filter((s) => s.promptStatus === "done").length;
  return `${scenes} scene(s) · ${style} · ${analyzed}/${scenes} analyzed · ${prompted}/${scenes} prompts`;
}
