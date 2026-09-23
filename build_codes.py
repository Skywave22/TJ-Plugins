#!/usr/bin/env python3
"""
Build installable per-code repositories from this repo's master plugins.json.

SkyStream (v2.8.0) accepts a repository in one of two shapes, and they are
mutually exclusive -- see lib/core/extensions/services/repository_service.dart:

    { "name": ..., "packageName"|"id": ..., "pluginLists": [ <plugins.json> ] }
    { "name": ..., "packageName"|"id": ..., "repos": [ <repo.json>, ... ] }

A short code is just a cutt.ly alias. `parseRepoUrl` tries `cutt.ly/sky-CODE`
first, then `cutt.ly/CODE`, so registering the alias `sky-tjanime` on cutt.ly
makes the code `tjanime` work in the app.

This script emits, for each code, a matched pair:

    dist/codes/<code>/repo.json       the manifest users point at
    dist/codes/<code>/plugins.json    the filtered plugin list

Usage:
    python3 build_codes.py [--master dist/plugins.json] [--out dist/codes] \
                           [--base https://raw.githubusercontent.com/OWNER/REPO/main]
"""
import argparse, json, os, sys, collections

# The repo grew up with two vocabularies for the same thing ("Movie"/"Movies",
# "TvSeries"/"Series"). Normalise before grouping, otherwise a movie-only code
# silently drops every plugin that happened to use the plural.
ALIASES = {
    "movies": "Movie", "movie": "Movie",
    "series": "TvSeries", "tvseries": "TvSeries", "tv": "TvSeries",
    "anime": "Anime", "asian drama": "AsianDrama", "asiandrama": "AsianDrama",
    "cartoon": "Cartoon", "live": "Live", "livetv": "LiveTv",
}

# code -> (label shown in the app, matching categories, suggested cutt.ly alias)
CODES = {
    "all":     ("TJ-Plugins (all)",    None,                         "tj"),
    "movies":  ("TJ-Plugins Movies",   {"Movie"},                    "tjmovies"),
    "series":  ("TJ-Plugins Series",   {"TvSeries"},                 "tjseries"),
    "anime":   ("TJ-Plugins Anime",    {"Anime", "AsianDrama", "Cartoon"}, "tjanime"),
    "hindi":   ("TJ-Plugins Hindi",    None,                         "tjhindi"),
}


def norm(cat):
    return ALIASES.get(str(cat).strip().lower(), str(cat).strip())


def pick(plugins, code, cats):
    if code == "hindi":
        return [p for p in plugins if (p.get("languages") or [""])[0] == "hi"]
    if cats is None:
        return list(plugins)
    return [p for p in plugins
            if {norm(c) for c in p.get("categories", [])} & cats]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", default="dist/plugins.json")
    ap.add_argument("--out", default="dist/codes")
    ap.add_argument("--base",
                    default="https://raw.githubusercontent.com/Skywave22/TJ-Plugins/main",
                    help="public base URL the generated files will be served from")
    args = ap.parse_args()

    if not os.path.exists(args.master):
        sys.exit(f"master list not found: {args.master}")
    plugins = json.load(open(args.master, encoding="utf-8"))
    if not isinstance(plugins, list) or not plugins:
        sys.exit("master list must be a non-empty JSON array of plugin objects")

    base = args.base.rstrip("/")
    rows = []
    for code, (label, cats, alias) in CODES.items():
        picked = pick(plugins, code, cats)
        if not picked:
            print(f"  ! {code:8} would be empty -- skipped")
            continue

        d = os.path.join(args.out, code)
        os.makedirs(d, exist_ok=True)

        # plugins.json entries carry absolute .sky URLs already; keep them.
        json.dump(picked, open(f"{d}/plugins.json", "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)

        manifest = {
            "name": label,
            "packageName": f"com.tjplugins.repo.{code}",
            "description": f"{label} — {len(picked)} plugin(s). Short code: {alias}",
            "manifestVersion": 1,
            "pluginLists": [f"{base}/{args.out}/{code}/plugins.json"],
        }
        json.dump(manifest, open(f"{d}/repo.json", "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)

        rows.append((code, alias, len(picked), sorted(p["name"] for p in picked)))
        print(f"  {code:8} {len(picked):3} plugins  short code: {alias}")
        print(f"           {', '.join(rows[-1][3])}")

    # Validate every generated manifest against the app's own rules.
    bad = []
    for code, alias, n, _ in rows:
        m = json.load(open(f"{args.out}/{code}/repo.json", encoding="utf-8"))
        has_name = "name" in m
        has_id = "id" in m or "packageName" in m
        has_pl = bool(m.get("pluginLists"))
        has_rp = bool(m.get("repos"))
        if not (has_name and has_id and (has_pl or has_rp)) or (has_pl and has_rp):
            bad.append(code)
        p = json.load(open(f"{args.out}/{code}/plugins.json", encoding="utf-8"))
        if not isinstance(p, list) or len(p) != n:
            bad.append(f"{code}/plugins.json")
    if bad:
        sys.exit(f"generated manifests failed app validation: {bad}")

    print(f"\n  wrote {len(rows)} code repos to {args.out}/  (all pass app validation)")
    print("  register these aliases on cutt.ly to activate the short codes:")
    for code, alias, n, _ in rows:
        print(f"    sky-{alias:10} ->  {base}/{args.out}/{code}/repo.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
