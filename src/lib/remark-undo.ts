import type { AnnotationRect } from "@/types";

/** Последнее добавление или удаление замечания — чтобы «Отменить» его вернуло. */
export type RemarkUndo = {
  documentId: string;
  pageNumber: number;
  rect: AnnotationRect;
  comment: string;
  expected: string;
} & (
  | { kind: "add"; annotationId: string }
  | { kind: "delete" }
);
