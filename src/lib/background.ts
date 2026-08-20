export function runInBackground(task: Promise<unknown>) {
  void task.catch((error) => {
    console.error("background task failed", error);
  });
}
