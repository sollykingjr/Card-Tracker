#!/usr/bin/env python3
"""Stamp every local script/stylesheet in index.html with a short hash of the file, so a push always loads fresh files.
Run before committing: python3 tools/stamp.py"""
import re, hashlib, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
p = root / 'index.html'
s = p.read_text()
def stamp(m):
    pre, path, post = m.group(1), m.group(2), m.group(3)
    f = root / path
    if not f.exists(): return m.group(0)
    h = hashlib.md5(f.read_bytes()).hexdigest()[:8]
    return f'{pre}{path}?v={h}{post}'
s = re.sub(r'(<script src=")(js/[^"?]+)(?:\?v=[^"]*)?(")', stamp, s)
s = re.sub(r'(<link rel="stylesheet" href=")(css/[^"?]+)(?:\?v=[^"]*)?(")', stamp, s)
p.write_text(s)
