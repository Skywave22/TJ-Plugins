#!/usr/bin/env python3
"""Remove spoofed client-IP / country headers from object literals anywhere in a plugin.
Usage: strip_spoof.py <plugin.js>"""
import re, sys
p = sys.argv[1]; s = open(p).read(); before = s
KEYS = r"X-Forwarded-For|X-Real-IP|X-Client-IP|X-Originating-IP|CF-Connecting-IP|True-Client-IP|CF-IPCountry|X-Country|X-CF-IPCountry|X-Forwarded-Country|X-Forwarded-Host|X-Forwarded-Proto"
val = r"""(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z_$][\w$.]*(?:\[[^\]\n]*\])?)"""
pair = rf"""["'](?i:{KEYS})["']\s*:\s*{val}"""
# whole-line properties
s = re.sub(rf"^[ \t]*{pair}[ \t]*,?[ \t]*\n", "", s, flags=re.M)
# inline: ", key: v" or "key: v,"
s = re.sub(rf",\s*{pair}", "", s)
s = re.sub(rf"{pair}\s*,\s*", "", s)
open(p, "w").write(s)
left = re.findall(rf"(?i)[\"'](?:{KEYS})[\"']", s)
print(f"{p}: removed {len(re.findall(pair, before))} pairs; left: {left}")
