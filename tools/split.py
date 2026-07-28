#!/usr/bin/env python3
"""Split the original single-file prototype into css/ and js/ modules.

The transform is deliberately mechanical: code blocks move verbatim, in their
original order, so module evaluation order matches the original top-to-bottom
script. The only edits are
  * the nine bindings that are rebound outside their declaring module, which move
    onto the shared `S` object in js/state.js (an imported binding is read-only,
    so they cannot stay plain exports), and
  * an `export` keyword on each top-level declaration, plus generated imports.

Run:  python3 tools/split.py
"""
import os
import re
import shutil

SRC = 'index.html'
CSS_DIR, JS_DIR = 'css', 'js'

# ---------------------------------------------------------------- ranges

# (path, first_line, last_line) inclusive, in original document order.
CSS_MODULES = [
    ('base.css',      14, 34),    # tokens, reset, phone shell, notch, status bar
    ('layout.css',    35, 72),    # shiftable region, league bar, top tabs, scroll
    ('matchup.css',   73, 210),   # stadium stage, hero, rewind, starters, bench
    ('league.css',   211, 255),   # all-matchups list, standings, detail back link
    ('team.css',     256, 342),
    ('week.css',     343, 386),   # week switcher, density toggle, mini hero, crest
    ('hero.css',     387, 412),   # stadium matchup hero
    ('settings.css', 413, 450),
    ('player.css',   451, 521),   # player card, floating logo, win% bar
    ('sheets.css',   522, 536),   # week picker sheet
    ('lineup.css',   537, 570),   # sim clock, slot badge, tappable player name
    ('drawer.css',   571, 601),
    ('draft.css',    602, 643),
    ('panel.css',    644, 694),   # panel search
    ('nav.css',      695, 728),   # bottom nav + real-device media query
]

JS_MODULES = [
    ('data/teams.js',         896, 942),
    ('store.js',              943, 1015),
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
]
BOOT_RANGE = (3666, 3676)

# ------------------------------------------------- shared mutable state

# old identifier -> property on the shared S object
STATE = {
    'LINEUP_SLOTS':      'S.lineupSlots',
    'WEEK':              'S.week',
    'CURRENT_GAMES':     'S.games',
    'teamBackView':      'S.teamBackView',
    'currentPlayerName': 'S.currentPlayerName',
    '_pidx':             'S.pidx',
    'trendPos':          'S.trendPos',
    'leaderWeek':        'S.leaderWeek',
    'leaderScope':       'S.leaderScope',
}

# Declaration lines that must be rewritten or dropped once their bindings move
# onto S. Keyed by original line number; value is the replacement text ('' drops).
DECL_REWRITES = {
    1009: '',   # let LINEUP_SLOTS=buildSlots();  -> initStore()
    2103: '',   # let WEEK=1, CURRENT_GAMES=[];
    2565: 'let currentTeamKey=null, photoTargetName=null;',
    2732: '',   # let _pidx=null;
    2879: '',   # let trendPos=\'ALL\';
    2965: "let leaderPos='ALL', leaderMetric='proj';",
    2875: '',   # renderStandings();  -> called from main.js boot
    # The roster rows are declared empty and filled by initStore(), because their
    # original initialisers read store.slots, which initStore() seeds.
    1011: 'const LINEUP = [];',
    1012: 'const BENCH  = [];',
    1013: 'const IR     = [];',
    1014: 'const TAXI   = [];',
}

# Top-level statements that must not run at module-evaluation time.
#
# ES modules evaluate depth-first over the import graph, which reorders these
# relative to the original top-to-bottom script - panel.js ends up running before
# lineup.js, and reads consts that are still in their temporal dead zone. Moving
# them into named init functions lets main.js run them in the original order.
#
# (module, init name, [(first, last) original line ranges], extra body)
HOISTS = [
    ('store.js', 'initStore', [(980, 985), (1000, 1002)], '''
  S.lineupSlots=buildSlots();
  const fill=(rows,n)=>{rows.length=0;for(let i=0;i<Math.max(0,n);i++)rows.push({a:null,x:null});};
  LINEUP.length=0;
  S.lineupSlots.forEach(sl=>LINEUP.push({slot:sl,a:null,x:null}));
  fill(BENCH,+SLOTS().bench||0);
  fill(IR,+SLOTS().ir||0);
  fill(TAXI,+SLOTS().taxi||0);'''),
    ('data/league-config.js', 'initLeagueConfig', [(1029, 1029), (1039, 1039)], ''),
    ('clock.js', 'initClock', [(2003, 2003)], ''),
    ('panel.js', 'initPanel', [(3063, 3066), (3071, 3071), (3073, 3074)], ''),
]

# Boot sequence for main.js, in the original script's order.
BOOT_CALLS = ['initStore();', 'initLeagueConfig();', 'initClock();',
              'renderStandings();', 'initPanel();']

STATE_JS = '''// Runtime state shared across modules.
//
// Everything here is rebound from a module other than the one that used to declare
// it. An ES module's imported bindings are read-only, so these cannot be exported
// as plain `let`s - they live as properties on one object instead.
export const S = {
  week: 1,
  games: [],
  lineupSlots: null,        // filled in by store.js at load, from buildSlots()
  teamBackView: 'matchup',
  currentPlayerName: null,
  pidx: null,               // player index cache; null means "rebuild on next read"
  trendPos: 'ALL',
  leaderWeek: 1,            // was initialised to WEEK, which is 1 at that point
  leaderScope: 'season',
};
'''

# ------------------------------------------------------------- helpers

def ident_re(name):
    """Match `name` as a standalone identifier, not a property or a substring."""
    return re.compile(r'(?<![.\w$])' + re.escape(name) + r'(?![\w$])')


def strip_literals(src):
    """Blank out string/template/comment *contents*, keeping code structure.

    Reference detection must not read the 900-line player-data blob: names like
    "S. Perine" or "T. Higgins" would otherwise look like uses of `S` and `T`.
    Template `${...}` holes are real code and are preserved. Inline
    `onclick="showTab(...)"` text inside generated markup is correctly dropped -
    those handlers resolve through `window`, not module scope.
    """
    out = []
    i, n = 0, len(src)
    # stack of open template literals, so ${ ... } nesting is tracked correctly
    tmpl_depth = []
    brace_depth = 0

    # A `/` starts a regex literal rather than a division when the previous
    # meaningful token cannot end an expression. Without this, `replace(/"/g, ...)`
    # reads as an unterminated string and desynchronises the whole scan.
    REGEX_OK_AFTER = set('(,=:[!&|?{};+-*%~^<>')
    REGEX_OK_KEYWORDS = ('return', 'typeof', 'case', 'in', 'of', 'new', 'delete',
                         'void', 'do', 'else', 'yield', 'await', 'instanceof')

    def regex_allowed():
        # only the tail matters, and joining the whole buffer per `/` is quadratic
        text = ''.join(out[-40:]).rstrip()
        if not text:
            return True
        if text[-1] in REGEX_OK_AFTER:
            return True
        m = re.search(r'([A-Za-z_$][\w$]*)$', text)
        return bool(m and m.group(1) in REGEX_OK_KEYWORDS)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt not in '/*' and regex_allowed():
            # regex literal: `/` is literal inside a [...] class
            j, in_class = i + 1, False
            while j < n:
                ch = src[j]
                if ch == '\\':
                    j += 2
                    continue
                if ch == '[':
                    in_class = True
                elif ch == ']':
                    in_class = False
                elif ch == '/' and not in_class:
                    break
                elif ch == '\n':
                    break
                j += 1
            j = min(j + 1, n)
            while j < n and src[j].isalpha():   # flags
                j += 1
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and nxt == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join(ch if ch == '\n' else ' ' for ch in src[i:j]))
            i = j
        elif c in '"\'':
            quote, j = c, i + 1
            while j < n and src[j] != quote:
                j += 2 if src[j] == '\\' else 1
            j = min(j + 1, n)
            out.append(''.join(ch if ch == '\n' else ' ' for ch in src[i:j]))
            i = j
        elif c == '`':
            tmpl_depth.append(brace_depth)
            out.append(' ')
            i += 1
            # copy template body as blanks until ` or ${
            while i < n:
                if src[i] == '\\':
                    out.append('  ')
                    i += 2
                elif src[i] == '`':
                    tmpl_depth.pop()
                    out.append(' ')
                    i += 1
                    break
                elif src[i] == '$' and i + 1 < n and src[i + 1] == '{':
                    out.append('  ')
                    i += 2
                    break   # fall back to normal code scanning inside the hole
                else:
                    out.append(src[i] if src[i] == '\n' else ' ')
                    i += 1
        elif c == '}' and tmpl_depth and brace_depth == tmpl_depth[-1]:
            # closing a ${ hole: resume template-literal blanking
            out.append(' ')
            i += 1
            while i < n:
                if src[i] == '\\':
                    out.append('  ')
                    i += 2
                elif src[i] == '`':
                    tmpl_depth.pop()
                    out.append(' ')
                    i += 1
                    break
                elif src[i] == '$' and i + 1 < n and src[i + 1] == '{':
                    out.append('  ')
                    i += 2
                    break
                else:
                    out.append(src[i] if src[i] == '\n' else ' ')
                    i += 1
        else:
            if c == '{':
                brace_depth += 1
            elif c == '}':
                brace_depth -= 1
            out.append(c)
            i += 1
    return ''.join(out)


DECL_PATTERNS = [
    re.compile(r'^function\s+([A-Za-z_$][\w$]*)'),
    re.compile(r'^(?:const|let|var)\s+(.*)$'),
]


def declared_names(body):
    """Top-level names a module block defines (column-0 declarations only)."""
    names = set()
    for line in body.split('\n'):
        m = DECL_PATTERNS[0].match(line)
        if m:
            names.add(m.group(1))
            continue
        m = DECL_PATTERNS[1].match(line)
        if m:
            # `const A={},B=[];` / `let a=1, b=2;` -> take each binding name
            for part in re.split(r',(?![^{[(]*[}\])])', m.group(1)):
                nm = re.match(r'\s*([A-Za-z_$][\w$]*)\s*[=;]', part)
                if nm:
                    names.add(nm.group(1))
    return names


def add_exports(body, code):
    """Prefix every top-level declaration with `export`.

    `code` is the literal-stripped twin of `body`; the decision is made from it so
    a line of player data can never be mistaken for a declaration.
    """
    decl = re.compile(r'^(function\s+[A-Za-z_$]|const\s+[A-Za-z_$]|let\s+[A-Za-z_$]|var\s+[A-Za-z_$])')
    out = []
    for line, cline in zip(body.split('\n'), code.split('\n')):
        out.append('export ' + line if decl.match(cline) else line)
    return '\n'.join(out)


def rename_in_code(body, mapping):
    """Rename identifiers in code positions only.

    `strip_literals` replaces literal contents character-for-character, so offsets
    in the stripped twin map straight back onto the real text. Without this, the
    word WEEK inside `<div class="wk">WEEK 8</div>` gets rewritten too.
    """
    code = strip_literals(body)
    assert len(code) == len(body), 'stripper must preserve offsets'
    edits = []
    for old, new in mapping.items():
        for m in ident_re(old).finditer(code):
            edits.append((m.start(), m.end(), new))
    for start, end, new in sorted(edits, reverse=True):
        body = body[:start] + new + body[end:]
    return body


def rel_import(from_path, to_path):
    from_dir = os.path.dirname(from_path)
    rel = os.path.relpath(to_path, from_dir or '.')
    return rel if rel.startswith('.') else './' + rel


# ------------------------------------------------------------- main

def main():
    lines = open(SRC).read().split('\n')

    def block(a, b):
        return '\n'.join(lines[a - 1:b])

    for d in (CSS_DIR, JS_DIR, os.path.join(JS_DIR, 'data')):
        os.makedirs(d, exist_ok=True)

    # ---- CSS: verbatim slices, order preserved by <link> order in the HTML
    for path, a, b in CSS_MODULES:
        text = block(a, b)
        # the original rules are indented two spaces inside <style>; dedent them
        text = '\n'.join(l[2:] if l.startswith('  ') else l for l in text.split('\n'))
        open(os.path.join(CSS_DIR, path), 'w').write(text.strip() + '\n')

    # ---- JS: rewrite moved declarations, then slice
    work = list(lines)
    for ln, replacement in DECL_REWRITES.items():
        work[ln - 1] = replacement

    # lift order-sensitive top-level statements out of the module bodies
    hoisted = {}
    for mod, fname, ranges, extra in HOISTS:
        parts = []
        for a, b in ranges:
            parts.append('\n'.join(work[a - 1:b]))
            for ln in range(a, b + 1):
                work[ln - 1] = ''
        # Kept at the original indentation: some of these statements span a
        # multi-line template literal, where added leading spaces would land in
        # the generated markup.
        indented = '\n'.join(p for p in parts if p.strip())
        hoisted[mod] = (
            f'\n// Ran at top level in the original single-file script. main.js calls it\n'
            f'// during boot so it keeps its original position in the startup order.\n'
            f'function {fname}(){{\n{indented}{extra}\n}}\n')

    def jsblock(a, b):
        return '\n'.join(work[a - 1:b])

    raw = {path: jsblock(a, b) for path, a, b in JS_MODULES}
    raw['main.js'] = jsblock(*BOOT_RANGE)
    for mod, text in hoisted.items():
        raw[mod] += text

    # apply the state renames, in code positions only
    for path in raw:
        raw[path] = rename_in_code(raw[path], STATE)

    # Reference scanning runs against a copy with string/comment contents blanked,
    # so the player-data blob cannot masquerade as code.
    scan = {path: strip_literals(body) for path, body in raw.items()}

    # what each module defines
    defines = {path: declared_names(scan[path]) for path in raw}
    owner = {}
    for path, names in defines.items():
        for n in names:
            owner.setdefault(n, path)

    state_props = set(STATE.values())

    # generate imports: any owned name a module references but does not define
    order = [p for p, _, _ in JS_MODULES]
    for path in order:
        body = raw[path]
        code = scan[path]
        mine = defines[path]
        needed = {}
        for name, home in owner.items():
            if home == path or name in mine:
                continue
            if ident_re(name).search(code):
                needed.setdefault(home, set()).add(name)

        header = []
        if any(p in code for p in state_props):
            header.append(f"import {{ S }} from '{rel_import(path, 'state.js')}';")
        for home in sorted(needed):
            names = ', '.join(sorted(needed[home]))
            header.append(f"import {{ {names} }} from '{rel_import(path, home)}';")

        out = add_exports(body, code).strip('\n')
        if header:
            out = '\n'.join(header) + '\n\n' + out
        raw[path] = out + '\n'

    # ---- main.js: evaluation order + the window bridge + the original boot block
    #
    # Modules are imported here in the original script's order. Several of them run
    # top-level code (seeding the store, building the NFL index, painting the rail),
    # so the order is load-bearing, not cosmetic.
    ns = [(f'm{i}', p) for i, p in enumerate(order)]
    header = [
        '// Entry point. The imports below run every module in the same order the',
        '// original single-file <script> ran them in; several modules do top-level',
        '// work at load, so this order matters.',
    ]
    header += [f"import * as {alias} from '{rel_import('main.js', p)}';" for alias, p in ns]
    header.append('')

    boot = raw['main.js']

    bridge = [
        '// The markup drives the app through inline `onclick="..."` attributes, which',
        '// resolve against the global scope. Every top-level name was a global in the',
        '// original file, so re-export the same surface here. Narrowing this to an',
        '// explicit handler list is the natural next cleanup.',
        f'Object.assign(window, {", ".join(a for a, _ in ns)});',
        '',
    ]
    startup = ['// Startup, in the order these ran in the original script.'] + BOOT_CALLS + ['']
    main_src = '\n'.join(header + bridge + startup) + '\n' + boot.strip('\n') + '\n'

    # ---- index.html: same markup, with the style block and script block replaced
    # by links. The <link> order reproduces the original cascade exactly.
    head = block(1, 12)                     # doctype, meta, title, font links
    body = block(731, 894)                  # markup + caption, unchanged
    links = '\n'.join(f'  <link rel="stylesheet" href="{CSS_DIR}/{p}">'
                      for p, _, _ in CSS_MODULES)
    html = (head + '\n' + links + '\n</head>\n' + body +
            f'\n<script type="module" src="{JS_DIR}/main.js"></script>\n'
            '</body>\n</html>\n')
    open(SRC, 'w').write(html)

    open(os.path.join(JS_DIR, 'state.js'), 'w').write(STATE_JS)
    for path in order:
        full = os.path.join(JS_DIR, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, 'w').write(raw[path])
    open(os.path.join(JS_DIR, 'main.js'), 'w').write(main_src)

    print('wrote', len(CSS_MODULES), 'css files and', len(order) + 2, 'js files')


if __name__ == '__main__':
    main()
