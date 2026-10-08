#!/usr/bin/env python3
"""Inject (or refresh) the shared network guard into a plugin.

usage: tools/apply_netguard.py <PluginDir> [<PluginDir> ...]

- reads tools/snippets/net-guard.js and tools/mirrors.json ({"Dir": ["https://mirror", ...]})
- the plugin's top-level IIFE receives the app's http_get/http_post as parameters, and the
  guard re-declares http_get/http_post inside the IIFE, so only this plugin is affected
- exports are wrapped right before the IIFE closes (after the globalThis.* assignments)
Idempotent: an existing guard block is replaced.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNIP = open(os.path.join(ROOT, 'tools/snippets/net-guard.js')).read().rstrip('\n')
MIRRORS = json.load(open(os.path.join(ROOT, 'tools/mirrors.json')))
START = '    // ── network guard (TJ-Plugins shared helper)'
END = '    // ── end network guard'
OPEN_RE = re.compile(r'^\(function\s*\(([^)]*)\)\s*\{[ \t]*$', re.M)
CLOSE_OLD = '})();'
CLOSE_NEW = "})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);"
WRAP = '    __ngWrapExports();\n'


def apply(d):
    p = os.path.join(ROOT, d, 'plugin.js')
    s = open(p).read()
    mirrors = [m.rstrip('/') for m in MIRRORS.get(d, [])]
    block = SNIP.replace('__NG_MIRRORS_PLACEHOLDER__', json.dumps(mirrors))

    if START in s:  # refresh
        a = s.index(START)
        b = s.index('\n', s.index(END)) + 1
        s = s[:a] + block + '\n' + s[b:]
    else:
        m = OPEN_RE.search(s)
        if not m:
            raise SystemExit(f'{d}: top-level "(function () {{" not found')
        s = s[:m.start()] + '(function (__ngRawGet, __ngRawPost) {' + s[m.end():]
        # insert after the opening line, and after a leading 'use strict'
        pos = s.index('\n', m.start()) + 1
        rest = s[pos:]
        us = re.match(r"(\s*['\"]use strict['\"];?[ \t]*\n)", rest)
        if us:
            pos += us.end()
        s = s[:pos] + '\n' + block + '\n\n' + s[pos:]
        # close
        i = s.rstrip().rfind(CLOSE_OLD)
        if i < 0 or s[i:].strip() != CLOSE_OLD:
            raise SystemExit(f'{d}: final "}})();" not found')
        s = s[:i] + WRAP + CLOSE_NEW + '\n'
    open(p, 'w').write(s)
    print(f'{d}: guard applied ({len(mirrors)} extra mirrors)')


if __name__ == '__main__':
    for d in sys.argv[1:]:
        apply(d.rstrip('/'))
