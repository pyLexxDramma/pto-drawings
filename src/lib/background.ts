export function runInBackground(task: Promise<unknown>) {
  if (process.env.VERCEL) {
    void import("@vercel/functions").then(({ waitUntil }) => waitUntil(task));
    return;
  }

  void task.catch((error) => {
    console.error("background task failed", error);
  });
}
