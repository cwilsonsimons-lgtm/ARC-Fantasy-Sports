// Entry point. The imports below run every module in the same order the
// original single-file <script> ran them in; several modules do top-level
// work at load, so this order matters.
import * as m0 from './data/teams.js';
import * as m1 from './store.js';
import * as m2 from './data/league-config.js';
import * as m3 from './data/nfl-teams.js';
import * as m4 from './data/nfl-schedule.js';
import * as m5 from './data/nfl-players.js';
import * as m6 from './data/nfl-index.js';
import * as mh from './data/nfl-history.js';
import * as m7 from './clock.js';
import * as m8 from './lineup.js';
import * as m9 from './hero.js';
import * as m10 from './settings.js';
import * as m11 from './team.js';
import * as m12 from './player.js';
import * as m13 from './panel.js';
import * as m14 from './rewind.js';
import * as m15 from './draft.js';
import * as m16 from './draft-ui.js';
import * as m17 from './matchup.js';
import * as m18 from './freeagency.js';
import * as m19 from './detail.js';
import * as m20 from './week.js';
import * as m21 from './nav.js';
import * as m22 from './draft-meta.js';
import * as m23 from './draft-room.js';
// Above league scope: the hub, the chat that owns trades, and notifications.
import * as h0 from './values.js';
import * as h1 from './leagues.js';
import * as h2 from './notifs.js';
import * as h3 from './trade.js';
import * as h4 from './chat.js';
import * as h5 from './home.js';
import * as h6 from './create.js';
import * as h7 from './kart.js';
// Arc Markets: a separate section, imported last so it layers on top.
import * as mk0 from './markets/data.js';
import * as mk1 from './markets/ui.js';
import * as mk2 from './markets/market.js';
import * as mk3 from './markets/portfolio.js';
import * as mk4 from './markets/charts.js';
import * as mk6 from './markets/universe.js';
import * as mk7 from './markets/orders.js';
import * as mk8 from './markets/ticket.js';
import * as mk5 from './markets/index.js';

// The markup drives the app through inline `onclick="..."` attributes, which
// resolve against the global scope. Every top-level name was a global in the
// original file, so re-export the same surface here. Narrowing this to an
// explicit handler list is the natural next cleanup.
Object.assign(window, m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21,
  m22, m23,
  mh,
  h0, h1, h2, h3, h4, h5, h6, h7,
  mk0, mk1, mk2, mk3, mk4, mk5, mk6, mk7, mk8);

// Startup, in the order these ran in the original script.
initStore();
migrateDraft();
initLeagueConfig();
initClock();
renderStandings();
initPanel();
initMarkets();

// ---------- INIT ----------
applyStoredRoster();
renderWeek();

// ---- boot (runs last: everything above is defined by now) ----
migratePlayerStore();
migratePlayerLeagues();
applyTeamFonts();
initLeagues();
initHome();
initChat();
initNotifs();
renderTabs(homeTab());
// The hub is the root view: the app no longer opens inside a league.
stampLeagueBar(activeLeague());
paintChatBadges();
showView('home');
renderHome();
