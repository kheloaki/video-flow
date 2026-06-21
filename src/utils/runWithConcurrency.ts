function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max parallel clone AI calls (1 = sequential, safest for OpenAI TPM). */
export const CLONE_AI_CONCURRENCY = Math.max(
  1,
  Number(import.meta.env.VITE_CLONE_AI_CONCURRENCY) || 1
);

/** Pause between prompt-generation calls. */
export const CLONE_AI_MIN_DELAY_MS = Math.max(
  0,
  Number(import.meta.env.VITE_CLONE_AI_MIN_DELAY_MS) || 2500
);

/**
 * Pause before each analyze call (after the first) — multi-frame vision uses ~30k TPM;
 * 200k org limit ≈ 1 analyze every 8–10s.
 */
export const CLONE_ANALYZE_DELAY_MS = Math.max(
  0,
  Number(import.meta.env.VITE_CLONE_ANALYZE_DELAY_MS) || 8000
);

let lastAnalyzeFinishedAt = 0;

/** Sleep if the previous analyze finished too recently (manual re-analyze + bulk queue). */
export async function waitBeforeNextAnalyze(): Promise<void> {
  if (lastAnalyzeFinishedAt <= 0) return;
  const elapsed = Date.now() - lastAnalyzeFinishedAt;
  if (elapsed < CLONE_ANALYZE_DELAY_MS) {
    await sleep(CLONE_ANALYZE_DELAY_MS - elapsed);
  }
}

export function markAnalyzeFinished(): void {
  lastAnalyzeFinishedAt = Date.now();
}

export function runWithConcurrency(
  taskFns: Array<() => Promise<void>>,
  concurrency: number,
  opts?: { minDelayMs?: number; sleepBeforeNext?: boolean }
): Promise<void> {
  const minDelayMs = opts?.minDelayMs ?? 0;
  const sleepBeforeNext = opts?.sleepBeforeNext !== false;

  return new Promise((resolve, reject) => {
    let cursor = 0;
    let active = 0;
    let failed = false;

    const runTask = async (fn: () => Promise<void>, taskIndex: number) => {
      if (sleepBeforeNext && minDelayMs > 0 && taskIndex > 0) {
        await sleep(minDelayMs);
      }
      await fn();
    };

    const pump = () => {
      if (failed) return;
      if (cursor >= taskFns.length && active === 0) {
        resolve();
        return;
      }
      while (active < concurrency && cursor < taskFns.length) {
        const taskIndex = cursor++;
        const fn = taskFns[taskIndex];
        active += 1;
        runTask(fn, taskIndex)
          .then(() => {
            active -= 1;
            pump();
          })
          .catch((e) => {
            failed = true;
            reject(e);
          });
      }
    };

    pump();
  });
}
