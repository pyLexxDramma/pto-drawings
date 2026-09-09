/**
 * Отметка запуска приложения для журнала «Обновления прода»: пишется один раз
 * при старте и только при смене коммита.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordAppStart } = await import("@/lib/releases");
  await recordAppStart().catch(() => undefined);
}
