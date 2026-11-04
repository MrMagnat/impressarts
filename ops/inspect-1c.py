#!/usr/bin/env python3
"""Сводка по ответу HTTP-сервиса 1С: как устроена иерархия номенклатуры.

Только читает файл и печатает сводку, ничего не меняет.

    python3 ops/inspect-1c.py ~/1c.json
"""
import collections
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "1c.json"
with open(path, encoding="utf-8-sig") as f:
    data = json.load(f)
if isinstance(data, dict):
    data = next(v for v in data.values() if isinstance(v, list))


def tip(r):
    return r.get("TypeN_Name") or r.get("TypeN") or "-"


def top(counter, n):
    for key, cnt in counter.most_common(n):
        if isinstance(key, tuple):
            key = " | ".join(str(k) for k in key)
        print(f"{cnt:>7}  {key}")


print("строк:", len(data))
print("поля:", ", ".join(data[0].keys()))

print("\n== TypeN / TypeN_Name ==")
top(collections.Counter((r.get("TypeN"), r.get("TypeN_Name")) for r in data), 20)

print("\n== глубина MapRoad по типам ==")
top(collections.Counter((tip(r), len(str(r.get("MapRoad", "")).split("/"))) for r in data), 20)

for t in sorted({tip(r) for r in data}):
    rows = [r for r in data if tip(r) == t]
    names = {r.get("Name") for r in rows}
    print(f"\n######## {t}: строк {len(rows)}, позиций {len(names)} ########")

    print("-- MapRoad --")
    top(collections.Counter(r.get("MapRoad") for r in rows), 80)

    print("-- Parents --")
    top(collections.Counter(r.get("Parents") for r in rows), 60)

    print("-- Client (заказчик) --")
    top(collections.Counter(r.get("Client") or "-" for r in rows), 15)

    print("-- примеры названий --")
    for n in sorted(names)[:12]:
        print("        ", n)
