import sys, json
d = json.load(sys.stdin)
for k in sorted(d.keys()):
    if 'mppt' in k.lower():
        print(f"{k}: {d[k]}")
