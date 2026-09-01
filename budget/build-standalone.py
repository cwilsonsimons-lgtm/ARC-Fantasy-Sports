#!/usr/bin/env python3
"""Wrap the artifact source as a standalone .html file you can save and open.

september-ledger.html is written for Claude's artifact host, which supplies the
doctype, <head> and a small CSS reset at publish time. A file on disk gets none
of that, so this adds the wrapper — charset and viewport above all, since the
ledger lives on a phone. Nothing else is changed: one source, two deliveries.
"""
import pathlib, re

here = pathlib.Path(__file__).parent
src  = (here / "september-ledger.html").read_text()
title = re.search(r"<title>(.*?)</title>", src).group(1)

out = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<style>html{{color-scheme:light}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
{src.split('<title>')[0]}<title>{title}</title>{src.split('</title>',1)[1].split(chr(10),1)[0]}
</head>
<body>
{src.split('</title>',1)[1].split(chr(10),1)[1]}
</body>
</html>
"""
dist = here / "dist"; dist.mkdir(exist_ok=True)
dest = dist / "september-ledger.html"
dest.write_text(out)
print(f"wrote {dest} ({len(out):,} bytes)")
