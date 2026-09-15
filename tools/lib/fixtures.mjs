// Test fixtures: a locker room with a past.
//
// The shipped roster is a blank slate on purpose - every save starts 0-0 with
// nobody holding a title and nobody having an opinion about the GM. That is
// correct for the game and inconvenient for tests, most of which need something
// to have already happened.
//
// So the history lives here instead, in the test tooling, where changing it
// cannot change what a player's first save looks like. A test that needs an
// established roster asks for one.

/** The authored backstory: records, morale, views of the GM, opinions of each
 *  other, and the handful of memories that used to ship with the roster. */
export const AUTHORED_HISTORY = [
    {
      "key": "croft",
      "standing": {
        "wins": 41,
        "losses": 12,
        "draws": 3,
        "streak": {
          "type": "W",
          "count": 3
        }
      },
      "state": {
        "morale": 74,
        "momentum": 45,
        "mood": "confident"
      },
      "gm": {
        "trust": 45,
        "respect": 38
      },
      "relationships": {
        "vance": -40,
        "wren": 5,
        "delacroix": 25,
        "mabry": -5
      },
      "memory": [
        {
          "type": "career",
          "weight": 70,
          "floor": 45,
          "decayPerDay": 0.2,
          "scar": true,
          "aboutKeys": [
            "vance"
          ],
          "summary": "Vance went over me clean in front of the largest crowd of my career"
        }
      ]
    },
    {
      "key": "vance",
      "standing": {
        "wins": 33,
        "losses": 15,
        "draws": 2,
        "streak": {
          "type": "W",
          "count": 1
        }
      },
      "state": {
        "morale": 81,
        "momentum": 55,
        "mood": "confident"
      },
      "gm": {
        "trust": 60,
        "respect": 55
      },
      "relationships": {
        "croft": -45,
        "okonkwo": 35,
        "sparrow": 40
      },
      "memory": [
        {
          "type": "career",
          "weight": 80,
          "floor": 50,
          "decayPerDay": 0.15,
          "scar": true,
          "aboutKeys": [
            "croft"
          ],
          "summary": "Beat Croft clean for the top spot and he has not spoken to me since"
        }
      ]
    },
    {
      "key": "wren",
      "standing": {
        "wins": 28,
        "losses": 9,
        "draws": 1,
        "streak": {
          "type": "W",
          "count": 6
        }
      },
      "state": {
        "morale": 44,
        "momentum": 62,
        "mood": "frustrated"
      },
      "gm": {
        "trust": 22,
        "respect": 40
      },
      "relationships": {
        "croft": -62,
        "pike": 45,
        "delacroix": -20
      },
      "memory": [
        {
          "type": "gm_promise_broken",
          "weight": 85,
          "floor": 55,
          "decayPerDay": 0.1,
          "scar": true,
          "aboutKeys": [
            "croft"
          ],
          "summary": "Told I was next in line, then watched Croft get the shot with a worse record"
        },
        {
          "type": "standing",
          "weight": 60,
          "floor": 20,
          "decayPerDay": 0.4,
          "aboutKeys": [],
          "summary": "Six straight wins and still opening the show"
        }
      ]
    },
    {
      "key": "okonkwo",
      "standing": {
        "wins": 24,
        "losses": 11,
        "draws": 0,
        "streak": {
          "type": "L",
          "count": 1
        }
      },
      "state": {
        "morale": 68,
        "momentum": 20,
        "mood": "focused"
      },
      "gm": {
        "trust": 70,
        "respect": 62
      },
      "relationships": {
        "delacroix": -68,
        "vance": 40,
        "kane": 30
      },
      "memory": [
        {
          "type": "cheated",
          "weight": 88,
          "floor": 50,
          "decayPerDay": 0.12,
          "scar": true,
          "aboutKeys": [
            "delacroix"
          ],
          "summary": "Delacroix had a fistful of tights and the referee never saw it"
        }
      ]
    },
    {
      "key": "kane",
      "standing": {
        "wins": 31,
        "losses": 19,
        "draws": 4,
        "streak": {
          "type": "W",
          "count": 2
        }
      },
      "state": {
        "morale": 79,
        "momentum": 25,
        "mood": "content"
      },
      "gm": {
        "trust": 78,
        "respect": 70
      },
      "relationships": {
        "pike": 58,
        "ruiz": 48,
        "okonkwo": 30,
        "halloran": -15
      },
      "memory": [
        {
          "type": "kindness",
          "weight": 55,
          "floor": 25,
          "decayPerDay": 0.2,
          "aboutKeys": [
            "ruiz"
          ],
          "summary": "Ruiz stayed behind to help me to the back after a bad landing"
        }
      ]
    },
    {
      "key": "delacroix",
      "standing": {
        "wins": 26,
        "losses": 14,
        "draws": 1,
        "streak": {
          "type": "W",
          "count": 4
        }
      },
      "state": {
        "morale": 72,
        "momentum": 48,
        "mood": "confident"
      },
      "gm": {
        "trust": 38,
        "respect": 44
      },
      "relationships": {
        "okonkwo": -18,
        "croft": 30,
        "bloom": -35
      },
      "memory": []
    },
    {
      "key": "pike",
      "standing": {
        "wins": 18,
        "losses": 27,
        "draws": 2,
        "streak": {
          "type": "L",
          "count": 3
        }
      },
      "state": {
        "morale": 61,
        "momentum": -30,
        "mood": "content"
      },
      "gm": {
        "trust": 82,
        "respect": 66
      },
      "relationships": {
        "kane": 58,
        "wren": 45,
        "lund": 40
      },
      "memory": []
    },
    {
      "key": "bloom",
      "standing": {
        "wins": 15,
        "losses": 20,
        "draws": 1,
        "streak": {
          "type": "W",
          "count": 1
        }
      },
      "state": {
        "morale": 66,
        "momentum": 10,
        "mood": "restless"
      },
      "gm": {
        "trust": 52,
        "respect": 48
      },
      "relationships": {
        "sparrow": 52,
        "delacroix": -35
      },
      "memory": []
    },
    {
      "key": "halloran",
      "standing": {
        "wins": 52,
        "losses": 48,
        "draws": 6,
        "streak": {
          "type": "L",
          "count": 4
        }
      },
      "state": {
        "morale": 38,
        "momentum": -55,
        "mood": "frustrated"
      },
      "gm": {
        "trust": 40,
        "respect": 30
      },
      "relationships": {
        "sparrow": -32,
        "ruiz": -28,
        "kane": -15,
        "croft": 20
      },
      "memory": [
        {
          "type": "career",
          "weight": 75,
          "floor": 45,
          "decayPerDay": 0.1,
          "scar": true,
          "aboutKeys": [],
          "summary": "Told my main event days were behind me, by someone who never had any"
        }
      ]
    },
    {
      "key": "sparrow",
      "standing": {
        "wins": 21,
        "losses": 16,
        "draws": 0,
        "streak": {
          "type": "W",
          "count": 2
        }
      },
      "state": {
        "morale": 73,
        "momentum": 35,
        "condition": 82,
        "mood": "confident"
      },
      "gm": {
        "trust": 64,
        "respect": 58
      },
      "relationships": {
        "bloom": 52,
        "vance": 40,
        "halloran": -30
      },
      "memory": [
        {
          "type": "injury",
          "weight": 50,
          "floor": 20,
          "decayPerDay": 0.3,
          "aboutKeys": [],
          "summary": "Landed badly off the top rope and worked six weeks hurt rather than lose the spot"
        }
      ]
    },
    {
      "key": "ruiz",
      "standing": {
        "wins": 4,
        "losses": 11,
        "draws": 0,
        "streak": {
          "type": "L",
          "count": 2
        }
      },
      "state": {
        "morale": 70,
        "momentum": -15,
        "mood": "focused"
      },
      "gm": {
        "trust": 74,
        "respect": 60
      },
      "relationships": {
        "kane": 62,
        "halloran": -20,
        "lund": 35
      },
      "memory": []
    },
    {
      "key": "lund",
      "standing": {
        "wins": 3,
        "losses": 34,
        "draws": 1,
        "streak": {
          "type": "L",
          "count": 9
        }
      },
      "state": {
        "morale": 55,
        "momentum": -60,
        "mood": "content"
      },
      "gm": {
        "trust": 80,
        "respect": 55
      },
      "relationships": {
        "pike": 40,
        "ruiz": 35,
        "mabry": 30
      },
      "memory": []
    },
    {
      "key": "mabry",
      "standing": {
        "wins": 5,
        "losses": 29,
        "draws": 0,
        "streak": {
          "type": "L",
          "count": 6
        }
      },
      "state": {
        "morale": 34,
        "momentum": -58,
        "mood": "frustrated"
      },
      "gm": {
        "trust": 30,
        "respect": 35
      },
      "relationships": {
        "croft": -44,
        "lund": 30,
        "halloran": 25
      },
      "memory": [
        {
          "type": "humiliation",
          "weight": 78,
          "floor": 42,
          "decayPerDay": 0.15,
          "scar": true,
          "aboutKeys": [
            "croft"
          ],
          "summary": "Croft beat me in forty seconds and did not bother learning my name"
        }
      ]
    },
    {
      "key": "kovac",
      "standing": {
        "wins": 6,
        "losses": 7,
        "draws": 0,
        "streak": {
          "type": "W",
          "count": 1
        }
      },
      "state": {
        "morale": 76,
        "momentum": 22,
        "mood": "confident"
      },
      "gm": {
        "trust": 68,
        "respect": 64
      },
      "relationships": {
        "okonkwo": 42,
        "wren": -25
      },
      "memory": []
    }
  ];

/**
 * Apply the whole backstory to a freshly seeded roster.
 * `k` is the key-to-id map that seedRoster() returns.
 */
export function establishHistory(store, k) {
  const resolve = (key) => {
    const id = k[key];
    if (!id) throw new Error(`fixture references unknown wrestler key ${key}`);
    return id;
  };

  for (const h of AUTHORED_HISTORY) {
    const id = resolve(h.key);

    if (Object.keys(h.standing).length) {
      store.updateStanding(id, h.standing, { reason: 'fixture: career to date' });
    }
    if (Object.keys(h.state).length) {
      store.updateWrestlerState(id, h.state, { reason: 'fixture: current state', silent: true });
    }
    if (Object.keys(h.gm).length) {
      const w = store.getWrestler(id);
      store.adjustGmTie(id, {
        trust: (h.gm.trust ?? 50) - w.ties.gm.trust,
        respect: (h.gm.respect ?? 50) - w.ties.gm.respect,
      }, { reason: 'fixture: view of the GM' });
    }

    const relationships = {};
    for (const [key, value] of Object.entries(h.relationships)) relationships[resolve(key)] = value;
    const memory = h.memory.map(({ aboutKeys = [], ...m }) => ({ ...m, aboutIds: aboutKeys.map(resolve) }));
    if (Object.keys(relationships).length || memory.length) {
      store.setBackstory(id, { relationships, memory });
    }
  }
  return k;
}

/** Put a belt on somebody, as if they had held it for a while already. */
export function crownChampion(store, titleId, wrestlerId, daysHeld = 0) {
  return store.awardTitle(titleId, [wrestlerId], {
    wonOnDay: store.today() - daysHeld,
    reason: 'fixture: held coming into the save',
  });
}

/** Give one wrestler a record without playing the matches. */
export function giveRecord(store, wrestlerId, { wins = 0, losses = 0, draws = 0, streak = null }) {
  return store.updateStanding(wrestlerId, {
    wins, losses, draws,
    streak: streak || { type: null, count: 0 },
  }, { reason: 'fixture: record' });
}
