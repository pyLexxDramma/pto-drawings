from pathlib import Path
import re

panel = Path(r"D:/PTO/pto-app/src/components/processing-progress-panel.tsx")
review = Path(r"D:/PTO/pto-app/src/components/review-pane.tsx")
t = panel.read_text(encoding="utf-8")
r = review.read_text(encoding="utf-8")

imps = re.search(
    r"import \{\s*([^}]+)\}\s*from \"@/components/processing-progress-panel\"",
    r,
)
print("import block:\n", imps.group(1) if imps else None)
for m in re.finditer(r"export function (Processing\w+)", t):
    print("export", m.group(1))

# Map current exports to desired import names from review
# Desired: ProcessingCompactBadge, ProcessingProgressPanel, ProcessingSummaryStrip
desired = {
    "ProcessingProgressPanel": "ProcessingProgressPanel",
    "ProcessingSummaryStrip": "ProcessingSummaryStrip",
    "ProcessingCompactBadge": "ProcessingCompactBadge",
}
# discover actual export names
actual = re.findall(r"export function (Processing\w+)", t)
print("actual", actual)

# rewrite exports by order: panel, strip, badge
ordered_desired = [
    "ProcessingProgressPanel",
    "ProcessingSummaryStrip",
    "ProcessingCompactBadge",
]
for old, new in zip(actual, ordered_desired):
    t = t.replace(f"export function {old}", f"export function {new}", 1)
    print(f"rename {old} -> {new}")

panel.write_text(t, encoding="utf-8")
print("done", re.findall(r"export function (Processing\w+)", panel.read_text(encoding="utf-8")))
