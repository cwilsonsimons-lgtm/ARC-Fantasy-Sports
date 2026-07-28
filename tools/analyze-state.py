#!/usr/bin/env python3
"""Report, for every top-level mutable binding, which planned modules declare it,
rebind it, and read it. A binding rebound outside its declaring module cannot be a
plain ES module export (imported bindings are read-only), so it must live in state.js.
"""
import re, sys

SRC = 'index.html'
JS_START, JS_END = 896, 3676

# (name, first_line, last_line) - planned module boundaries, in original order.
MODULES = [
    ('data/teams.js',        896, 942),
    ('store.js',             943, 1015),
    ('data/league-config.js',1016, 1040),
    ('data/nfl-teams.js',    1041, 1044),
    ('data/nfl-schedule.js', 1045, 1045),
    ('data/nfl-players.js',  1046, 1950),
    ('data/nfl-index.js',    1951, 2000),
    ('clock.js',             2001, 2096),
    ('lineup.js',            2097, 2235),
    ('hero.js',              2236, 2369),
    ('settings.js',          2370, 2558),
    ('team.js',              2559, 2712),
    ('player.js',            2713, 2892),
    ('panel.js',             2893, 3075),
    ('rewind.js',            3076, 3136),
    ('draft.js',             3137, 3231),
    ('draft-ui.js',          3232, 3318),
    ('matchup.js',           3319, 3435),
    ('freeagency.js',        3436, 3573),
    ('detail.js',            3574, 3586),
    ('week.js',              3587, 3615),
    ('nav.js',               3616, 3665),
    ('main.js',              3666, 3676),
]

# name -> the single top-level line that declares it. Pinned explicitly because a
# loose regex also matches inner `const x = store.y` lines and hides real rebinds.
DECL_LINE = {
    'store': 979, 'LINEUP_SLOTS': 1009, 'LT': 2049, 'WEEK': 2103, 'CURRENT_GAMES': 2103,
    'backdropTargetKey': 2355, 'setTab': 2519, 'currentTeamKey': 2565, 'teamBackView': 2565,
    'photoTargetName': 2565, 'currentPlayerName': 2565, 'fontMenuOpen': 2686, '_pidx': 2732,
    'playerBackView': 2842, 'trendPos': 2879, 'leaderPos': 2965, 'leaderWeek': 2965,
    'leaderMetric': 2965, 'leaderScope': 2965, 'currentRail': 3046, '_taken': 3151,
    'draftPos': 3233, 'draftQ': 3233, 'swapIdx': 3382, '_rosterCache': 3469,
    'availPos': 3538, '_confirmCb': 3561, 'pickerTarget': 3600, 'ht': 3662,
}
VARS = list(DECL_LINE)


def module_of(line):
    for name, a, b in MODULES:
        if a <= line <= b:
            return name
    return '??'


lines = open(SRC).read().split('\n')

print(f'{"var":<20} {"declared in":<22} {"rebound in":<40} reads in')
print('-' * 120)
needs_state = []
for v in VARS:
    # a rebind is `v =` but not `v ==`, `v =>`, `v <=`, `.v =`, and not a declaration
    rebind = re.compile(r'(?<![.\w$])' + re.escape(v) + r'\s*=(?![=>])')
    read = re.compile(r'(?<![.\w$])' + re.escape(v) + r'\b')

    decl_line = DECL_LINE[v]
    decl_mods = {module_of(decl_line)}
    rebind_mods, read_mods = set(), set()
    for i, ln in enumerate(lines, 1):
        if not (JS_START <= i <= JS_END):
            continue
        m = module_of(i)
        if rebind.search(ln) and i != decl_line:
            rebind_mods.add(m)
        if read.search(ln):
            read_mods.add(m)

    outside = rebind_mods - decl_mods
    flag = '  <-- STATE' if outside else ''
    if outside:
        needs_state.append(v)
    print(f'{v:<20} {",".join(sorted(decl_mods)):<22} {",".join(sorted(rebind_mods)) or "-":<40} '
          f'{len(read_mods)} module(s){flag}')

print('\nMust move into state.js (rebound outside declaring module):')
print('  ' + (', '.join(needs_state) if needs_state else '(none)'))
