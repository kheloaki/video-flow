import { Clapperboard, Loader2, Play } from "lucide-react";
import type { CloneProject } from "../utils/cloneProjectDb";
import {
  CLONE_WIZARD_STEPS,
  cloneProjectResumeStep,
  cloneProjectStatusTone,
  cloneProjectStepDone,
  cloneProjectStepLabel,
  cloneProjectSummary,
  cloneProjectThumb,
  formatRelativeTime,
  isCloneStepReachable,
  type CloneWizardStep,
} from "../utils/cloneProjectHistory";
import { formatCostUsd } from "../utils/aiUsage";
import { PAGE_X } from "../utils/pageLayout";

function cn(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const statusStyles = {
  complete: "bg-green-100 text-green-800 border-green-200",
  analyzed: "bg-violet-100 text-violet-800 border-violet-200",
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  default: "bg-amber-50 text-amber-800 border-amber-200",
};

type Props = {
  projects: CloneProject[];
  loading?: boolean;
  activeProjectId?: string | null;
  activeStep?: CloneWizardStep | null;
  onOpen: (projectId: string, step?: CloneWizardStep) => void;
  emptyMessage?: string;
};

export function CloneProjectHistory({
  projects,
  loading,
  activeProjectId,
  activeStep,
  onOpen,
  emptyMessage = "No videos yet — upload one below to start.",
}: Props) {
  return (
    <section className="w-full border-b border-gray-200 bg-white">
      <div className={cn(PAGE_X, "py-4 sm:py-5")}>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-gray-900">Recent videos</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Your last clone projects — pick one to continue where you left off.
            </p>
          </div>
          {projects.length > 0 ? (
            <span className="text-xs font-medium text-gray-500 tabular-nums">
              {projects.length} saved
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
            <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
            Loading history…
          </div>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500 py-6">{emptyMessage}</p>
        ) : (
          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory [scrollbar-width:thin]">
            {projects.map((p) => {
              const thumb = cloneProjectThumb(p);
              const tone = cloneProjectStatusTone(p.status);
              const isActive = activeProjectId === p.id;
              return (
                <article
                  key={p.id}
                  className={cn(
                    "snap-start shrink-0 w-[min(100%,280px)] sm:w-[300px] lg:w-[min(22vw,320px)] flex flex-col rounded-xl border overflow-hidden transition-shadow hover:shadow-md",
                    isActive
                      ? "border-violet-400 ring-2 ring-violet-200 shadow-sm"
                      : "border-gray-200 bg-white"
                  )}
                >
                  <div className="relative aspect-[16/9] bg-gray-100">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-50 to-gray-100">
                        <Clapperboard className="w-10 h-10 text-violet-300" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                          statusStyles[tone]
                        )}
                      >
                        {p.status}
                      </span>
                      {p.data.contentStyle === "timelapse" ? (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-sky-100 text-sky-800 border-sky-200">
                          Timelapse
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 flex flex-col flex-1 gap-2 min-h-0">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate text-sm sm:text-base">
                        {p.name}
                      </h3>
                      {p.sourceVideoName ? (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{p.sourceVideoName}</p>
                      ) : null}
                    </div>
                    <p className="text-[11px] sm:text-xs text-gray-600 leading-snug line-clamp-2">
                      {cloneProjectSummary(p)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 mt-auto">
                      <span>{cloneProjectStepLabel(cloneProjectResumeStep(p))}</span>
                      <span aria-hidden>·</span>
                      <span>{formatRelativeTime(p.updatedAt)}</span>
                      {p.totalCostUsd > 0 ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-emerald-700 font-semibold tabular-nums">
                            {formatCostUsd(p.totalCostUsd)}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Jump to step">
                      {CLONE_WIZARD_STEPS.map((label, i) => {
                        const stepNum = (i + 1) as CloneWizardStep;
                        const reachable = isCloneStepReachable(p, stepNum);
                        const done = cloneProjectStepDone(p, stepNum);
                        const isCurrent = isActive && (activeStep ?? cloneProjectResumeStep(p)) === stepNum;
                        return (
                          <button
                            key={label}
                            type="button"
                            title={reachable ? `Open at step ${stepNum}: ${label}` : `${label} — not saved yet`}
                            disabled={!reachable}
                            onClick={() => onOpen(p.id, stepNum)}
                            className={cn(
                              "min-w-[2rem] px-1.5 py-1 rounded-md text-[10px] font-bold border transition-colors",
                              !reachable
                                ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                                : isCurrent
                                  ? "border-violet-500 bg-violet-600 text-white"
                                  : done
                                    ? "border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
                                    : "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                            )}
                          >
                            {stepNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpen(p.id, cloneProjectResumeStep(p))}
                      className={cn(
                        "mt-1 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                        isActive
                          ? "bg-violet-600 text-white"
                          : "bg-violet-50 text-violet-800 hover:bg-violet-100 border border-violet-200"
                      )}
                    >
                      <Play className="w-4 h-4" />
                      {isActive ? "Current project" : "Continue"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
