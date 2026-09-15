/** Пороги под текущий VPS: 4 ГБ на сайт + конвейер. */
export const FILE_RISK_WARN_BYTES = 8 * 1024 * 1024;
/** Жёсткий потолок загрузки, пока конвейер на той же машине. */
export const FILE_RISK_DANGER_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = FILE_RISK_DANGER_BYTES;
export const FILE_RISK_WARN_PAGES = 8;
export const FILE_RISK_DANGER_PAGES = 16;

export type FileRiskLevel = "ok" | "warn" | "danger";

export type FileRisk = {
  level: FileRiskLevel;
  megabytes: number;
  pages: number | null;
  title: string;
  detail: string;
};

function mb(bytes: number) {
  return Math.max(0.1, bytes / (1024 * 1024));
}

function formatMb(bytes: number) {
  const value = mb(bytes);
  return value >= 10 ? `${Math.round(value)} МБ` : `${value.toFixed(1)} МБ`;
}

export function assessUploadRisk(files: File[]): FileRisk {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const megabytes = mb(bytes);
  if (bytes > FILE_RISK_DANGER_BYTES) {
    return {
      level: "danger",
      megabytes,
      pages: null,
      title: "Файл больше 20 МБ — загрузка закрыта",
      detail: `Размер ${formatMb(bytes)}. Пока конвейер на этом сервере, такие файлы роняют сайт. Возьмите файл меньше 20 МБ.`,
    };
  }
  if (bytes >= FILE_RISK_WARN_BYTES) {
    return {
      level: "warn",
      megabytes,
      pages: null,
      title: "Файл большой — сервер может не справиться",
      detail: `Размер ${formatMb(bytes)}. На этой машине мало памяти. Обработка может зависнуть или положить сайт.`,
    };
  }
  return {
    level: "ok",
    megabytes,
    pages: null,
    title: "",
    detail: "",
  };
}

export function assessPageRisk(pageCount: number): FileRisk {
  if (pageCount >= FILE_RISK_DANGER_PAGES) {
    return {
      level: "danger",
      megabytes: 0,
      pages: pageCount,
      title: "Слишком много листов для этого сервера",
      detail: `${pageCount} листов. Конвейер и сайт делят 4 ГБ. Такая пачка часто валит контейнер и весь сайт.`,
    };
  }
  if (pageCount >= FILE_RISK_WARN_PAGES) {
    return {
      level: "warn",
      megabytes: 0,
      pages: pageCount,
      title: "Много листов — сервер может не справиться",
      detail: `${pageCount} листов. На этой машине мало памяти. Обработка может зависнуть или положить сайт.`,
    };
  }
  return {
    level: "ok",
    megabytes: 0,
    pages: pageCount,
    title: "",
    detail: "",
  };
}
