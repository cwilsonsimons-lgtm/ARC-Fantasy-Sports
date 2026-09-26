// Universe — entry point.
//
// A standalone app: it imports nothing from the City Boys Dynasty fantasy app
// that shares this repository, and that app imports nothing from it.
//
// The markup drives the app through inline onclick="uv..." handlers, which
// resolve against the global scope, so the modules holding those handlers are
// copied onto window. Everything they export is named uv* or initUniverse.
import * as views from './views.js';
import * as sheets from './sheets.js';
import * as shell from './index.js';
import * as pages from './pages.js';
import * as edits from './edits.js';

Object.assign(window, views, sheets, shell, pages, edits);
shell.initUniverse();
