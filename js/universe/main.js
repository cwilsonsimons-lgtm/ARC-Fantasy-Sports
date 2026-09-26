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
import * as card from './card.js';
import * as ranks from './ranks.js';
import * as relegation from './relegation.js';
import * as promotion from './promotion.js';
import * as personality from './personality.js';
import * as story from './story.js';

Object.assign(window, views, sheets, shell, pages, edits, card, ranks, relegation, promotion, personality, story);
shell.initUniverse();
