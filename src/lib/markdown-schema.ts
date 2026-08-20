import { defaultSchema } from "rehype-sanitize";

const STYLED_TAGS = ["span", "sub", "sup", "td", "th", "tr", "div", "p"];

/**
 * Эталонные листы используют inline-HTML (<sub>, <br>, цветные подписи).
 * Разрешаем ровно оформление и никогда — скрипты, ссылки на javascript и т.п.
 */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), "sub", "sup", "br", "span"])],
  attributes: {
    ...defaultSchema.attributes,
    ...Object.fromEntries(
      STYLED_TAGS.map((tag) => [
        tag,
        [...(defaultSchema.attributes?.[tag] ?? []), "style", "className"],
      ]),
    ),
  },
};
