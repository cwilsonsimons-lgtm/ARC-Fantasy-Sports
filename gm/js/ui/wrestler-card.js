// The player's dossier on one wrestler.
//
// Everything here is what the GM could plausibly know. Hard facts — record,
// role, who they have shared a ring with — are always shown. What kind of
// performer they are is a *read*, and the read sharpens with familiarity.
import { el } from './dom.js';
import { commit } from '../store.js';
import { closeCard } from './card-state.js';
import { byId } from '../model/wrestlers.js';
import { bookable } from '../model/morale.js';
import {
  ABILITIES, statReading, traitReading, knowledgeTier, personalityTier,
  knowledgeLabel, knowledgePercent, TAPE_STUDY_BOOST,
} from '../model/stats.js';
import { TRAITS } from '../model/traits.js';
import { moraleSources, gmStanding } from '../model/memory.js';
import {
  readsMemories, readsGrudgeSource, tracksWarnings, readsInjuries, studiesTape,
} from '../model/unlocks.js';
import { canCheck, backgroundCheck } from '../model/scouting.js';
import { nameOf } from '../model/wrestlers.js';
import { relationshipsOf } from '../model/relationships.js';
import { threadList } from './threads.js';
import { roomOf } from '../model/backstage.js';
import { locationName } from '../data/locations.js';
import { opinions, tasteReading, aptitudeReading } from '../model/match-types.js';
import { winRate } from '../model/matches.js';
import { moodWord, moodClass } from './mood.js';
import { wrestlerLink } from './links.js';

const PHOTO_SIZE = 256;

export function renderCard(state, wrestlerId) {
  const w = byId(state.wrestlers, wrestlerId);
  if (!w) return null;

  return el('div', {
    class: 'overlay',
    onClick: e => { if (e.target.classList.contains('overlay')) closeCard(); },
  },
    el('div', { class: 'card', role: 'dialog', 'aria-label': `${w.name} profile` },
      el('button', { type: 'button', class: 'card-close', text: '✕', title: 'Close', onClick: closeCard }),
      header(state, w),
      el('div', { class: 'card-split' },
        el('div', {},
          el('h4', { text: 'Your read' }),
          readPanel(w),
          el('h4', { text: 'Ability' }),
          abilityList(state, w),
          el('h4', { text: 'Personality' }),
          personalityList(w),
          el('h4', { text: 'Description' }),
          bioField(w)
        ),
        el('div', {},
          el('h4', { text: 'Where you stand' }),
          standingPanel(state, w),
          el('h4', { text: 'What is on their mind' }),
          feelingList(state, w),
          readsInjuries(state) ? el('h4', { text: 'Injury history' }) : null,
          readsInjuries(state) ? injuryList(state, w) : null,
          el('h4', { text: 'Stipulations' }),
          stipulationList(w),
          threadList(state, w.id),
          el('h4', { text: 'The locker room' }),
          relationshipList(state, w)
        )
      )
    )
  );
}

function header(state, w) {
  const rate = winRate(w);
  return el('div', { class: 'card-head' },
    photoBlock(w),
    el('div', { class: 'card-id' },
      el('h3', { class: 'card-name', text: w.name }),
      el('div', { class: 'card-arch', text: `${w.archetype} · ${w.role}` }),
      el('div', { class: 'card-chips' },
        el('span', { class: 'chip', text: w.alignment }),
        el('span', { class: w.status === 'Available' ? 'chip' : 'chip chip-bad', text: w.status }),
        bookable(w)
          ? el('span', { class: `chip ${moodClass(w)}`, text: moodWord(w) })
          : null,
        w.grudges.length ? el('span', { class: 'chip chip-bad', text: 'grudge' }) : null,
        // Where they are right now, while a show is on. Knowing that somebody
        // furious is sitting in the car park is the whole point of the map.
        roomOf(state, w.id)
          ? el('span', { class: 'chip', text: locationName(roomOf(state, w.id)) })
          : null
      ),
      el('div', { class: 'record' },
        el('span', { class: 'record-num', text: `${w.record.wins}–${w.record.losses}` }),
        el('span', { class: 'record-label', text: rate === null ? 'no matches yet' : `${Math.round(rate * 100)}% win rate` })
      )
    )
  );
}

function photoBlock(w) {
  return el('div', { class: 'photo-block' },
    w.photo
      ? el('img', { class: 'photo', src: w.photo, alt: `${w.name}` })
      : el('div', { class: 'photo photo-empty', text: initials(w.name) }),
    el('label', { class: 'photo-btn' },
      w.photo ? 'Replace photo' : 'Add photo',
      el('input', {
        type: 'file',
        accept: 'image/*',
        onChange: e => loadPhoto(e, w.id),
      })
    ),
    w.photo
      ? el('button', {
          type: 'button', class: 'link photo-clear', text: 'Remove',
          onClick: () => commit(s => { byId(s.wrestlers, w.id).photo = null; }),
        })
      : null
  );
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

// Downscaled and re-encoded before it is stored, because the save lives in
// localStorage and a phone photograph would fill it on its own.
function loadPhoto(event, wrestlerId) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_SIZE;
      canvas.height = PHOTO_SIZE;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(PHOTO_SIZE / img.width, PHOTO_SIZE / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      ctx.drawImage(img, (PHOTO_SIZE - width) / 2, (PHOTO_SIZE - height) / 2, width, height);
      const data = canvas.toDataURL('image/jpeg', 0.82);
      commit(s => {
        const target = byId(s.wrestlers, wrestlerId);
        if (target) target.photo = data;
      });
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function readPanel(w) {
  const percent = knowledgePercent(w);

  return el('div', {},
    el('div', { class: 'read-head' },
      el('span', { class: 'read-label', text: knowledgeLabel(w) }),
      el('span', { class: 'read-pct', text: `${percent}%` })
    ),
    el('div', { class: 'read-bar' }, el('div', { class: 'read-fill', style: `width:${percent}%` })),
    el('p', { class: 'read-note muted', text: readNote(knowledgeTier(w), personalityTier(w)) })
  );
}

function readNote(ability, personality) {
  if (ability === 'unread') return 'You have barely worked with them. Book them and you will learn.';
  if (personality === 'unread') {
    return 'You have a sense of what they can do. What they are like is another matter.';
  }
  if (personality === 'known') return 'Weeks around them have made this reliable.';
  return 'You know the wrestler better than you know the person.';
}

// What they can do. Learned by watching them work, so it comes first and
// sharpens fastest.
function abilityList(state, w) {
  // Tape is watched, not lived through. It sharpens what they can do and says
  // nothing at all about what they are like.
  const boost = studiesTape(state) ? TAPE_STUDY_BOOST : 0;
  const tier = knowledgeTier(w, boost);
  return el('ul', { class: 'stats' },
    ABILITIES.map(stat => {
      const reading = statReading(w, stat.key, boost);
      return el('li', {},
        el('span', { class: 'stat-key', text: stat.label }),
        el('span', {
          class: reading ? `stat-val stat-${tier}` : 'stat-val stat-unknown',
          text: reading || 'no read yet',
        }),
        el('span', { class: 'stat-note', text: stat.note })
      );
    })
  );
}

// Who they are. Eleven dimensions is too many to read as a list of sentences,
// so it is a grid — and the reading lags ability, because working somebody out
// takes longer than watching them wrestle.
function personalityList(w) {
  const tier = personalityTier(w);
  if (tier === 'unread') {
    return el('p', { class: 'empty', text: 'A stranger. You have no idea what they are like to deal with.' });
  }

  return el('ul', { class: 'traits' },
    TRAITS.map(spec => {
      const reading = traitReading(w, spec.key);
      return el('li', { title: spec.note },
        el('span', { class: 'trait-key', text: spec.label }),
        el('span', {
          // Only the ends of a scale are coloured. Somebody's ordinary patience
          // is not something the player needs to see from across the room.
          class: reading.notable ? `trait-val trait-${tier}` : 'trait-val trait-ordinary',
          text: reading.word,
        })
      );
    })
  );
}

// Morale is never a number. What it is made of, however, can be named — and
// naming it is what turns a mood into something the player can act on.
function feelingList(state, w) {
  if (!bookable(w)) {
    return el('p', { class: 'empty', text: 'Not in a position to have an opinion about the card.' });
  }
  // You can see the mood on somebody's face from across the room. Working out
  // what it is *made of* is a conversation, and Know Your Locker Room is the
  // upgrade that means you have had it.
  if (!readsMemories(state)) {
    return el('p', { class: 'empty' },
      `You can see they are ${moodWord(w).toLowerCase()}. `,
      el('span', { class: 'locked-note', text: 'Know Your Locker Room reads what is behind it.' })
    );
  }

  const sources = moraleSources(w).slice(0, 5);
  if (!sources.length) {
    return el('p', { class: 'empty', text: 'Nothing either way. Nothing has happened to them yet.' });
  }

  return el('ul', { class: 'feelings' },
    sources.map(source =>
      el('li', {},
        el('span', { class: 'feel-key', text: source.label }),
        el('span', {
          class: source.total > 0 ? 'feel-val feel-good' : 'feel-val feel-bad',
          text: feelWord(source.total),
        })
      )
    )
  );
}

// A direction and a size, in words. Six sources each showing a signed integer
// would be a spreadsheet.
function feelWord(total) {
  const size = Math.abs(total);
  const scale = size >= 16 ? 2 : size >= 6 ? 1 : 0;
  return total > 0
    ? ['a small plus', 'in your favour', 'the best thing going'][scale]
    : ['a small minus', 'weighing on them', 'the whole problem'][scale];
}

// How they feel about you specifically, as distinct from how they feel. A
// wrestler can be delighted with their year and still think you are a liar.
const GRUDGE_ABOUT = {
  'broken-promise': 'a promise you did not keep',
  'walked-out': 'the night they left',
  suspension: 'the suspension',
  ejection: 'being sent home',
  warning: 'the warning',
  refused: 'being made to work',
  ignored: 'being left to it',
  overlooked: 'being left off the card',
};

function grudgeAbout(state, grudge) {
  const about = GRUDGE_ABOUT[grudge.type] || grudge.type.replace(/-/g, ' ');
  const target = grudge.targetId ? nameOf(state.wrestlers, grudge.targetId) : null;
  return target ? `${about}, and ${target}` : about;
}

function standingPanel(state, w) {
  const standing = gmStanding(w, state.week);
  const office = (w.grudges || []).filter(g => g.targetId === null);
  const warnings = w.warnings || 0;

  return el('div', { class: 'standing' },
    el('p', { class: `standing-line standing-${standing.tone}`, text: `${w.name} ${standing.phrase}.` }),
    office.length && !readsGrudgeSource(state)
      ? el('p', { class: 'muted standing-note' },
          `${office.length} open ${office.length === 1 ? 'grievance' : 'grievances'} with the office. `,
          el('span', { class: 'locked-note', text: 'Read The Grudge says what about.' }))
      : null,
    // What it is actually about, which is the difference between knowing
    // somebody is angry and being able to do anything about it.
    office.length && readsGrudgeSource(state)
      ? el('ul', { class: 'grudge-list' },
          office.map(g => el('li', {},
            el('span', { class: 'grudge-about', text: grudgeAbout(state, g) }),
            el('span', { class: 'grudge-week', text: `week ${g.week}` })
          )))
      : null,
    // The file. Kept whether or not you can read it; Paper Trail is what makes
    // it visible, and the third entry is what makes Dismissal possible.
    tracksWarnings(state) && warnings
      ? el('p', { class: 'muted standing-note', text:
          `${warnings} formal ${warnings === 1 ? 'warning' : 'warnings'} on file.` })
      : null,
    canCheck(state)
      ? el('button', {
          type: 'button', class: 'link',
          text: `Ask around about ${w.name.split(' ')[0]}`,
          title: 'One a week. You learn what a season of working together would have taught you.',
          onClick: () => commit(s => backgroundCheck(s, w.id)),
        })
      : null
  );
}

// Only ever shown with Injury History owned. An empty list is information too:
// somebody who has never been hurt is somebody you can book harder.
function injuryList(state, w) {
  const injuries = w.injuries || [];
  if (!injuries.length) {
    return el('p', { class: 'empty', text: 'Never missed a week through injury.' });
  }
  const weeks = injuries.reduce((n, i) => n + i.weeks, 0);
  return el('div', {},
    el('ul', { class: 'injuries' },
      injuries.slice(-5).reverse().map(i => el('li', {},
        el('span', { class: 'injury-week', text: `Week ${i.week}` }),
        el('span', { class: 'injury-len', text: `${i.weeks} week${i.weeks === 1 ? '' : 's'} out` })
      ))),
    el('p', { class: 'muted standing-note', text:
      `${injuries.length} in all, ${weeks} weeks lost.` })
  );
}

function bioField(w) {
  return el('textarea', {
    class: 'bio',
    rows: 4,
    value: w.bio,
    placeholder: 'What is their deal?',
    onChange: e => {
      const text = e.target.value;
      commit(s => { byId(s.wrestlers, w.id).bio = text; });
    },
  });
}

// Taste surfaces as soon as you have any read at all — people tell you what
// they like. Aptitude only appears once you know them, because that is
// something you have to watch.
function stipulationList(w) {
  const tier = knowledgeTier(w);
  if (tier === 'unread') {
    return el('p', { class: 'empty', text: 'No idea what they will and will not work.' });
  }

  const entries = opinions(w);
  if (!entries.length) {
    return el('p', { class: 'empty', text: 'Takes whatever you give them.' });
  }

  return el('ul', { class: 'stips' },
    entries.map(({ type, taste }) => {
      const reading = tasteReading(w, type.id);
      const skill = aptitudeReading(w, type.id);
      return el('li', {},
        el('span', { class: 'stip-name', text: type.name }),
        el('span', { class: `stip-taste taste-${reading.tone}`, text: reading.word }),
        skill
          ? el('span', { class: 'stip-skill', text: skill })
          : el('span', { class: 'stip-skill stip-skill-unknown', text: 'ability unknown' })
      );
    })
  );
}

// Not a rivals list and an allies list, but everyone they have an opinion
// about, with the opinion named. A tag partner and a rival belong on the same
// list because the question the player is asking is the same one: who does this
// booking land on besides the two names in it?
function relationshipList(state, w) {
  const entries = relationshipsOf(state.wrestlers, w);
  if (!entries.length) {
    return el('p', { class: 'empty', text: 'Nobody here is anything to them yet.' });
  }

  return el('ul', { class: 'relations' },
    entries.map(entry =>
      el('li', { class: 'relation' },
        el('div', { class: 'rel-head' },
          wrestlerLink(state, entry.wrestler.id),
          el('span', { class: `rel-type rel-${entry.tone}`, text: entry.label })
        ),
        el('span', { class: 'rel-note', text: entry.note })
      )
    )
  );
}
