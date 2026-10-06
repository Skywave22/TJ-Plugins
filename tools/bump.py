#!/usr/bin/env python3
"""bump.py <PluginDir> "<description>" — version+1, author TJ-Plugins."""
import json, sys, collections
d, desc = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
p = f"{d}/plugin.json"
m = json.load(open(p), object_pairs_hook=collections.OrderedDict)
m["version"] = int(m["version"]) + 1
m["authors"] = ["TJ-Plugins"]
if desc: m["description"] = desc
open(p, "w").write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
print(f"{m['name']}: v{m['version']}  authors={m['authors']}")
