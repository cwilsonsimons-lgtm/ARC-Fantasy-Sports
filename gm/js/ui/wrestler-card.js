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
import { STATS, statReading, knowledgeTier, knowledgeLabel, knowledgePercent } from '../model/stats.js';
import { topRivals, topAllies } from '../model/relationships.js';
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
          el('h4', { text: 'Description' }),
          bioField(w)
        ),
        el('div', {},
          el('h4', { text: 'Stipulations' }),
          stipulationList(w),
          el('h4', { text: 'Top rivals' }),
          relationList(state, topRivals(state.wrestlers, w), ['match', 'matches'], 'No history in the ring with anyone yet.'),
          el('h4', { text: 'Top allies' }),
          relationList(state, topAllies(state.wrestlers, w), ['segment', 'segments'], 'Has not stood beside anyone yet.')
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
        w.grudges.length ? el('span', { class: 'chip chip-bad', text: 'grudge' }) : null
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
  const tier = knowledgeTier(w);
  const percent = knowledgePercent(w);

  return el('div', {},
    el('div', { class: 'read-head' },
      el('span', { class: 'read-label', text: knowledgeLabel(w) }),
      el('span', { class: 'read-pct', text: `${percent}%` })
    ),
    el('div', { class: 'read-bar' }, el('div', { class: 'read-fill', style: `width:${percent}%` })),
    el('p', { class: 'read-note muted', text: readNote(tier) }),
    el('ul', { class: 'stats' },
      STATS.map(stat => {
        const reading = statReading(w, stat.key);
        return el('li', {},
          el('span', { class: 'stat-key', text: stat.label }),
          el('span', {
            class: reading ? `stat-val stat-${tier}` : 'stat-val stat-unknown',
            text: reading || 'no read yet',
          }),
          el('span', { class: 'stat-note', text: stat.note })
        );
      })
    )
  );
}

function readNote(tier) {
  if (tier === 'known') return 'Weeks around them have made this reliable.';
  if (tier === 'impression') return 'A rough sense only. Book them more and it will sharpen.';
  return 'You have barely worked with them. Book them and you will learn.';
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

function relationList(state, entries, [one, many], emptyText) {
  if (!entries.length) return el('p', { class: 'empty', text: emptyText });

  return el('ul', { class: 'relations' },
    entries.map(({ wrestler, count }) =>
      el('li', {},
        wrestlerLink(state, wrestler.id),
        el('span', { class: 'rel-count', text: `${count} ${count === 1 ? one : many}` })
      )
    )
  );
}
