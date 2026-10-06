#!/usr/bin/env python3
"""Remove the spoofed 'Universal Geo Bypass' header block from a plugin.

Cloudflare answers 403 to client-sent CF-Connecting-IP / True-Client-IP / X-Forwarded-For,
and a header can't change the caller's real IP anyway. mergeGeoHeaders() is kept as a
plain copy so existing call sites keep working.
"""
import re, sys
p = sys.argv[1]
s = open(p).read()
start = s.find("// ── Universal Geo Bypass")
if start < 0:
    print("no geo block"); sys.exit(0)
start = s.rfind("\n", 0, start) + 1
m = re.compile(r"function mergeGeoHeaders\([^)]*\)\s*\{.*?\n\s*return out;\s*\n\s*\}\n", re.S).search(s, start)
assert m, "mergeGeoHeaders end not found"
indent = re.match(r"\s*", s[start:]).group(0)
repl = (f"{indent}// Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP\n"
        f"{indent}// don't change the caller's location, and Cloudflare answers them with HTTP 403.\n"
        f"{indent}function mergeGeoHeaders(base) {{ return Object.assign({{}}, base || {{}}); }}\n")
s = s[:start] + repl + s[m.end():]
open(p, "w").write(s)
left = re.findall(r"GEO_BYPASS_HEADERS|PK_GEO_HEADERS|GEO_BYPASS_IP|CF-Connecting-IP|X-Forwarded-For|CF-IPCountry", s)
print("stripped;", "remaining refs:", sorted(set(left)) if left else "none")
