from pathlib import Path
import re
r = Path(r"D:/PTO/pto-app/src/components/review-pane.tsx").read_text(encoding="utf-8")
p = Path(r"D:/PTO/pto-app/src/components/processing-progress-panel.tsx").read_text(encoding="utf-8")
imps = [x.strip() for x in re.search(r"import \{\s*([^}]+)\} from \"@/components/processing-progress-panel\"", r).group(1).split(",") if x.strip()]
exps = re.findall(r"export function (Processing\w+)", p)
print("IMP", imps)
print("EXP", exps)
for a,b in zip(sorted(imps), sorted(exps)):
    print(a, b, a==b, repr(a), repr(b))
missing = set(imps) - set(exps)
extra = set(exps) - set(imps)
print("missing from exports", missing)
print("extra in exports", extra)
