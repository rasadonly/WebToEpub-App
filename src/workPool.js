// Shared resource budget: jobs may overlap without multiplying network/heap use.
export const DEFAULT_MAX_ACTIVE_JOBS = 40;

export function createWorkPool(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid work pool limit");
  let active = 0;
  const queue = [];
  function pump() {
    while (active < limit && queue.length) {
      const { work, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  }
  return {
    run(work) {
      return new Promise((resolve, reject) => {
        queue.push({ work, resolve, reject });
        pump();
      });
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}