/** Max parallel clone AI calls in the extension (lower = fewer OpenAI 429s). */
export const CLONE_AI_CONCURRENCY = 2;

/** Run async tasks with a max in-flight cap (avoids OpenAI 429 TPM bursts). */
export function runWithConcurrency(taskFns, concurrency) {
  return new Promise((resolve, reject) => {
    let cursor = 0;
    let active = 0;
    let failed = false;

    const pump = () => {
      if (failed) return;
      if (cursor >= taskFns.length && active === 0) {
        resolve();
        return;
      }
      while (active < concurrency && cursor < taskFns.length) {
        const fn = taskFns[cursor++];
        active += 1;
        Promise.resolve()
          .then(fn)
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
