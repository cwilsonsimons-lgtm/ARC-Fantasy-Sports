# Gorilla Position — Game Vision Document

*Working title. A single-player backstage wrestling GM simulation.*

**Status:** Foundation draft — systems design only. No stat schemas, no code.

---

## 0. The foundational decision: hard kayfabe

Before anything else, one ambiguity in the concept has to be resolved, because
almost every other system depends on it.

Traditional wrestling sims are *shoot* games. You are a promoter. You know
wrestling is scripted, your wrestlers know it's scripted, and the drama comes
from who "goes over" and who resents being booked to lose.

**This game is not that. This game runs on hard kayfabe.**

Inside the fiction, wrestling is a legitimate combat sport. Matches are
contests. Wins and losses are real. Championships are real prizes. Injuries are
real injuries. The General Manager is a genuine sporting authority who decides
who gets *opportunities* — title shots, contendership, marquee spots, airtime,
the microphone.

This single decision does a lot of load-bearing work:

- **Wrestler motivation becomes legible without explanation.** "I deserve that
  title shot" is a real grievance about a real thing, not a meta-complaint about
  a script. Every request in the game is about opportunity, and opportunity is
  the scarce resource the GM controls.
- **It makes the supernatural coherent.** An eerie cult leader is not a
  performer with a good gimmick. He is genuinely unsettling, and things
  genuinely happen around him. The game never has to wink.
- **It removes double-think.** A shoot game has to explain why a wrestler is
  furious about a *scripted* loss; a kayfabe game doesn't.
- **It protects immersion.** The player is a character in this world, not an
  author above it. Everything they see, they see from inside the building.

Nothing is lost. Politics, favoritism, contracts, egos, factions, blackmail,
locker-room hierarchy and the constant war over airtime all survive the
translation — they just become the politics of a sport rather than the politics
of a writers' room.

**Rule:** the game never breaks kayfabe. Not in the UI, not in the tooltips, not
in the dirt sheet. There is no "creative", no "push", no "job", no "work". There
are opportunities, rankings, contracts, decisions and consequences.

---

## 1. The player's role and the fantasy

You are the **General Manager** of a weekly wrestling television show. You have
authority over the card, the championships, the contenders and the roster. You
also have an office with a door that anybody can knock on, an earpiece that
never stops talking, and a show that goes to air whether you are ready or not.

The fantasy is **authority under siege**.

You have real power — you decide who wrestles, who gets a shot, who gets the
microphone, who goes home early. But you are also physically present,
reachable, interruptible, outnumbered, and on a clock. Everyone in the building
wants something from you, most of them want it *now*, and there are more wants
than there are minutes of television.

The emotional target is a very specific feeling:

> It's 7:55. Five minutes to air. The rundown is on the monitor, your talent
> relations lead is telling you something about the tag champions that you do
> not want to hear, the network is on line two, and somebody is knocking on your
> office door.

Not "I am a wrestling booker optimising a card." Rather: **"I am the person
everyone comes to, and the show starts in five minutes."**

### What you actually spend

The player has three currencies, and all three are scarce every single week.

| Currency | What it is | Why it's scarce |
| --- | --- | --- |
| **Airtime** | Minutes of television | The broadcast window is fixed and zero-sum. Every want costs minutes. |
| **Attention** | Your own presence and time | You are in exactly one place at a time and the show does not pause for you. |
| **Goodwill** | Standing with the roster, the executives, and individuals | Spent by saying no. Earned by keeping your word. Slow to rebuild. |

Money is not a fourth currency. This is not a business sim. Financial pressure
reaches the player only through the executives, as demands.

### Design pillars

1. **You are in the building.** Presence, not omniscience.
2. **The card is a hypothesis.** Plans exist to survive contact with the show.
3. **Everyone remembers.** Nothing resets at the end of an episode.
4. **Choose who to disappoint.** Scarcity is the game, not an obstacle to it.
5. **The strange is real.** Hard kayfabe means the monsters are monsters.
6. **Stories are found, not written.** Emergent, but made legible.

---

## 2. The main gameplay loop

The game runs on a weekly television cycle, wrapped in longer arcs.

**The weekly loop:**

**Booking** → **Broadcast** → **Aftermath** → **The Week Between** → repeat.

- **Booking** (5–8 min of play) — build the rundown, take meetings, absorb
  directives, make promises.
- **Broadcast** (12–20 min of play) — the show airs. This is the game.
- **Aftermath** (3–5 min) — consequences, fallout, the executive scorecard, the
  new grievance queue.
- **The Week Between** (1–3 min) — a small, deliberately thin interstitial. A
  handful of decisions, not a second game.

**The seasonal loop:** quarterly special events (the big shows), executive
review periods, contract cycles, championship reigns, roster turnover, and the
slow accumulation of your reputation as a GM.

The weekly loop is the game's heartbeat. The seasonal loop is what makes the
weekly loop matter.

---

## 3. Before, during and after the show

### 3.1 Before the show — *The Card Room*

The player builds a **rundown**: an ordered, timed list of segments that fills
the broadcast window.

**The rundown board.** Segments are blocks with a position, a duration, and
participants. The total must fit the content budget (the broadcast window minus
commercial breaks). Matches, promos, interviews, contract signings,
championship presentations, backstage vignettes, GM announcements.

**Slack is expensive.** The obvious safe play is to leave buffer minutes. But
unbooked minutes are *dead air*, and executives notice dead air. The optimal
card is slightly too tight — which is exactly what makes the overrun bite. This
tension is deliberate and should never be balanced away.

**Advertised segments.** Some things are promised to the audience in advance —
by you, by the network, or by a wrestler's contract. An advertised match is a
promise, and promises are the highest-value, highest-damage objects in the
game. Delivering builds trust with everyone. Failing to deliver is a breach the
whole world notices.

**Office hours.** A queue of people who want to see you. You can take a limited
number of meetings before you have to be at Gorilla. Whom you see is a decision;
whom you *don't* see is also a decision, and they notice.

**Directives.** Executives hand down mandates — some standing ("keep the show
inside its window"), some specific to this week ("the champion appears in the
first fifteen minutes").

**Contract obligations.** Guaranteed appearances, guaranteed title shots,
no-compete clauses, "I will not work with that person" clauses you agreed to
months ago and forgot.

### 3.2 During the show — *The Broadcast*

The show plays out on a clock the player watches from backstage.

**The clock.** Variable compression: real-time, accelerated, or "advance to the
next decision". The clock is always visible and always the most important
number on screen.

**The critical timing rule: thinking is free, acting costs clock.**
The player may pause and deliberate as long as they like. But *every action*
costs show-clock time — walking to another location, having a conversation,
finding someone, calming someone down. Pressure comes from scarcity and
simultaneity, never from twitch reflexes. When two things need you at once,
pausing doesn't help; you still have to choose.

**Presence — where you physically are.** This is the mechanical heart of the
backstage fantasy, and the single biggest departure from a booking sim.

| Location | What it gives you | What it costs you |
| --- | --- | --- |
| **The Office** | Privacy. Formal meetings. The right room for hard conversations. | You are blind to the show. Incidents escalate unattended. |
| **Gorilla Position** | Live timing control, segment adjustment, and you catch people the moment they come through the curtain — at peak emotion. | You are visible to everyone. Anyone can reach you. |
| **The Corridor / Catering** | You see the roster as it actually is: who's standing with whom, who won't look at you, tension before it becomes an incident. | Timing drifts. Gorilla runs without you. |
| **The Production Truck** | What the audience sees. Crowd reaction. The executives call here. | You are furthest from your people. |
| **Ringside** | The nuclear option: the GM on television. Enormous effect. | It burns airtime, and afterwards you are an on-screen character with all that entails. |

Travel between locations costs clock. You cannot be everywhere. That is the
point.

**The Feed.** One inbox, ranked by urgency. Producer notes in your ear, a runner
with news, a wrestler at your door, an executive on the phone, a report of a
disturbance in the parking lot. Everything routes through a single channel so
the interface never sprawls.

**Live decisions.** Extend or shorten a segment. Cut it. Add one. Reorder.
Send someone to the ring. Go out yourself. Make a promise. Issue a warning.
Send security. Grant a request. Refuse one. Or say nothing and let it ride.

**Delegation.** You have a small staff — a road agent, a talent relations lead,
a head of security, a producer in the truck. You can hand anything to them.
They resolve it plausibly, cheaply, and imperfectly, according to their own
competence and their own opinions. Delegation is the pressure-release valve
that makes a large roster survivable.

### 3.3 After the show — *The Aftermath*

**The post-show report.** What aired versus what was planned. Timing accuracy.
Promises kept and broken. Crowd reaction and ratings by segment.

**The locker room.** Who is angry, who noticed, who is quietly pleased, who is
quietly not. Never as numbers — as reports, overheard remarks, and body
language.

**The causal ledger.** The most important screen in the game. For every change
in the world, the player can ask **"why?"** and get the chain:

> Mercer's promo was cut → Mercer believes he is being buried → Mercer blames
> Calloway (third overrun this month) → Mercer–Calloway relationship collapses
> → Mercer has requested a meeting.

Emergence that the player cannot trace feels like a bug. Making the causal
chain inspectable is what converts simulation output into story.

**The executive review.** Weekly, light. Quarterly, heavy.

**The queue.** Who wants to see you before next week's show.

### 3.4 The week between

Deliberately thin. Three to six decisions: respond to messages, grant or deny
requests, medical clearances, a contract conversation, the occasional incident
that happens away from television. Enough to keep the world alive; not enough to
become a second game.

---

## 4. The major simulation systems

Thirteen domains. This is architecture, not stat design.

1. **Roster & Persona** — identity, in-world stature, competitive style,
   contract, health, championship history.
2. **Personality & Disposition** — the trait system that drives reaction
   functions. Ambition, ego, loyalty, patience, aggression, selfishness,
   professionalism, cooperativeness, deference to authority, jealousy, and more.
3. **Memory & Grievance** — durable event memory with personality-modified
   decay. Grudges are first-class objects with a target, a cause, an intensity
   and a history.
4. **Relationships & the Social Graph** — pairwise ties (respect, affection,
   trust, rivalry) plus group structures: factions, tag teams, cliques,
   mentorships, romances, families, shared history.
5. **Perception & Belief** — *the most distinctive system in the game.*
   Wrestlers do not react to events. They react to what they *believe* happened.
   Rumour propagates through the social graph, distorting as it travels.
   Attribution can be wrong. Wrestler D blaming Wrestler A is not a bug in the
   simulation; it is the simulation's whole purpose.
6. **Show Simulation** — segment resolution, timing variance, crowd reaction,
   in-ring incidents, injury.
7. **Incidents & Interruptions** — the event generator. Incidents are not drawn
   from a script table; they are *proposed* by wrestlers out of their own state,
   filtered by opportunity (who is near whom, is the GM reachable, is there a
   slot), then scheduled.
8. **Presence & Attention** — the GM's location, travel time, and what each
   place lets them see and do.
9. **Authority & Discipline** — warnings, fines, suspensions, demotions,
   favours, and **promises**. The Promise Ledger tracks every commitment the GM
   makes; the game remembers so the player doesn't have to.
10. **Executives & Corporate** — bosses with agendas, directives, scorecards,
    patience, and — importantly — disagreements *with each other*.
11. **The Anomaly Layer** — a parallel rule set for wrestlers whose nature does
    not obey normal social physics. See §4.1.
12. **The Chronicle** — the narrative surfacing layer. Recaps, headlines, a
    dirt sheet of variable reliability, and the naming of arcs.
13. **Careers & Entropy** — aging, injury, contracts expiring, debuts,
    departures, retirements. The roster must change or the game ossifies.

Two cross-cutting objects deserve naming: the **Rundown** (the show as data, in
planned and actual form) and **The Read** (the player's own fallible dossier on
each wrestler — see §7).

### 4.1 The Anomaly Layer

Some wrestlers exist outside normal wrestling logic. The system must support
them without letting them eat the game.

**Anomalies are defined by three departures, not by magic:**

1. **Altered response curves.** Normal levers do not apply. You cannot
   intimidate a monster with a fine. Threatening a cult leader may *strengthen*
   him. Their reaction functions are genuinely different, not just extreme.
2. **Expanded expression channels.** Anomalies can act in ways ordinary
   wrestlers cannot: manifesting where they shouldn't be, targeting someone over
   weeks, interrupting the broadcast itself, making demands that aren't about
   opportunity at all.
3. **Ambient generation.** Anomalies produce incidents *without* a grievance.
   Ordinary wrestlers act because something happened to them. Anomalies act
   because of what they are.

**The crucial constraint: anomalies work through belief, not through physics.**
The Verger's real power is over the **perception system** — he unsettles,
isolates, recruits and converts. He edits the social graph. That is why he is
dangerous, and it requires no supernatural mechanics at all. The eeriness is in
what he does to *other people*, which is exactly how it works on television.

**The Uncanny Budget.** A world-level dial, set at world creation and drifting
with roster composition, governing how much anomaly may manifest per show.
Three presets:

- **Grounded** — anomalies are unnerving personalities and nothing more.
- **Shaded** *(default)* — strange things happen, and a mundane explanation is
  always available. The lights went out. It was a breaker. Probably.
- **Supernatural** — the game confirms.

At Shaded, the game never adjudicates. This lets one system serve wildly
different player tastes without a mode switch.

**Anomaly archetypes** (a taxonomy, not a list of characters):

- **The Monster** — immune to intimidation; responds only to challenge and
  dominance.
- **The Cult** — recruits and converts; the only wrestler type that can
  permanently change another wrestler's disposition.
- **The Haunting** — fixates on one target and works on them for weeks.
- **The Trickster** — unreliable; breaks the structure of the show itself.
- **The Prophet** — declares that something will happen, and the incident
  generator quietly weights toward it. The player can never tell whether it was
  causation or coincidence. The most elegant of the five.

**Leverage over an anomaly is different in kind.** You cannot discipline them.
You bargain, contain, feed them a target, or try to break them — a distinct verb
set that makes them feel genuinely other at the interface level, not just in
their stats.

---

## 5. How wrestler autonomy works

Every wrestler is a lightweight autonomous agent running the same six-stage
cycle. Personality changes the shape of every stage.

**Goals** — what this person wants. Title contention. The spotlight. Respect
from a specific peer. Protection of a friend. Revenge. Avoiding a particular
opponent. Simply staying healthy until the contract renews.

**Appraisal** — every perceived event is measured against those goals. This
generates attitude, not action.

**Threshold** — personality sets the trigger point where internal state becomes
outward behaviour. A patient veteran absorbs four slights. A volatile rookie
absorbs none.

**Channel selection** — and here is the rule that matters most:

> **Personality selects the *channel*, not merely the *magnitude*.**

Given exactly the same slight, one wrestler requests a meeting. One complains to
a friend. One complains to everyone. One confronts the person they blame. One
interrupts the GM mid-show. One says nothing at all and banks it for eleven
weeks. One doesn't care, because their friend got the spot instead. That variety
*is* the personality system. If personality only scaled a morale number, the
game has failed at its central promise.

**Opportunity gating** — an intended action only fires if the world permits it.
Is the GM reachable? Is the target in the building? Is there a slot? Is anyone
watching? A wrestler who wants to confront you and can't find you carries that
intent into next week, more sour than before.

**Escalation** — unaddressed grievances climb a ladder:

> silence → a word to a friend → a formal request → a public complaint →
> refusal to cooperate → confrontation → sabotage → walkout

This ladder is the engine of long-form drama. A small thing becomes a big thing
because it was *ignored*, which is the most authentic wrestling-backstage
dynamic there is.

### Three non-negotiable properties of real autonomy

1. **Wrestlers act when the player isn't looking.** They form alliances, feud,
   make deals and fall out entirely without GM involvement. Autonomy that only
   exists in response to the player is not autonomy.
2. **Wrestlers have agency inside segments.** A wrestler with a grudge can go
   into business for themselves: deliberately run long, refuse to break, attack
   after the bell, refuse to leave the ring, say something on the microphone
   that was not sanctioned, go after the wrong person entirely. This is the
   deepest expression of autonomy and the source of the best crises.
3. **Wrestlers model the GM.** They hold beliefs about you — whether you keep
   your word, whether you have favourites, whether you can be pushed. They act
   on those beliefs. New signings arrive already having heard about you.

---

## 6. How emergent stories develop

Stories are not generated. They are the visible trace of a loop closing.

**The emergence pipeline:**

> **Event** → **Perception** (who saw or heard, and how distorted) →
> **Attribution** (who gets blamed) → **Appraisal** (what it means to me) →
> **Memory** (durable, decaying at a personal rate) → **Intent** (what I want
> now) → **Expression** (a visible act) → **new Event**

A story is a cycle in this graph. Wrestler D's confrontation is an Event that
Wrestler A perceives, appraises and remembers, and the loop turns again.

**Five design supports that make the loop produce good stories:**

- **Scarcity guarantees conflict.** With finite slots, every gain is someone
  else's loss. The game does not need a drama generator; the rundown *is* the
  drama generator.
- **Attribution is allowed to be wrong.** Misplaced blame is where the best
  material lives. D blaming A for the overrun — when the overrun was actually
  the referee's slow count — is more interesting than D being correct.
- **Third parties amplify.** Friends escalate on behalf of friends. Factions
  turn a two-person problem into a nine-person problem. The social graph is a
  multiplier on every grievance.
- **Seeded history.** World generation lays down existing relationships,
  grudges, debts and title histories. Week one is never a blank slate.
- **The Chronicle names things.** When a rivalry crosses a threshold, the game
  *names* it, gives it a page, and puts it in the dirt sheet. Naming is the
  single cheapest, highest-leverage tool for making a systemic pattern feel like
  a story. Players do not experience a relationship value of −74; they
  experience "The Calloway Problem."

### Worked example — the user's own scenario, as the systems see it

| Step | System | What happens |
| --- | --- | --- |
| 1 | Rundown | Calloway vs. Ibarra booked for 15:00. |
| 2 | Show sim | The match runs 22:00. Overrun: +7:00. |
| 3 | Airtime | 18:00 of content budget remains, not 25:00. |
| 4 | Player | Vaughn's match cut 12:00 → 6:00. Mercer's promo cut entirely. |
| 5 | Appraisal (Vaughn) | High professionalism, low ambition. Registers the slight, absorbs it, files it. No action. |
| 6 | Appraisal (Mercer) | High ambition, existing belief that he is overlooked. This confirms the belief. Confirmation of an existing belief hits far harder than a novel slight. |
| 7 | Attribution | Mercer needs a cause. The GM is one candidate; Calloway is another — and Calloway has overrun three times this quarter. Mercer's disposition and his existing low regard for Calloway route the blame to Calloway. |
| 8 | Channel | Mercer's aggression and low patience select *direct confrontation*, not a meeting request. |
| 9 | Opportunity | Calloway is at Gorilla. Mercer is in the corridor. They will pass each other. The incident fires. |
| 10 | Relationship | Mercer–Calloway collapses. Witnesses form their own opinions, filtered by their own ties to both men. |
| 11 | Executives | The advertised Mercer segment did not air. Breach logged. |
| 12 | Next week | Mercer is in the office queue, demanding a match with Calloway — which, if granted, is genuinely compelling television, which the executives will reward. |

None of that was authored. All of it is inevitable given the systems. And step
12 is the payoff: **the crisis becomes next week's best content.** The game
should reliably produce that shape, because it is what makes the player forgive
the chaos.

---

## 7. Hidden versus visible information

Three tiers, and the middle one is where the game lives.

### Always visible — hard state

The clock. The rundown, planned and actual. Who is on the card. Contracts,
championships, rankings, win–loss records. Diagnosed injuries. Directives you
have been given. **Every promise you have made.** Everything that has publicly
happened.

The player should never lose to bookkeeping. If it is a fact about the world and
the GM would obviously know it, show it.

### Never visible — true state

Exact personality values. Exact relationship values. Morale numbers. Hidden
grudges. Conversations you were not in. What a wrestler actually believes about
you. The real reason someone did something. Secret alliances. An executive's
private opinion of your competence. The exact formula behind the executive
scorecard — you are told their *priorities*, never their arithmetic.

**Numbers are never shown for feelings.** Not in a tooltip, not on a hover, not
in an advanced view. The moment a player can read "Loyalty: 62" they stop
reading people and start reading a spreadsheet, and the entire fantasy dies.

### Visible through inference — the interesting middle

Body language. Tone. Who is standing with whom in catering. Who didn't look at
you. What your talent relations lead reports — filtered through *her* opinions
and *her* relationships. The dirt sheet, which is often wrong. What a wrestler
says in a meeting, which may be a performance, a negotiation, or a lie.

**The Read.** The player's dossier on each wrestler is itself a game object: an
accumulation of impressions, expressed in language and confidence, never in
numbers, and **capable of being wrong**. "You believe Vaughn is easygoing about
this sort of thing." You might be mistaken. You might have been played.

**Hidden is never unknowable.** There is always a path to information — talk to
people, spend attention, build trust, use your staff, watch the room. Knowledge
is a resource bought with the same currencies as everything else. This is the
line between mystery and unfairness.

---

## 8. Short-term and long-term consequences

Consequences must land across five time horizons simultaneously.

| Horizon | Scale | Example |
| --- | --- | --- |
| **Immediate** | Seconds | The segment overruns. The crowd reacts. |
| **Same show** | Minutes | You cut a segment; the cut causes a corridor incident. |
| **Next week** | Days | Requests, demands, refusals, new matches to book. |
| **This quarter** | Weeks | Grudges mature. Factions shift. The executives review you. |
| **This career** | Years | Who left. Who became a star. Who never forgave you. |

**The core trade shape:** decisions should be *cheap now and expensive later*, or
*expensive now and cheap later*. Cut the ambitious man's segment to save the
show — cheap now, expensive for months. Let the main event run and take the
network's anger — expensive now, and you keep the locker room.

**Two rules govern how consequences accumulate:**

1. **Repetition converts events into beliefs, and beliefs do not decay.** A
   single overlooked week fades. Being overlooked four times in six weeks
   becomes an identity: *"management does not see me."* Once it's a belief,
   every subsequent event is read through it. This is how the game generates
   long-term characters instead of long-term grudges.
2. **Positive memory is real and compounds.** Kept promises, defended
   reputations, favours granted, a spot given when it wasn't owed — these
   accumulate into loyalty that survives later disappointments. Without this the
   game is a doom spiral. See §11.7.

**Your reputation as GM.** The heaviest long-term object in the game: a set of
traits the roster believes about *you*, emergent from your behaviour and not
directly visible to you. *Keeps his word. Protects the main eventers. Plays
favourites. Can be pushed. Unpredictable.* Reputation changes how people
behave toward you *before they have ever met you* — including new signings, and
including the executives. It is the accumulated weight of every week you have
worked.

---

## 9. Keeping it manageable at scale

A roster of fifty autonomous agents each with wants is a nightmare unless the
design fights for the player's attention deliberately. Nine mechanisms:

1. **Tiered simulation.** Not everyone runs at full fidelity.
   **Foreground** (~8–12): full agent logic — anyone in an active storyline, an
   active grievance, or a championship picture. **Midground** (~20–30): cheap
   approximations. **Background** (everyone else): periodic batch updates.
   Wrestlers promote and demote between tiers as their state crosses
   thresholds. This solves cognitive load and performance with one mechanism.
2. **One Feed.** Every interruption arrives through a single ranked inbox. Never
   five parallel UIs.
3. **Delegation.** "You handle it" is always available, always resolves, and
   costs no attention. The player's to-do list is therefore never unbounded.
4. **Ignoring is a legal move.** Nothing blocks. The show airs regardless. If
   the player does nothing at all, the game plays itself and the world moves on
   without them — and that is a *meaningful* outcome, not a failure state.
5. **Aggregation.** Individual moods roll up into locker-room temperature and
   into named blocs — "the young talent", "the veterans", "the Fold" — so the
   player reasons about groups, not individuals.
6. **Surfacing rules.** Only what the GM would plausibly learn reaches the
   player. Everything else happens silently and arrives later as a consequence.
   This shrinks the feed *and* manufactures surprise.
7. **The rundown is the anchor.** One screen, always present, always the truth
   of the show. Everything else is an overlay on it.
8. **Attention scarcity is the design, not a failure.** You *cannot* handle
   everything, by construction. The game must communicate this clearly and early
   or players will feel they are playing badly when they are playing correctly.
9. **Directed pacing.** See §11.4 — a Show Director layer shapes when eligible
   incidents fire, guaranteeing a floor and enforcing a ceiling.

---

## 10. What makes this different from a booking simulator

| | Traditional booking sim (TEW, EWR, GM Mode) | **Gorilla Position** |
| --- | --- | --- |
| **Perspective** | Above the fiction. You are the author. | Inside the fiction. You are a character with an office. |
| **Reality model** | Shoot. Wrestling is scripted; drama is about the script. | Hard kayfabe. Wrestling is real; drama is about opportunity. |
| **Unit of play** | The calendar. Months of bookings. | The episode in progress. Minutes. |
| **The show itself** | You book, then read a results report. | You *live through it*, backstage, as it happens. |
| **Core resource** | Money and popularity. | Airtime, attention, goodwill. |
| **Wrestlers are** | Stat blocks with a morale value. | Agents with beliefs, memories, and wrong opinions. |
| **Information** | Ratings screens and numeric feedback. | Rumour, body language, and an unreliable dirt sheet. |
| **Your presence** | Irrelevant — you are everywhere. | Decisive — you are in exactly one room. |
| **Skill expression** | Optimising a card. | Triage under pressure, and the preparation that makes triage survivable. |
| **Failure** | Poor ratings. | A show that got away from you. |
| **Best moment** | A perfect month of booking. | Holding a show together when everything went wrong. |

Nearer relatives than TEW: *This Is the Police* (authority triage), *Crusader
Kings* (autonomous personalities with memory), *Papers, Please* (procedure under
a running clock), *RimWorld* (a storyteller shaping emergent chaos).

The one-sentence differentiator:

> **A booking simulator asks "what is the best card?" This game asks "the show
> is on the air and three people need you — who do you disappoint?"**

---

## 11. Design problems, contradictions, and proposed resolutions

The concept is strong. These are the places it will break if we don't decide now.

### 11.1 Real time versus deliberation

**The problem.** Real time creates pressure, but a single-player game with
free pause has no pressure at all — and a game *without* pause is stressful and
unfair, because the player is reading text.

**Resolution.** *Thinking is free; acting costs clock.* Deliberation is
unlimited; every action consumes show time. Pressure then comes from
**scarcity and simultaneity**, not reflexes: two things need you at once and
pausing does not create a third you. Ship two modes — **Live** (clock runs
during conversations, for tension) and **Director** (clock advances only on
action, for comfort) — with identical mechanics.

### 11.2 Kayfabe ambiguity

**The problem.** The concept mixes shoot and work language. "Wanting more
opportunities" is kayfabe; "refusing to cooperate with another wrestler" reads
shoot. Left unresolved, this poisons the tone and every wrestler motivation.

**Resolution.** Commit to hard kayfabe (§0), and enforce it as a vocabulary
rule across the entire product. Everything the concept wants survives the
translation; nothing is lost except confusion.

### 11.3 Emergence versus legibility

**The problem.** Systemic outcomes that the player cannot trace do not read as
emergent — they read as random, or as bugs. This is the number one failure mode
of emergent-narrative games.

**Resolution.** A **"Why?" affordance everywhere.** Every attitude change and
every incident carries an inspectable provenance chain. Plus the Chronicle,
which names arcs and writes them up. Legibility is not a UI nicety here; it is
the feature that makes the whole design work.

### 11.4 Emergence versus dramatic pacing

**The problem.** Pure simulation is lumpy. Some weeks produce nothing; some
produce eight crises in ten minutes. Neither is good television.

**Resolution.** A **Show Director** layer, in the RimWorld storyteller
tradition. It never *invents* events — every incident still originates from a
wrestler's genuine state — but it controls **when eligible incidents fire**:
spacing them, escalating across the episode, overlapping their tails without
stacking their peaks, guaranteeing at least one meaningful decision per show and
capping the maximum. Emergent games still need a director.

### 11.5 Wrestler autonomy versus player authority

**The problem.** If wrestlers can override the card, the player's plans are
meaningless. If they can't, the autonomy is decorative.

**Resolution.** Autonomy operates *within* the card; only the GM restructures
it. Wrestlers can bend the show — run long, refuse, attack, ad-lib — but
reshaping it is the player's exclusive verb. And crucially: **defiance is always
costly to the wrestler too, and they know it.** Someone going into business for
themselves is making a calculated sacrifice, not rolling on a table. Give the
player real counter-verbs (security, agents, warnings, contract clauses) so they
are never helpless — only never free.

### 11.6 The discipline trap

**The problem.** If punishment always makes wrestlers angrier, discipline is a
trap, players learn to never use it, and an entire system goes dead.

**Resolution.** **Discipline is a signal to the room, not a transaction with an
individual.** The target may resent it — but the locker room *reads* it, and a
GM who never disciplines anyone acquires the reputation "can be pushed", which
is far more expensive. Make discipline's primary effect social and its secondary
effect personal, and it becomes a real strategic tool with a real price.

### 11.7 The doom spiral

**The problem.** Systems with memory and grudges ratchet monotonically toward
everyone hating you. This is the most likely way this design fails in practice.

**Resolution.** Five counter-pressures, all required:
- **Decay** — ordinary grievances fade if not reinforced.
- **Repair verbs** — a genuine apology, a make-good, a kept promise, a favour, a
  spot given when it wasn't owed. Each with a real cost.
- **Positive compounding** — loyalty accrues exactly as grudges do, and buys
  forgiveness later.
- **Roster turnover** — people leave; new people arrive without history.
- **Losing is a state, not an ending.** Getting fired is a *chapter*: you take
  another show, and your reputation follows you there. Some of the best runs
  should start from a wreck.

### 11.8 "No perfect decision" versus player satisfaction

**The problem.** If every choice is a loss, players feel punished rather than
challenged, and stop investing. "There is never a right answer" and "I want to
feel skilled" are in direct tension.

**Resolution — and this is the most important item on the list.** Distinguish
*no perfect decision* from *no good decision*.

> **Skill lives in the week before the crisis, not in the crisis.**

There absolutely *are* excellent plays — but they are earned by **preparation**:
goodwill banked, promises kept, a correct read on someone's temperament, a
favour owed, a buffer minute protected, a friendship you cultivated three weeks
ago that now defuses a confrontation for free. The moment-to-moment choice is
genuinely a triage of bad options; the *reason one player survives it and
another doesn't* is everything they did beforehand. This preserves the
philosophy and gives mastery somewhere real to live.

### 11.9 Advertised matches versus live chaos

**The problem.** Executives punish undelivered advertised segments, and chaos
forces you to cut things. That's a squeeze the player cannot escape, which reads
as unfair rather than dramatic.

**Resolution.** **Delivery is not binary.** An advertised match that starts and
gets interrupted still happened — and can be *better* television than the match
as planned. Partial delivery counts partially. Add two outs: **pre-negotiation**
(warn the executive in advance and trade something for it) and the
**make-good** (deliver next week, with interest, at a cost).

### 11.10 The supernatural eating the game

**The problem.** Anomalies that break rules arbitrarily read as the game
cheating; anomalies with no teeth are just wrestlers in makeup.

**Resolution.** Three constraints, all in §4.1: the **Uncanny Budget** caps
manifestation; **ambiguity by default** keeps a mundane explanation available;
and anomalies act **through the belief and social systems** rather than by
overriding rules. Their power is over people, which is both mechanically clean
and dramatically correct.

### 11.11 The GM as an on-screen character

**The problem.** A kayfabe GM implies the GM appears on television — which is
an entire additional system (screen presence, popularity, alignment) and a
serious scope risk.

**Resolution.** Keep it, constrain it hard. A small verb set — make an
announcement, make a match, eject someone, appear at ringside — with its own
airtime budget and its own consequences. Do not build a GM-as-performer
simulation. The GM's on-screen appearances should feel like a resource spent,
not a career managed.

### 11.12 Where is the money?

**The problem.** Deliberately excluding the business sim removes a major axis of
long-term strategy.

**Resolution.** The economy exists but is **entirely mediated by the
executives**. Contract costs surface in negotiation. Signings come out of a
budget you are told about, not one you administer. Everything financial reaches
the player as a demand from a person, never as a spreadsheet. Pressure without
accountancy.

### 11.13 Session length

**The problem.** A two-hour show played near real time is a very long session,
and the weekly loop must be repeatable dozens of times.

**Resolution.** Variable compression with "advance to next decision" as the
default. Target 20–30 minutes for a full week, with the option to linger.
Compression is a comfort setting, not a difficulty setting.

### 11.14 Save-scumming

**The problem.** Consequence-driven emergent games are hollowed out by reloading
past bad outcomes — and this game is *made of* bad outcomes.

**Resolution.** A single rolling autosave per campaign by default, with an
explicit opt-out for players who want it. Support it with design rather than
enforcement: make bad outcomes *interesting* rather than merely punishing, so
reloading costs the player the good part.

### 11.15 Roster authenticity and IP

**The problem.** The archetypes here are recognisable, and recognisable is one
step from infringing.

**Resolution.** All characters are original creations occupying archetypal
*space* — the monster, the cult leader, the ageing veteran who runs long — with
original names, looks, histories and behaviours. Archetypes are not property;
specific characters are. Procedural world generation plus hand-authored
archetype templates gives every campaign a distinct roster and keeps the game
clear of anyone's likeness.

---

## 12. What to prototype first

Before any of this is built at scale, one vertical slice should prove the core
claim: **that a timing failure can produce a human consequence the player
understands and remembers.**

The minimum slice:

- One show, one broadcast window, a rundown of six segments.
- Six wrestlers, with three genuinely different personality configurations —
  enough that the same cut produces three different *channels* of response.
- One overrun. One forced cut. One resulting incident.
- The causal ledger, showing the chain.
- One executive, with one directive that conflicts with keeping the locker room
  happy.

If that slice makes a playtester say *"I shouldn't have cut Mercer"* — unprompted,
about a wrestler who did not exist a week ago — the design is proven and the
rest is scale. If it doesn't, no amount of additional systems will save it.

---

*All names, promotions and characters in this document are placeholder fiction
created for illustration.*
