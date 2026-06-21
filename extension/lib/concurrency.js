function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max parallel clone AI calls (1 = sequential, safest for OpenAI TPM). */
export const CLONE_AI_CONCURRENCY = 1;

/** Pause between prompt-generation calls. */
export const CLONE_AI_MIN_DELAY_MS = 2500;

/** Pause before each analyze call (after the first) — avoids OpenAI 429 TPM. */
export const CLONE_ANALYZE_DELAY_MS = 8000;

let lastAnalyzeFinishedAt = 0;

export async function waitBeforeNextAnalyze() {
  if (lastAnalyzeFinishedAt <= 0) return;
  const elapsed = Date.now() - lastAnalyzeFinishedAt;
  if (elapsed < CLONE_ANALYZE_DELAY_MS) {
    await sleep(CLONE_ANALYZE_DELAY_MS - elapsed);
  }
}

export function markAnalyzeFinished() {
  lastAnalyzeFinishedAt = Date.now();
}

/** Run async tasks sequentially (or capped) with optional sleep before each next task. */
export function runWithConcurrency(taskFns, concurrency, opts = {}) {
  const minDelayMs = opts.minDelayMs ?? 0;
  const sleepBeforeNext = opts.sleepBeforeNext !== false;

  return new Promise((resolve, reject) => {
    let cursor = 0;
    let active = 0;
    let failed = false;

    const runTask = async (fn, taskIndex) => {
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
