#!/usr/bin/env python3
"""Stamp each row of js/data/nfl-players.js with the player's real birth date.

Age is a fact about a person, so it is looked up rather than modelled: the
source is nflverse's player table, keyed by the same gsis id the app already
uses as a player key.

    https://github.com/nflverse/nflverse-data/releases/download/players/players.csv

The date is baked into the data file (as an 11th `|` field) instead of fetched
at runtime, for the same reason the fonts and the historical seasons are baked
in: the app has to render identically with no network. Players nflverse has no
birth date for - a handful of undrafted rookies - get an empty field, and the
app omits the age rather than inventing one.

Usage:  python3 tools/fetch-ages.py [--csv /path/to/players.csv]
        (downloads the CSV to /tmp when --csv is not given)
"""
import argparse, csv, os, re, subprocess, sys

URL = ('https://github.com/nflverse/nflverse-data/releases/download/'
       'players/players.csv')
CACHE = '/tmp/nflverse-players.csv'
OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'nfl-players.js')


def birth_dates(path):
    """gsis id -> YYYY-MM-DD"""
    out = {}
    with open(path, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            gid, bd = r.get('gsis_id'), r.get('birth_date')
            if gid and bd and re.fullmatch(r'\d{4}-\d{2}-\d{2}', bd):
                out[gid] = bd
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', default=None)
    args = ap.parse_args()

    path = args.csv
    if not path:
        path = CACHE
        if not os.path.exists(path):
            print('fetching', URL)
            subprocess.run(['curl', '-sSL', '-o', path, URL], check=True)

    bd = birth_dates(path)
    src = open(OUT, encoding='utf-8').read()
    block = re.search(r'NFL_SRC=`(.*?)`', src, re.S)
    lines, hit, miss = [], 0, []

    for line in block.group(1).strip().split('\n'):
        f = line.split('|')
        f = f[:10]                       # drop any birth date from a previous run
        date = bd.get(f[0].strip(), '')
        if date:
            hit += 1
        else:
            miss.append(f[2])
        lines.append('|'.join(f + [date]))

    out = src[:block.start(1)] + '\n'.join(lines) + '\n' + src[block.end(1):]
    open(OUT, 'w', encoding='utf-8').write(out)

    total = hit + len(miss)
    print(f'{hit}/{total} players dated ({len(miss)} without a birth date)')
    if miss:
        print('  no date:', ', '.join(sorted(miss)))


if __name__ == '__main__':
    main()
