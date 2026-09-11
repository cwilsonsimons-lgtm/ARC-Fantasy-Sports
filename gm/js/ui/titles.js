// The championships. All of them optional — you may retire any belt, including
// the ones you started with, and a promotion that never adds a fourth is a
// perfectly good promotion.
import { el } from './dom.js';
import { commit } from '../store.js';
import { wrestlerLink } from './links.js';
import {
  activeTitles, reignWeeks, slotsEarned, slotsUsed, nextSlotAt,
  availableToAdd, addTitle, retireTitle, reinstateTitle,
} from '../model/titles.js';

export function renderTitles(state) {
  const active = activeTitles(state);
  const retired = (state.titles || []).filter(t => !t.active);

  return el('section', {},
    el('h2', { text: 'Championships' }),
    el('p', { class: 'muted', text: 'Every promotion starts with three. The network sanctions more as it comes to trust you, and you choose which. Nothing here is compulsory — a belt you do not want can be retired.' }),

    slotPanel(state),

    active.length
      ? active.map(title => titleCard(state, title, false))
      : el('p', { class: 'empty', text: 'No active championships. That is a choice you are allowed to make.' }),

    retired.length
      ? el('div', {},
          el('h3', { text: `Retired (${retired.length})` }),
          retired.map(title => titleCard(state, title, true))
        )
      : null
  );
}

function slotPanel(state) {
  const earned = slotsEarned(state);
  const used = slotsUsed(state);
  const open = earned - used;
  const next = nextSlotAt(state);
  const choices = availableToAdd(state);

  if (open <= 0) {
    return el('div', { class: 'panel' },
      el('h3', { text: 'Sanctioning' }),
      el('p', { class: 'muted', text: next
        ? `The network will sanction another championship at ${next} network trust. You have ${state.network.trust}.`
        : 'The network has sanctioned everything it is going to.' })
    );
  }

  return el('div', { class: 'panel slots' },
    el('h3', { text: `${open} championship${open === 1 ? '' : 's'} sanctioned` }),
    el('p', { class: 'muted', text: 'Pick what you actually want. A new belt starts vacant — somebody has to win it.' }),
    el('ul', { class: 'choices' },
      choices.map(choice =>
        el('li', {},
          el('div', {},
            el('div', { class: 'choice-name', text: choice.name }),
            el('div', { class: 'choice-note', text: choice.note })
          ),
          el('button', {
            type: 'button', class: 'btn primary', text: 'Bring it in',
            onClick: () => commit(s => addTitle(s, choice.key)),
          })
        )
      )
    )
  );
}

function titleCard(state, title, isRetired) {
  const champions = title.championIds;
  const weeks = reignWeeks(state, title);

  return el('div', { class: isRetired ? 'belt-card retired' : `belt-card ${title.tier}` },
    el('div', { class: 'belt-head' },
      el('div', {},
        el('div', { class: 'belt-name' },
          title.name,
          el('span', { class: 'chip', text: title.holders === 2 ? 'tag team' : 'singles' }),
          title.gender ? el('span', { class: 'chip', text: title.gender === 'Female' ? "women's" : "men's" }) : null,
          title.base ? null : el('span', { class: 'chip chip-ppv', text: 'sanctioned' })
        ),
        champions.length
          ? el('div', { class: 'belt-champ' },
              'Held by ',
              ...champions.flatMap((id, index) => index ? [' & ', wrestlerLink(state, id)] : [wrestlerLink(state, id)]),
              el('span', { class: 'belt-meta', text: ` · ${title.since <= 0 ? 'champion since before you arrived' : `${weeks} week${weeks === 1 ? '' : 's'}`} · ${title.defenses} defence${title.defenses === 1 ? '' : 's'}` })
            )
          : el('div', { class: 'belt-champ vacant', text: isRetired ? 'Retired.' : 'Vacant. Somebody has to win it.' })
      ),
      el('button', {
        type: 'button', class: isRetired ? 'btn' : 'btn danger',
        text: isRetired ? 'Bring it back' : 'Retire',
        onClick: () => commit(s => (isRetired ? reinstateTitle(s, title.id) : retireTitle(s, title.id))),
      })
    ),
    lineage(state, title)
  );
}

// Seeded reigns start on negative weeks, because they began before the player
// took the job. "weeks -14--3" is not a sentence.
function reignSpan(reign) {
  const { wonWeek, lostWeek } = reign;
  if (wonWeek <= 0 && lostWeek <= 0) return 'before you took over';
  if (wonWeek <= 0) return `up to week ${lostWeek}`;
  return `weeks ${wonWeek}–${lostWeek}`;
}

function lineage(state, title) {
  const past = title.lineage.filter(reign => reign.lostWeek !== null).reverse();
  if (!past.length) return null;

  return el('details', { class: 'lineage' },
    el('summary', { text: `Previous reigns (${past.length})` }),
    el('ul', {},
      past.map(reign =>
        el('li', {},
          ...reign.championIds.flatMap((id, index) => index ? [' & ', wrestlerLink(state, id)] : [wrestlerLink(state, id)]),
          el('span', { class: 'belt-meta', text: ` · ${reignSpan(reign)} · ${reign.defenses} defence${reign.defenses === 1 ? '' : 's'}` })
        )
      )
    )
  );
}
