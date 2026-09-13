# GM Progression — the upgrade tree

*A design document. No code. This describes a system to be built, and names the
existing systems it attaches to.*

---

## 1. Upgrade philosophy

### The thing we are building

This game already knows how to make you choose who to disappoint. The upgrade
tree's job is **not** to make that easier. Its job is to make the choice
*bigger* — more people in the room, more ways to answer them, more consequences
you can see coming and still have to walk into.

A GM at level 1 has one honest tool: they can go somewhere, and they can say
yes or no when they get there.

A GM at level 25 can post security in the hallway, force a match onto a
wrestler who refuses it, promise a title shot they intend to keep, hear about
a fight two rooms away, buy a live segment two more minutes, and tell head
office to grade them against a plan they wrote themselves.

They also have thirty wrestlers instead of fifteen, four championships instead
of three, three hours of television to fill instead of one, six live promises
outstanding, a main event scene that expects to be the main event scene, and a
locker room that has learned exactly what kind of GM they are and books their
own behaviour around it.

**The level 25 GM is not having an easier night. They are having a harder one
with better equipment.**

### The three tests

Every upgrade in this document had to pass all three, or it was rewritten.

**1. Does it appear as a verb?**
An upgrade the player can't *do* is not an upgrade. If you can't finish the
sentence "now I can ___", it's a stat and it doesn't belong on the board.

**2. Does it cost something the player will feel?**
Not points — points are the price of admission. The upgrade itself must carry a
cost inside the fiction. Posting security in a room makes the room quiet *and
blinds you to it*. Delegating rulings means somebody else's judgement goes on
your record. Knowing everything means you can no longer claim you didn't know.

**3. Would a player brag about using it?**
"I forced Kestrel into the main event and she went out there and worked half
speed to spite me, and the crowd could tell, and it cost me the grade, and I'd
do it again" is a story. "My morale decay is 12% slower" is not.

### The anti-pattern, stated plainly

We do not write these:

- +5% morale
- +10% obedience
- +5% match quality
- Wrestlers are 15% less upset when denied extra time

Numbers like these will exist *underneath* — `troubleFactor()` already scales
off `authorityValue()`, and some upgrades in here nudge such things as a side
effect. But the player is never sold a percentage. Compare:

> ❌ **Diplomatic** — Wrestlers are 15% less upset when denied extra time.

> ✅ **Make It Up To You** — When you deny a wrestler's request for additional
> time, you may offer them priority consideration next week instead. They may
> accept the compromise. The game records the commitment, and they will
> remember whether you honoured it.

The first is arithmetic the player has to trust. The second is a new button, a
new outcome, a new way to fail, and a new thing you have to remember on
Tuesday. It also makes the *next* upgrade possible: something has to exist for
"Your Word Is Good" to be built on top of.

### What upgrades are allowed to give you

Six categories. Every upgrade in this document is one of them.

| Category | What it does | Example |
|---|---|---|
| **Action** | A new thing you can do | Buy Me Two Minutes |
| **Information** | Something you can now see | Read The Grudge |
| **Authority** | Something you can now insist on | Because I Said So |
| **Booking** | A new shape of television | Battle Royal |
| **Handling** | A new way to answer a problem | Emergency Mediation |
| **Risk** | A new way to gamble | Overrun |

Note that **Information is not free power**. Half the information upgrades in
this tree are fallible, biased, or arrive too late to be comfortable. Knowing
that Ríos will refuse the booking doesn't book the show for you.

### The load-bearing rule

> **Upgrades expand the game. They do not remove the game's difficulty.**

Concretely, this means several upgrades in this document deliberately *add*
obligations:

- **The Building Is Mine** tells you about every incident anywhere. It also
  converts every incident you skip from `missed` (an accident) to `ignored` (a
  decision). You wanted to know. Now you're accountable.
- **The Main Event Scene** gives you a protected top tier. Everyone in it now
  expects to be in the main event, and dropping one of them out is an incident.
- **The Eye** shows you every prospect's ceiling. You now know exactly which of
  your wrestlers is never going to be a main-eventer, and so does the game —
  and they still want to know why they aren't being pushed.
- **Contract Talks** lets you buy a wrestler's cooperation with creative input.
  That wrestler can now refuse bookings with impunity, permanently.

---

## 2. GM levels and XP

### What XP is for

XP measures **whether you ran the building well**, not whether you produced
good television. A GM who books a five-star match and lets two wrestlers walk
out over it has had a bad week.

There are no star ratings in this game. The nearest thing is the executive
grade from `reviewShow()`, and it is **hard-capped at 15% of a typical week's
XP** for exactly the reason you'd expect: the moment grade dominates XP, the
optimal play becomes "book the two best workers every week and ignore
everyone else", which is the game we are specifically not making.

### Where XP comes from

**Rulings — the core loop.** Every incident you resolve pays. What you pay is
decided by `proportionality()`, which the game already computes:

| Ruling | XP | Note |
|---|---|---|
| Fair | 18 | the call fits the severity |
| Harsh | 12 | it worked, it cost you |
| Weak | 6 | you did something |
| Gave in | 4 | you did something, technically |
| Delayed | 3 | paid again when you actually deal with it |
| Ignored | 0 | — |
| Missed it | 0 | nobody learns from an empty hallway |

**Presence.** +6 on top of any ruling you made about something you *witnessed*
rather than heard about. This is the single most reliably repeatable XP source
in the game, and it is paid for standing in the right room, which is the whole
Tier 3 mechanic.

**Promises and commitments.**

| Event | XP |
|---|---|
| Kept a promise | 40 |
| Converted an opportunity into a booked match inside its shelf life | 25 |
| Delivered on a Number One Contender obligation on time | 35 |
| Blow-off: a feud thread that peaked and then cooled after a booked match | 45 |

**People.**

| Event | XP |
|---|---|
| A wrestler carrying a grudge returns to settled | 30 |
| A wrestler's first television match | 20 |
| A new tie forms between two wrestlers | 15 |
| A faction forms under your watch | 25 |
| A wrestler you signed from the pool wins a championship | 60 |

**The night itself.**

| Event | XP |
|---|---|
| Show ran on time | 20 |
| Window filled (no dead air) | 15 |
| Broad roster use | 20 |
| Every wrestler in the building laid eyes on you | 25 |
| No advertised match went unhonoured | 15 |
| Title change you booked | 20 |

**The grade — capped.**

| Grade | XP |
|---|---|
| A | 30 |
| B | 15 |
| C | 5 |
| D | 0 |

A strong week runs 220–280 XP. Thirty of that is the grade. **XP never goes
negative.** Failure costs you management trust, authority, and morale — the
systems that already punish you. Taking XP away as well would punish the same
mistake three times and teach the player to stop experimenting.

### The level table

`XP to next level = 120 + 45 × (current level − 1)`

| Level | To next | Cumulative | Roughly |
|---|---|---|---|
| 1 → 2 | 120 | 120 | week 1 |
| 5 → 6 | 300 | 1,020 | ~week 6 |
| 10 → 11 | 525 | 2,940 | ~week 15 |
| 15 → 16 | 750 | 5,700 | ~week 27 |
| 20 → 21 | 975 | 9,300 | ~week 44 |
| 25 → 26 | 1,200 | 13,740 | ~week 63 |
| 29 → 30 | 1,380 | 17,910 | ~week 80 |

Level 30 is the cap. At roughly 230 XP a week it lands around **week 80** —
two full seasons and change. A player who runs a loose building and misses half
their incidents will take three or four seasons to get there, which is correct:
levelling is a measure of how well you've been doing the job, not how long
you've been in the chair.

### Reputation and trust as separate gates

Three different things gate upgrades, and they are deliberately not the same
number.

**GM Level** — competence and time served. Purely earned.

**Management Trust** — `state.network.trust`, the number `awardTrust()` already
moves. Named bands:

| Trust | Band | Existing meaning |
|---|---|---|
| 0 | Provisional | the hour |
| 6 | Noted | 75 minutes |
| 10 | — | second championship slot |
| 15 | Fine | 90 minutes |
| 22 | Solid | third championship slot |
| 27 | Good | 105 minutes |
| 34 | Strong | — |
| 42 | Trusted | 120 minutes |
| 58 | Backed | *new* |
| 75 | Untouchable | *new* |

**Standing** — `bossView()`, what head office thinks of how you run the
*building* as opposed to how you run the *show*. Bands already exist: In Hand
(72+), Fine (56), Plain (40), Warned (24), Bad (0). The Authority branch gates
on Standing, because a GM head office doesn't believe is in charge doesn't get
to fire people.

A GM can be Trusted and Bad simultaneously: great television out of a building
in chaos. That GM gets the three-hour show and cannot get Dismissal. Good.

### Auto-unlocks (free, no point spent)

Small quality-of-life the game shouldn't charge for. These arrive on their own.

| Level | Unlock |
|---|---|
| 2 | Advertised matches auto-populate next week's card |
| 4 | The tree screen shows locked branches' contents, greyed |
| 5 | The journal keeps two weeks instead of one |
| 9 | The clock strip shows which rooms are occupied |
| 13 | **One free respec**, once per save (see §3) |
| 18 | Security resets at the midpoint of the show |
| 20 | Second Doctrine pick unlocks (see §3) |
| 26 | The post-show report shows the full XP breakdown |

---

## 3. The upgrade-point economy

### Income

| Source | Points |
|---|---|
| Starting allocation | 3 |
| Every level, 2 → 30 | 2 each (58 total) |
| Milestone bonus at 5, 10, 15, 20, 25, 30 | 3 each (18 total) |
| Achievement awards (see below) | ~18 total |
| **Total available by level 30** | **≈ 97** |

**Achievements** — one-off, missable, and deliberately weighted toward the
parts of the job that aren't fun:

| Achievement | Points |
|---|---|
| Ten consecutive weeks with no walkouts | 3 |
| Reinstate an indefinitely suspended wrestler who then goes on a title run | 3 |
| Keep ten promises without breaking one | 4 |
| Every wrestler on the roster appears on television in a single month | 2 |
| Resolve a five-deep reaction chain without security | 3 |
| Book a blow-off that cools a feud at peak heat | 3 |

### Cost

| Cost | Tier |
|---|---|
| 1 | Foundation — small verbs, cheap information |
| 2 | Standard — most of the tree |
| 3 | Major — needs a real commitment |
| 4 | Capstone |
| 5 | Grand capstone |

**Major upgrades cost multiple points and that is the point.** A 5-point
capstone at level 23 is two and a half levels of income. You are not going to
casually pick up two of those.

### The arithmetic that makes builds real

The full tree in this document contains **113 upgrades costing 269 points** —
15 of them capstones, and no branch smaller than 15.

You will earn about **97**.

**You will own roughly 36% of the tree at the level cap.** Not most of it. Not
eventually all of it. About two-fifths, chosen deliberately, in a shape another
player would not have chosen.

### Three hard constraints on shape

**1. The capstone cap.** There are 15 capstones. **You may hold at most 4, and
at most 2 from any one branch.** They are not refundable and the cap does not
rise. Your four capstones *are* your GM.

**2. Doctrine.** At **level 6** you pick one of three Doctrines, permanently.
At **level 20** you pick a second, which must be different. The third is never
available.

| Doctrine | Grants | Locks |
|---|---|---|
| **The Hand** | Authority's *Because I Said So*, *Make An Example*, *Dismissal*, *Final Say* | Locker Room's *Apology Brokered*, *They'd Run Through A Wall* |
| **The Ear** | Locker Room's *Veteran's Word*, *Apology Brokered*, *Nobody Quits On Me*, *They'd Run Through A Wall* | Authority's *Dismissal*, *Final Say* |
| **The Desk** | Corporate's *Set The Priorities*, *Talent Relations Contact*, *Creative Control*; Scouting's *The Feeder* | Booking's *Book The Long Game*; Negotiation's *The Handshake Deal* |

Doctrine-locked upgrades appear on the board **struck through**, permanently.
The player should be able to see what they gave up. That is the feature.

**3. Mutual exclusions within branches.** Six pairs across the tree where two
upgrades represent incompatible philosophies. Taking one greys the other for
the life of the save. They are listed with their upgrades and collected in §9.

### The respec

**One free reset, once per save, unlocked at level 13.** It refunds every
spent point and clears every non-capstone upgrade. It does **not** refund
capstones, and it does **not** clear your Doctrine.

One reset is enough to fix a build you misunderstood at level 4. It is not
enough to shop around. After it's used, you live with your GM.

### What points cannot buy

Championship slots and broadcast length are *offers*, not automatic promotions.
Right now `awardTrust()` promotes you the instant your trust crosses a
threshold. Under this system, crossing the threshold makes the upgrade
**available**; you still have to spend a point on it. Head office offering you
ninety minutes and you *taking* ninety minutes are two different decisions, and
the second one has an opportunity cost.

---
## 4. The seven branches

| Branch | The question it answers | Colour | Upgrades | Capstones | New system? |
|---|---|---|---|---|---|
| **Authority** | Will they do what you say? | `--tally` red | 16 | 2 | no — extends `gmRecord` / `authorityValue()` |
| **Locker Room** | Do they want to work for you? | `--good` green | 15 | 2 | no — extends memory, threads, ties |
| **Booking** | What can you put on television? | `--cool` blue | 19 | 2 | no — **gates things currently ungated** |
| **Production / Gorilla** | Can you run the show live? | `--amber` amber | 15 | 2 | partly — needs live segment control |
| **Corporate** | How much rope do they give you? | steel `#8aa0bd` | 17 | 3 | no — extends `TIERS` / `SLOT_THRESHOLDS` |
| **Scouting** | Who is out there, and who is in your building? | teal `#3fb8b0` | 16 | 2 | **yes — entirely new** |
| **Negotiation** | What do they want, and what will you trade? | rose `#c2679a` | 15 | 2 | **yes — entirely new** |
| | | | **113** | **15** | |

Three notes before the lists.

**Booking gates things that already work.** Multi-person matches, battle
royals, stipulations and tag-team creation are all in the game today with no
restriction. Turning them into unlocks is the right design — a level 1 GM with
one hour of television should be booking singles matches and learning who
these people are — but it is a **removal** from existing saves. Any save
already past week 20 should be granted every Booking upgrade at or below its
GM level for free on migration, and the release notes should say so.

**Scouting does not exist.** There is no talent pool, no free agency, no
developmental, no notion of a wrestler you haven't got yet. The branch
introduces all of it. Scouting spends **weeks**, not show minutes — it happens
between shows, on the calendar, in the space the game currently skips through.

**Negotiation does not exist either.** Wrestlers currently make demands only
inside incidents, as something you react to. This branch turns demands into a
standing channel: a queue of requests with deadlines, arriving whether or not
anything has gone wrong. It is the peacetime version of the incident system,
and it is where most of the "who do I disappoint" pressure will live once the
building is quiet.

Each entry below reads:

> **Name** — the hook
> *Description* — what it is, in the fiction
> **Effect:** exactly what changes
> **Cost** · **Requires** · **Level** · **Trust** · *(Excludes)*

---

## 5–8. The branches in full

# 🔴 AUTHORITY

*Will they do what you say?*

The record you build with `gmRecord` is already a character sheet: harsh, weak,
fair, ignored, booked, gave in, delayed, missed. This branch is about spending
that record and about the arithmetic of `troubleFactor()` — a building that
believes you're in charge is a quieter building, and a quieter building is one
where you can spend your minutes on something other than firefighting.

The Authority GM's problem is that authority is not affection. Everything in
this branch that makes them obey makes them resent, and the branch's late game
is about finding actions that are hard without being cruel.

### Foundation

**Line In The Sand** — declare a rule and be held to it
*Before doors, you announce one standing rule for the night: nobody goes near
Gorilla, nobody touches the champion, no one leaves before the show ends.*
**Effect:** New pre-show action. Any incident that breaks a declared rule is
raised one severity step. Ruling harshly on a declared breach is recorded as
`fair` rather than `harsh`. Rules you declare and then fail to enforce are
recorded as `weak` at double weight.
**Cost 1** · Requires — · Level 1 · Trust — · **Excludes Cold Open** *(Production)*

**Send Word** — rule on a room you are not standing in
*You give the ruling to a runner. It gets there. Something is lost on the way.*
**Effect:** New action, 1 minute. Issue any ruling to an incident in a room you
can't reach in time. The ruling lands one proportionality step weaker (fair
becomes weak, harsh becomes fair), you do not witness the reaction, and you get
no presence XP for it.
**Cost 1** · Requires — · Level 2 · Trust —

**Hold That Thought** — make "later" mean something
*"Not now" is currently a way of losing an incident. This makes it an
appointment.*
**Effect:** *Deal with it later* now asks you to name a room and a minute. The
incident resurfaces there, at full severity, and both parties are present.
Missing your own appointment records `delayed` twice.
**Cost 2** · Requires Line In The Sand · Level 3 · Trust —

**Paper Trail** — warnings that accumulate
*Every formal warning goes in a file, and the file is visible to you and to
them.*
**Effect:** Formal warnings are now counted per wrestler and shown on their
card. A second warning unlocks the suspension responses one step earlier for
that wrestler. A third makes **Dismissal** available against them, if you have
it.
**Cost 1** · Requires — · Level 4 · Trust — · **Excludes The Handshake Deal** *(Negotiation)*

**Read The Room** — see the call before you make it
*You've been doing this long enough to know how a ruling will land. Usually.*
**Effect:** Response buttons show the likely locker-room reading (fair / harsh
/ weak) before you commit. **The reading is wrong about a fifth of the time,
and wrong more often** for wrestlers whose traits you have never had revealed
and in rooms where you have spent little time. It is a hint, not a preview.
**Cost 2** · Requires — · Level 4 · Trust —

### Working

**Because I Said So** — force it through
*They said no. You have told them it wasn't a question.*
**Effect:** Once per show, override a refusal to wrestle or to appear. The
wrestler goes out. Consequences: a permanent grudge memory at heavy weight, and
if they lose the match they were forced into, the grudge doubles. Using it a
second time on the same wrestler inside a month puts them at real risk of
walking out of the building. Recorded as `harsh`.
**Cost 3** · Requires Paper Trail · Level 6 · Trust — · **Standing: Plain or better** · *Doctrine: The Hand*

**Make An Example** — rule in front of everyone
*You hold the ruling until you can get the room together, and then you make it
where they can all see.*
**Effect:** New modifier on any ruling. Costs 4 minutes to gather. The ruling's
effect on locker-room opinion applies to **every wrestler present**, not just
the parties — in both directions. A fair call in front of twelve people is the
strongest authority move in the game. A harsh one in front of twelve people is
the strongest resentment move in the game.
**Cost 2** · Requires Line In The Sand · Level 7 · Trust — · *Doctrine: The Hand*

**Security On Retainer** — a third body, and a post
*You get one more, and you can leave one somewhere.*
**Effect:** `SECURITY_STAFF` 2 → 3. New pre-show action: post one guard at a
location for the night. Incidents originating in that room resolve one severity
step lower **before you ever hear about them** — and you do not hear about
them. The room goes quiet and goes dark.
**Cost 2** · Requires — · Level 8 · Trust — · **Excludes Locker Room Sources** *(Locker Room)*

**Suspension With Cause** — a way back in
*The suspension holds until they do the thing.*
**Effect:** Any suspension can carry one condition: apologise to a named
wrestler, work a dark match, drop a title. The wrestler returns when the
condition is met rather than when the clock runs out. Conditions can be
refused, and a refused condition converts the suspension to indefinite. The
locker room reads a conditional suspension as `fair` where a flat one of the
same length reads `harsh`.
**Cost 2** · Requires Paper Trail · Level 9 · Trust —

**The Open Door** — be reachable
*Anyone can find you, and they will.*
**Effect:** Wrestlers storming into your office arrive with their demand
legible — you see what they want and what they'd settle for before you answer.
Additionally, any wrestler anywhere in the building can choose to come to you
instead of erupting where they stand, which converts some incidents into
conversations. The cost: your office is never empty, and time spent there is
time not spent anywhere else.
**Cost 2** · Requires — · Level 10 · Trust — · **Excludes Chain Of Command**

**Chain Of Command** — delegate the small stuff
*You appoint someone. They handle what you can't get to.*
**Effect:** Appoint a locker-room leader. Minor and moderate incidents in rooms
you are not in are ruled on by them automatically. **They rule the way they
would, not the way you would** — a hot-headed deputy rules harsh, a peacemaker
rules weak — and every one of those rulings goes on **your** record. You can
change deputy once a month; the outgoing one takes it personally.
**Cost 3** · Requires — · Level 10 · Trust — · **Excludes The Open Door**

### Established

**Reinstatement Terms** — bring them back on your terms
*Indefinite doesn't have to mean forever, but it does have to mean something.*
**Effect:** An indefinitely suspended wrestler can be reinstated with a
negotiated term attached (a loss to a named opponent, a period without
television, a public apology). Reinstating without terms is recorded as
`gaveIn`; reinstating with them is recorded as `fair`.
**Cost 2** · Requires Suspension With Cause · Level 13 · Trust —

**The Long Memory** — cite the record
*"This is the third time."*
**Effect:** When ruling, you may cite up to two past incidents involving the
same wrestler. Citing raises the effective severity of the current incident,
which unlocks harsher responses without those responses reading as
disproportionate. Citing something the locker room considers settled — an
incident already ruled on fairly, or older than about ten weeks — backfires and
records `harsh`.
**Cost 3** · Requires Read The Room · Level 15 · Trust —

**Dismissal** — the last one
*They are off the roster.*
**Effect:** Release a wrestler permanently. Requires three formal warnings on
their file, or one critical incident. The roster does not forget: dismissal
files a heavy memory with every wrestler who was close to them, and the
executive review notes it for four weeks. Wrestlers you dismiss can turn up on
a rival promotion's roster later, if Scouting is developed.
**Cost 3** · Requires Paper Trail, Suspension With Cause · Level 17 · **Trust: Good** · **Standing: Fine or better** · *Doctrine: The Hand*

### 🏆 Capstones

**Final Say** — nobody walks out on you
*They got in the car. You told them to get out of the car.*
**Effect:** Once per month, a wrestler who has walked out of the building can
be recalled. They come back, and they are available for one segment tonight,
and they will do what you booked. It is recorded as `harsh` **whether or not
the segment goes well**, and the wrestler's grudge against you never fully
fades — `coolGrudges()` does not touch it. A recalled wrestler who is recalled
again inside a season leaves the promotion.
**Cost 5** · Requires Because I Said So, The Long Memory · Level 20 · **Standing: In Hand** · *Doctrine: The Hand*

**The Building Is Mine** — you hear about everything
*There is no longer such a thing as something happening without you knowing.*
**Effect:** Every incident anywhere in the building is reported to you the
moment it starts, with location and parties, regardless of where you are.
**The cost is accountability:** an incident you were told about and did not
attend is now recorded as `ignored`, not `missed`. `missed` effectively stops
existing for you. You wanted to know.
**Cost 5** · Requires Chain Of Command **or** The Open Door · Level 24 · **Trust: Trusted**

---
# 🟢 LOCKER ROOM

*Do they want to work for you?*

Morale in this game is derived, not stored — a wrestler's mood is the sum of
what they remember, faded by time and sharpened by vindictiveness. That means
the locker room is not a bar to be filled. It is a set of specific grievances
held by specific people about specific things you did, and this branch is about
being able to **see them, name them, and address them individually**.

The Locker Room GM's problem is that being liked is not the same as being
obeyed, and that every conversation costs minutes they could have spent
somewhere else. A players' GM runs out of clock.

### Foundation

**Know Your Locker Room** — read the room, one person at a time
*You know what's eating them.*
**Effect:** Every wrestler's card gains a line naming their strongest current
memory in plain words — "still angry about the Kestrel finish", "hasn't
forgotten you backed him against Vance." Demeanour, not digits: no number, no
bar. Memories weaker than a threshold don't show, so a settled wrestler shows
nothing, which is itself information.
**Cost 1** · Requires — · Level 1 · Trust —

**Open Door Hours** — five minutes before doors
*You sit down. Whoever needs you, comes.*
**Effect:** New pre-show action costing 5 minutes off the top. Up to two
wrestlers with live grievances present them as conversations rather than
erupting later in the night. Which two is decided by grievance weight, not by
you — you don't get to pick who walks in.
**Cost 1** · Requires — · Level 2 · Trust —

**Read The Grudge** — what it's actually about
*You know they're angry. Now you know why.*
**Effect:** Grudges shown on a wrestler's card name their **source** and
**target**: which of the seven memory sources it came from (opportunity,
airtime, result, title, gm, ally, peer) and who it's aimed at. A grudge aimed
at another wrestler and a grudge aimed at you look identical without this.
**Cost 2** · Requires Know Your Locker Room · Level 3 · Trust —

**Private Meeting** — somewhere that isn't your office
*Not across a desk. Catering, the parking lot, wherever they'll actually talk.*
**Effect:** New action, 4 minutes, available in any room. The wrestler states
what they actually want, in one sentence, honestly — which is not always what
they've been complaining about. Available once per wrestler per week. A meeting
held in your office instead gets you the complaint, not the want.
**Cost 2** · Requires — · Level 4 · Trust —

**Promise Them Something** — put it on the record
*"Next week." You mean it when you say it.*
**Effect:** New response, available in most conversations and most incidents.
Record a specific commitment: a match, an opponent, a title shot, a partner, a
minimum of airtime, a night off. The game tracks it with a deadline. Keeping it
files a strong positive memory and pays 40 XP; letting it lapse files a memory
heavier than the one you would have got for simply refusing in the first place.
**Promising nothing is safer than promising badly.**
**Cost 2** · Requires — · Level 5 · Trust —

### Working

**The Pairing** — see how two people actually get on
*You can tell who's tight and who's tolerating each other.*
**Effect:** Select any two wrestlers to see their relationship in words: how
often they've worked, whether they've teamed, whether either owes the other,
and whether the warmth runs both ways. This is the information the tag-team
gates in the Booking branch are checked against — without it you're guessing at
whether a team is legal.
**Cost 1** · Requires Know Your Locker Room · Level 6 · Trust —

**Locker Room Sources** — you hear things
*Somebody always tells you.*
**Effect:** Incidents in rooms **adjacent** to yours are reported to you as
they start, with parties named but not detail. You still have to walk there.
This is the difference between arriving during and arriving after.
**Cost 2** · Requires — · Level 7 · Trust — · **Excludes Security On Retainer** *(Authority)*

**Emergency Mediation** — mediate without both of them
*One of them is in the medical room and one of them is in the car park. You
can still fix this.*
**Effect:** *Bring them both in* loses its `needsTwo` requirement. Mediating
with one party present costs the same minutes and lands at reduced strength —
the absent party accepts the outcome but files a small memory about not having
been asked. Mediating with **neither** present is possible in an emergency and
holds only until the end of the night.
**Cost 3** · Requires Private Meeting · Level 8 · Trust —

**Veteran's Word** — send someone who isn't you
*You ask the guy everyone respects to go and have a word.*
**Effect:** New action, 1 minute. Ask a high-standing veteran to handle an
incident on your behalf. They may refuse — the more it costs them
socially, the more likely they refuse. If they do it, it resolves as `fair`,
you spend no walk, and **they are now owed a favour by you**, which will be
called in as a request you'd rather not grant.
**Cost 2** · Requires The Pairing · Level 10 · Trust — · *Doctrine: The Ear*

**Cool It Down** — a night off that isn't a punishment
*"Sit this one out. Not as a suspension. Go home, come back Tuesday."*
**Effect:** One wrestler per week can be stood down **with their consent** —
they are asked, and a wrestler in a hot streak or chasing a title will say no.
A consented stand-down files no negative memory and lets grudges cool at
roughly twice the normal rate. It costs you a body on the card.
**Cost 2** · Requires Private Meeting · Level 11 · Trust —

### Established

**Apology Brokered** — make them shake hands
*You get them in a room and you don't let either of them leave until it's
done.*
**Effect:** New action against a live feud thread, 6 minutes, both parties
required. On success the thread's heat drops sharply and both file a positive
memory about you. **On failure it is public** — the refusing party's grudge
against the other hardens permanently, and every witness sees the GM's
authority publicly declined. Success chance reads off both wrestlers' traits
and the thread's peak heat; a thread at feud level will usually refuse.
**Cost 3** · Requires Emergency Mediation · Level 13 · Trust — · *Doctrine: The Ear*

**Faction Summit** — the whole group at once
*All four of them, in one room, at the same time.*
**Effect:** New action, 8 minutes. Address an entire faction as a unit: hear
their collective grievance, and make one ruling that lands on all of them. A
faction handled as a faction responds far better than four wrestlers handled
individually. A faction ruled against as a unit responds far worse.
**Cost 3** · Requires The Pairing · Level 15 · Trust —

**Speak For Them** — a wrestler can argue somebody else's case
*"I'm here about Ríos."*
**Effect:** In any mediation or dispute, a wrestler with a tie to one of the
parties may attend in their place. Their argument carries the weight of their
own standing, not the absent party's. This lets you resolve incidents involving
wrestlers who refuse to be in the same room as you — and it means a popular
wrestler can start speaking for people you would rather deal with directly.
**Cost 2** · Requires Emergency Mediation · Level 16 · Trust —

### 🏆 Capstones

**Nobody Quits On Me** — they come to you first
*Nobody gets in a car without knocking on your door.*
**Effect:** A wrestler about to walk out of the building comes to your office
first and tells you they're leaving. You get one conversation. **The conditions
are real:** you must be in your office or able to reach it inside the minutes
they'll wait, and the conversation costs 5 minutes you may not have during a
live show. If you're at Gorilla with nine minutes of television left, they will
wait, and then they will go.
**Cost 4** · Requires Private Meeting, Emergency Mediation · Level 19 · Trust — · *Doctrine: The Ear*

**They'd Run Through A Wall** — call in everything at once
*You ask the room for a favour. The whole room.*
**Effect:** Once per **season**. Every bookable wrestler accepts their booking
this week without refusal, without negotiation, regardless of grudge, opponent
or result. Nobody says no.
**The cost is the mechanic:** every wrestler who complied files a debt against
*you*. For the following four weeks, incoming requests arrive at heavier
weight, refusals of those requests land as `weak` rather than neutral, and any
promise you break in that window costs double. **You have spent the locker
room's goodwill in one night and you will spend a month paying it back.**
**Cost 5** · Requires Apology Brokered, Faction Summit · Level 23 · Trust — · *Doctrine: The Ear*

---

# 🔵 BOOKING

*What can you put on television?*

The largest branch, and the one that most obviously answers "what can I now
do?" It is also the branch that takes things away from the current build:
multi-person matches, battle royals, stipulations and tag teams are all
unrestricted today.

The design case for gating them is that **a match shape is a tool for solving a
booking problem**, and the game is better when you acquire those tools one at a
time and learn what each is for. The most important thing a new GM can learn is
the multi-way fall rule — in a triple threat only one side takes the loss, so
booking somebody into a multi-way is how you *use* them without *beating* them.
That is a genuine insight, and it lands much harder as an unlock at level 2
than as an option that was always in the dropdown.

### The tag-team ladder

Explicitly a progression that relaxes over time, exactly as specified:

| Unlock | Who you may team | Level |
|---|---|---|
| **Tag Team Wrestling** | closeness ≥ 10 (a real relationship) | 1 |
| **Working Relationship** | closeness ≥ 5, warmth both ways | 5 |
| **Just Get Along** | any pair with positive warmth either way | 9 |
| **Forced Partnership** | any two, regardless — with consequences | 13 |
| *(Forced Partnership, capstone-adjacent use)* | including active enemies | 13 |

Forcing an incompatible team never stops being risky. Two wrestlers with a live
feud thread who are booked as partners will miscommunicate, argue on camera,
and have a meaningful chance of the match ending in one walking out on the
other — which is, of course, a story, and one of the better ones the game can
tell.

### Foundation

**Tag Team Wrestling** — two on two
*Two people who trust each other, against two more.*
**Effect:** Unlocks `sides: [2,2]`. Both members of a side must have closeness
≥ 10. Teaming builds `teamed` on the relationship, which is the fastest legal
route to a tie forming.
**Cost 1** · Requires — · Level 1 · Trust —

**Triple Threat** — three sides, one fall
*Somebody has to lose. It doesn't have to be either of the other two.*
**Effect:** Unlocks `sides: [1,1,1]`. Introduces the fall rule: `decideFall()`
picks which side eats the loss, and the third side records no defeat at all.
The tutorial text should say this out loud.
**Cost 1** · Requires — · Level 2 · Trust —

**Stipulation: Submission Match** — a finish with no count
*No pinfalls. It ends when somebody quits.*
**Effect:** Unlocks the Submission match type (min 10 minutes). Increases the
chance of the *submission held too long* post-match outcome, which is one of
the game's best incident generators.
**Cost 1** · Requires — · Level 3 · Trust —

**Fatal Four-Way** — four sides
**Effect:** Unlocks `sides: [1,1,1,1]`. Three of four wrestlers take no loss.
**Cost 2** · Requires Triple Threat · Level 4 · Trust —

**Working Relationship** — relax the tag gate
**Effect:** Tag teams may be formed between wrestlers with closeness ≥ 5 and
warmth in both directions.
**Cost 1** · Requires Tag Team Wrestling · Level 5 · Trust —

### Working

**Six-Person Tag** — three a side, and four
**Effect:** Unlocks `sides: [3,3]` and `[4,4]`, and uneven multi-man sides.
Six- and eight-person tags are the cheapest way to get bodies on television
inside a short window, which makes them the roster-use answer for a GM stuck on
the hour.
**Cost 2** · Requires Working Relationship · Level 6 · Trust —

**Stipulation: Hardcore & Ladder** — weapons and height
**Effect:** Unlocks Hardcore (min 8) and Ladder (min 12). Both raise injury
chance meaningfully. A wrestler injured in a stipulation you chose files a
memory about it.
**Cost 2** · Requires Stipulation: Submission · Level 7 · Trust —

**Number One Contender** — a match that creates a debt
*The winner gets a title shot. You have now told the audience that.*
**Effect:** Any match can be designated a number one contender match for a
named championship. The winner is **owed a title shot inside four weeks**, and
the game tracks it. Delivering on time pays 35 XP. Letting it lapse is a
breach: the executive review counts it, the contender files a heavy
`opportunity` memory, and the championship's credibility takes a visible hit
that persists.
**Cost 2** · Requires — · Level 8 · Trust —

**Just Get Along** — relax the tag gate again
**Effect:** Tag teams may be formed between any two wrestlers with positive
warmth in at least one direction.
**Cost 1** · Requires Working Relationship · Level 9 · Trust —

**The Scramble** — five, six, seven, eight ways
**Effect:** Unlocks `sides` up to `MAX_SIDES = 8` for singles-per-side
arrangements, and mixed arrangements up to 8 sides.
**Cost 2** · Requires Fatal Four-Way · Level 10 · Trust —

**Open Challenge** — book a slot without an opponent
*"Anybody in the back."*
**Effect:** Book a segment with one named wrestler and an empty opposite side.
Who answers is decided at the moment of the segment, weighted by who has a live
grievance with them, who is chasing a title they hold, who has been unused for
weeks, and who is simply in the building. You do not choose. **Nobody answering
is a possible outcome**, and it is embarrassing.
**Cost 2** · Requires Number One Contender · Level 11 · Trust —

**Advertise It** — announce it in advance
*It's in the graphics. It's happening.*
**Effect:** Announce a match one to four weeks ahead. Advertised matches
generate anticipation the executive review counts positively, and the audience
notices. An advertised match that does not happen is a **breach**, which the
existing `reviewShow()` already punishes hard. Advertising a match involving a
wrestler with an unresolved grudge against their announced opponent is a
gamble.
**Cost 2** · Requires — · Level 12 · Trust —

### Established

**Forced Partnership** — team anybody
*They don't have to like it.*
**Effect:** Removes the relationship gate on tag teams entirely. Partners with
a live feud thread will visibly fail to cooperate; a partnership between active
enemies has a real chance of one abandoning the other mid-match, which files
the `abandoned` thread event (weight +6 — one of the heaviest in the game) and
creates an opportunity.
**Cost 3** · Requires Just Get Along · Level 13 · Trust —

**Stipulation: Cage & Last Man Standing** — no escape and no count-out
**Effect:** Unlocks Steel Cage (min 12) and Last Man Standing (min 14). A cage
match suppresses run-ins and saves entirely, which means it is the one match
type where a beatdown finishes what it started.
**Cost 2** · Requires Stipulation: Hardcore & Ladder · Level 14 · Trust —

**Battle Royal** — everybody
*No limit.*
**Effect:** Unlocks the open-field Battle Royal shape. No cap on participants.
Only the winner records a win; **nobody records a loss**, which makes it the
single best tool in the game for putting the entire roster on television in one
segment without damaging anyone. It also, at high chaos, generates more
post-match incidents than any other match type.
**Cost 3** · Requires The Scramble · Level 15 · Trust —

**Protect The Fall** — choose who loses
*You decide who eats it. Everyone else goes home whole.*
**Effect:** In any match with three or more sides, you nominate which side
takes the fall, overriding `decideFall()`'s weighted draw. The nominated side's
wrestlers know they were chosen — a wrestler protected too often stops
believing their wins mean anything, and a wrestler nominated three times in six
weeks files an `opportunity` grudge whether or not they lost anything on paper.
**Cost 3** · Requires Fatal Four-Way · Level 16 · Trust —

**Iron Man Match** — the long one
**Effect:** Unlocks Iron Man (min 25 minutes). Effectively impossible below a
90-minute broadcast, which is why it sits here.
**Cost 3** · Requires Stipulation: Cage & Last Man Standing · Level 18 · **Trust: Fine** *(90-minute broadcast required in practice)*

### 🏆 Capstones

**The Main Event Scene** — designate a top tier
*These four are the show. Everybody knows it, including them.*
**Effect:** Nominate four to six wrestlers as the main event scene. They gain
automatic contendership logic (title shots route through them), the executive
review weights their usage heavily, and the audience treats their matches as
main events regardless of card position.
**The cost:** everyone in the scene now expects to be in the main event every
week. Being on the card but not in the main event files a small `opportunity`
memory each time. **Dropping someone out of the scene is a critical incident**,
guaranteed, with the wrestler and with everyone tied to them. You have created
a hierarchy, and hierarchies have politics.
**Cost 4** · Requires Number One Contender, Advertise It · Level 20 · **Trust: Solid**

**Book The Long Game** — plan an arc and be held to it
*Eight weeks. You've written down what happens in week eight.*
**Effect:** Plot a multi-week storyline: two to four participants, three to
eight weeks, with checkpoints you define (a betrayal in week 3, a contender
match in week 5, a blow-off in week 8). The game shows the arc on the calendar
and **the executive review grades you against your own plan** — hitting
checkpoints pays large XP and trust, missing them costs more than never having
planned. Wrestlers in a plotted arc who are booked outside it notice.
An arc cannot be abandoned; it can only be failed.
**Cost 5** · Requires The Main Event Scene · Level 24 · **Trust: Strong** · *Locked by Doctrine: The Desk*

---
# 🟠 PRODUCTION / GORILLA

*Can you run the show live?*

The clock is already the game's hardest constraint. Thinking is free; acting
costs minutes; the show goes out whether or not you were ready. This branch is
about the twenty minutes of a show where everything is happening at once and
you are standing behind a curtain making decisions in seconds.

Almost everything here is a **live** action — available only while a segment is
on the air. That makes Production the branch that changes moment-to-moment play
the most, and the one that punishes a distracted GM hardest: a live action you
weren't in position to take is a live action you didn't have.

The Production GM's problem is that every minute they buy comes from somebody
else's segment, and everybody knows it.

### Foundation

**Stopwatch** — see the overrun as it happens
*A running number instead of a feeling.*
**Effect:** The clock strip shows live overrun/underrun against the planned
rundown, per segment and cumulative, rather than only at the end.
**Cost 1** · Requires — · Level 1 · Trust —

**Go Home** — send a message to the ring
*Wrap it up. They hear you.*
**Effect:** New live action, free. Signal the wrestlers in a live match to go
to the finish. The match ends at the next natural point, up to 3 minutes early.
The wrestlers know they were cut short and file a small `airtime` memory —
smaller than being cut off outright, larger than nothing.
**Cost 1** · Requires Stopwatch · Level 2 · Trust —

**Buy Me Two Minutes** — stretch a live segment
*Something's gone wrong somewhere else. Keep them out there.*
**Effect:** New live action. Extend the current segment by up to 2 minutes. The
extra time comes off the back of the show, not out of thin air — you will be
2 minutes short somewhere. Wrestlers asked to stretch file a small **positive**
memory (they were trusted with the time) unless it happens to them twice in one
night.
**Cost 2** · Requires Stopwatch · Level 4 · Trust —

**Hard Out** — cut it dead
*Now. Bell. Go.*
**Effect:** New live action. End the current segment immediately, wherever it
is. Recovers all remaining planned minutes. The wrestlers involved file a
significant `airtime` grudge, and a match cut before its finish produces **no
clean result** — no win is recorded for anyone, which has consequences for
contendership and for anyone who was supposed to be going over.
**Cost 2** · Requires Go Home · Level 5 · Trust —

**Cold Open** — start in the middle
*No pre-show. You're already going.*
**Effect:** Open the broadcast with a segment already in progress. Saves 2
minutes of the window. The cost is your pre-show block — no Open Door Hours, no
Line In The Sand, no walking the building before the light goes on. You start
the night blind.
**Cost 1** · Requires — · Level 6 · Trust — · **Excludes Line In The Sand** *(Authority)*

### Working

**Commercial Break** — a gap in the broadcast
*Ninety seconds where the camera isn't looking.*
**Effect:** Insert a commercial break, recovering 2 minutes of window. Anything
that happens during the break — a run-in, a beatdown, an arrival — is
**witnessed only by people in the building, not by the audience**. This is the
mechanically interesting part: you can stage something the audience did not
see, which the locker room knows about and the executive review does not.
**Cost 2** · Requires Stopwatch · Level 7 · Trust —

**The Hard Camera** — choose what they see
*There are four cameras. You pick one.*
**Effect:** When an incident occurs during a live segment, choose whether it
goes out on air. On air: the audience reacts, the executive review counts it,
and the thread's heat spreads to the whole roster. Off air: the incident
happens, the locker room knows, and the show carries on as if it didn't.
**Cost 2** · Requires Commercial Break · Level 8 · Trust —

**Flexible Rundown** — reorder what's left
*Move the tag match up. Push the promo back.*
**Effect:** New live action, costs 1 minute. Reorder every remaining item on
the card. Wrestlers moved **later** file a small `airtime` memory; wrestlers
moved **earlier** without warning are unprepared, and their segment carries a
higher chance of a post-match incident. This is the branch's workhorse.
**Cost 3** · Requires Hard Out, Buy Me Two Minutes · Level 9 · Trust —

**Dark Match** — off television
*It happens. It just doesn't air.*
**Effect:** Run a match outside the broadcast window. Costs real clock but no
airtime. No executive grade impact, no audience reaction, no `airtime` credit
for the participants — but the result is real, injuries are real, and it is the
only way to give a returning or untested wrestler a match without spending
television on them. Pairs directly with Scouting's **Tryout Match**.
**Cost 2** · Requires — · Level 10 · Trust —

**Run It Back** — replay it
*Show it again. Show it from the other angle.*
**Effect:** Spend 1 minute of window replaying a moment from earlier in the
show. The moment's thread event is re-filed at increased weight and its heat
spreads to **every wrestler in the building** rather than just witnesses.
Replaying a moment somebody is ashamed of is a deliberate provocation and the
game treats it as one.
**Cost 2** · Requires The Hard Camera · Level 12 · Trust —

**Gorilla Sightlines** — the position is worth something
*From here you can see the whole show.*
**Effect:** Standing at Gorilla now shows the live state of every remaining
item on the card — participants, readiness, who is where, who hasn't turned up.
It converts Gorilla from "the room next to the ring" into the game's command
position, which makes the choice to *leave* it meaningful.
**Cost 2** · Requires Flexible Rundown · Level 13 · Trust —

**Overrun** — go long on purpose
*The network gave you ninety minutes. You are taking ninety-six.*
**Effect:** Deliberately exceed the broadcast window by up to 8 minutes. The
finish lands properly, the segment isn't butchered, the locker room notices you
protected their match. `reviewShow()` records `timing: 'long'` and the grade
takes the hit automatically — **there is no version of this that doesn't cost
trust.** Using it is a bet that the segment is worth a grade.
**Cost 2** · Requires Hard Out · Level 14 · **Trust: Solid**

**Split Screen** — two things at once
*Match on the left, brawl in the car park on the right.*
**Effect:** Run two segments simultaneously. **This does not save clock** —
both segments run their full length in parallel, so you gain a slot, not
minutes. The chance of a post-match or backstage incident is doubled across
both, and **you can only be in one of the two rooms**, so one of them is
happening without you by definition.
**Cost 3** · Requires Flexible Rundown, Gorilla Sightlines · Level 16 · **Trust: Good**

### 🏆 Capstones

**Card Subject To Change** — rewrite it live
*The card that went out in the graphics is not the card you are running.*
**Effect:** Once per show, replace a booked item outright while on air — a
different match, different participants, different shape. The replacement is
built from whoever is available and in the building.
**The costs are real:** every wrestler removed from the card files an
`opportunity` grudge as though denied airtime, and if the removed match was
**advertised**, it is still a breach — the audience was promised it. This is a
tool for salvaging a collapsing show, not for improvising a better one.
**Cost 4** · Requires Flexible Rundown, Gorilla Sightlines · Level 18 · **Trust: Good**

**We'll Fix It In The Truck** — call it an angle
*It wasn't a fight. It was planned. Ask anyone.*
**Effect:** Once per show, take an unplanned incident that went out on air and
frame it as intentional. The executive review reclassifies it: instead of
counting toward `backstage: out of hand`, it counts as content, and a genuinely
shocking incident can turn a C into a B.
**The locker room is not fooled.** Everyone who witnessed it files a memory
about the GM covering it up, and the wrestlers involved — who know exactly what
happened — file a heavier one. Used twice in a month, the locker room's read on
your honesty shifts permanently and your rulings start landing one step weaker
across the board.
**Cost 5** · Requires The Hard Camera, Card Subject To Change · Level 22 · **Trust: Trusted**

---

# ⚙️ CORPORATE

*How much rope do they give you?*

This branch extends two ladders the code already has: `TIERS` in
`model/network.js` (broadcast length) and `SLOT_THRESHOLDS` in `data/titles.js`
(championships). The design change is that **crossing a trust threshold now
makes an upgrade available rather than granting it**. Head office offering you
ninety minutes and you taking ninety minutes become two decisions, and the
second one competes with everything else on the board.

The Corporate GM's problem is that everything they earn is more to fill. Three
hours of television with a roster of eighteen is not a reward, it is a
staffing crisis with better production values.

### The broadcast ladder

| Upgrade | Minutes | Cost | Level | Trust |
|---|---|---|---|---|
| *(start)* | 60 | — | 1 | Provisional |
| Expanded Broadcast I | 75 | 1 | 2 | Noted (6) |
| Expanded Broadcast II | 90 | 2 | 5 | Fine (15) |
| Expanded Broadcast III | 105 | 2 | 8 | Good (27) |
| **120-Minute Broadcast** | 120 | 3 | 10 | Good (27) |
| 150-Minute Broadcast | 150 | 4 | 16 | Backed (58) |
| Three-Hour Show | 180 | 5 | 22 | Untouchable (75) |

120 requires **Expanded Broadcast II**, not III — so a GM who wants two hours
fast can skip the 105 rung entirely and save two points, at the cost of five
levels spent on ninety minutes. That is a real decision and it should stay one.

### Foundation

**Expanded Broadcast I** — seventy-five minutes
**Effect:** Broadcast window 60 → 75. Fifteen minutes is one more match or two
more segments; at this stage of the game it is the difference between five
wrestlers used and eight.
**Cost 1** · Requires — · Level 2 · **Trust: Noted (6)**

**The Second Belt** — another championship
**Effect:** Opens the second championship slot from `UNLOCKABLE_TITLES`. A
second title doubles the number of wrestlers who have something to chase and
introduces the first real championship politics: two champions, and only one
main event.
**Cost 2** · Requires — · Level 4 · **Trust: 10**

**Expanded Broadcast II** — ninety minutes
**Cost 2** · Requires Expanded Broadcast I · Level 5 · **Trust: Fine (15)**

**Make Your Case** — argue the grade
*You go and see them after the show.*
**Effect:** New post-show action. Once per week, contest the executive review
by nominating which verdict you think was misjudged and why (a walkout you
prevented, a light show you filled with an unadvertised match). **It can go
either way** — a good case moves the grade up one step, a bad one moves it
down. The executive remembers being argued with: three cases in a season and
they stop listening.
**Cost 2** · Requires — · Level 6 · Trust —

### Working

**Talent Budget** — sign someone
*You have money for one more body.*
**Effect:** Sign one free agent per month. Without the Scouting branch you sign
blind — a name, an archetype, and nothing else. With Scouting you sign
knowingly. Every signing is a wrestler who now expects to be used, and the
roster-use verdict in `reviewShow()` is a *share*, not a count: a bigger roster
makes "broad" harder, not easier.
**Cost 2** · Requires — · Level 7 · **Trust: Fine (15)**

**Set The Priorities** — tell them what to grade you on
*You go in with a plan for the quarter and they agree to judge it.*
**Effect:** Once per quarter (13 weeks), nominate which of the four executive
verdicts — timing, locker room, roster use, backstage order — is weighted
double for the quarter. **The other three are still graded**, and the one you
nominated is unforgiving: failing your own stated priority costs more than
failing anything else. This is the clearest "declare and be held to it"
mechanic in the tree.
**Cost 2** · Requires Make Your Case · Level 8 · Trust — · *Doctrine: The Desk*

**Expanded Broadcast III** — one hundred and five
**Cost 2** · Requires Expanded Broadcast II · Level 8 · **Trust: Good (27)**

**The Third Belt** — tag titles or a secondary
**Cost 2** · Requires The Second Belt · Level 10 · **Trust: Solid (22)**

**120-Minute Broadcast** — two full hours
**Effect:** Broadcast window → 120 minutes. The show is now long enough to
carry a genuine undercard, which means the roster needs to be deep enough to
fill one.
**Cost 3** · Requires Expanded Broadcast II · Level 10 · **Trust: Good (27)**

**Network Favor** — cash something in
*You ask them to look the other way. Once.*
**Effect:** Once per season, applied after a show: **downgrade the damage of
one bad grade by one step** (a D counts as a C, a C as a B). It does not erase
the show and it does not touch the locker room's memory of it. Cashing a favour
is noted; the executive's willingness to grant the next one falls.
**Cost 3** · Requires Make Your Case · Level 12 · **Trust: Good (27)** · **Excludes Creative Control**

**Talent Relations Contact** — they tell you what they want
*Somebody upstairs has an opinion about who should be champion.*
**Effect:** Head office nominates a wrestler they believe should be champion,
or a wrestler they believe should not be. You may comply or ignore it.
Complying pays trust; ignoring it costs trust and, if the wrestler in question
is genuinely wrong for the spot, **the executive is sometimes right and
sometimes not** — the nomination is based on their read, and their read is
based on the same surface data the audience has.
**Cost 2** · Requires Set The Priorities · Level 13 · Trust — · *Doctrine: The Desk*

### Established

**House Show Loop** — run dates that aren't on television
*Three towns, no cameras.*
**Effect:** New calendar action between shows. A house show loop gives every
participating wrestler airtime-equivalent credit, builds `matches` and
`segments` on relationships fast, and lets you test a pairing off camera. It
consumes the between-show week, which means **no scouting that week and no
recovery for injuries**. It is a way of buying locker-room stability with time.
**Cost 3** · Requires Talent Budget · Level 15 · **Trust: Strong (34)**

**The Fourth Belt** — a fourth championship
**Cost 3** · Requires The Third Belt · Level 17 · **Trust: Trusted (42)**

**Poach** — sign someone who already has a job
*They're under contract somewhere else. Contracts end.*
**Effect:** Sign a wrestler from a rival promotion when their contract expires.
Requires Scouting's **Contract Status** to know when that is. A poached
wrestler arrives with a reputation and with existing opinions about people on
your roster — including, sometimes, someone you dismissed.
**Cost 3** · Requires Talent Budget + *Scouting: Contract Status* · Level 18 · **Trust: Trusted (42)**

### 🏆 Capstones

**150-Minute Broadcast** — two and a half hours
**Effect:** Window → 150. At this length the show cannot be filled by the top
half of the roster, and the executive's roster-use verdict becomes the hardest
of the four to satisfy rather than the easiest.
**Cost 4** · Requires 120-Minute Broadcast · Level 16 · **Trust: Backed (58)**

**Three-Hour Show** — the flagship
**Effect:** Window → 180. Requires, in practice, a roster of 24+ and at least
three championships to be anything other than an endurance test. The last hour
of a three-hour show that you cannot fill is the most visible failure state in
the game.
**Cost 5** · Requires 150-Minute Broadcast · Level 22 · **Trust: Untouchable (75)**

**Creative Control** — set your own terms
*They stop telling you what the show is.*
**Effect:** Each week you set your own broadcast length within a band (±30
minutes of your tier) and declare your own main event in advance. The executive
review **stops grading you against their priorities and starts grading you
against yours** — the plan you filed on Monday.
This is not easier. Their standards are generic; yours are specific, and the
game holds you to a plan you wrote when you were optimistic. A missed
self-declared main event is a breach at double weight.
**Cost 5** · Requires Set The Priorities, 120-Minute Broadcast · Level 25 · **Trust: Untouchable (75)** · **Excludes Network Favor** · *Doctrine: The Desk*

---
# 🔷 SCOUTING

*Who is out there, and who is in your building?*

**This branch introduces a system that does not exist.** There is currently no
talent pool, no free agency, no developmental territory, and no way to learn
anything about a wrestler that isn't already on their card. Scouting adds:

- **A hidden pool** of 60–100 generated wrestlers across four sources: the
  independent circuit, developmental, free agents, and rival promotions.
- **Reports with accuracy.** Early reports are adjectives and ranges ("looks
  like a good hand", "in-ring somewhere in the upper half"). Later ones are
  exact. A report is a *claim*, and claims can be wrong.
- **Scouting weeks.** Reports cost time on the calendar between shows, not
  minutes during one. This is the first system in the game that makes the space
  between shows a resource.

The branch also turns inward. Half of it is scouting **your own roster** —
learning the traits `traits.js` already models but never reveals. A GM without
Scouting is reading eleven personality traits through their effects only.

The Scouting GM's problem is that information is not authority. Knowing that
Vance will refuse the booking does not book the show.

### Foundation

**Background Check** — learn one thing about one of your own
*You ask around about somebody on your roster.*
**Effect:** One report per week on a roster member. Reveals **one hidden
personality trait** with its reading in words ("hot-headed", "keeps his own
counsel"). Which trait is revealed is chosen by relevance — the one most
affecting their recent behaviour — not by you.
**Cost 1** · Requires — · Level 2 · Trust —

**Tape Study** — watch the matches
*You sit down with the footage.*
**Effect:** Reveals in-ring and charisma bands for any wrestler, on roster or
in the pool. Bands, not numbers — "excellent", "solid", "limited". Costs no
calendar time for your own roster; one week per pool prospect.
**Cost 1** · Requires — · Level 3 · Trust —

**Indie Circuit Contacts** — there is an outside world
*People keep sending you names.*
**Effect:** **Unlocks the talent pool.** Three names per month become visible,
with a name, an archetype, and one vague sentence. This is the upgrade that
makes Corporate's *Talent Budget* mean anything — without it you are signing
from a list of strangers.
**Cost 2** · Requires Tape Study · Level 4 · Trust —

**Character Read** — personality, not ability
*You find out what they're like to work with.*
**Effect:** Extends reports to personality traits for pool prospects — two
traits per report, chosen by prominence. A prospect who reads "excellent in the
ring, extremely difficult" is a decision, which is the whole point.
**Cost 2** · Requires Indie Circuit Contacts · Level 5 · Trust —

**Injury History** — the body
*Ask about the knee.*
**Effect:** Reveals injury history and durability for any wrestler, roster or
pool. Signing someone whose durability you did not check and losing them for
eight weeks is a mistake the game will let you make exactly once.
**Cost 1** · Requires Tape Study · Level 6 · Trust —

### Working

**Tryout Match** — bring them in
*One night. See what they can do.*
**Effect:** Bring a pool prospect to a show for a single match. Pairs with
Production's **Dark Match** to run it off television, or risk it on air. A
tryout reveals ability exactly and personality partially, and the prospect
forms their **first opinion of you** based on how the night went — a prospect
booked to lose in three minutes remembers that if you sign them later.
**Cost 2** · Requires Character Read · Level 7 · Trust —

**Deep Dive** — everything about one person
*Two weeks of asking everyone who's ever worked with them.*
**Effect:** Costs two calendar weeks. Returns a **complete personality read**
on one wrestler — all eleven traits, with readings — plus their history and
their existing relationships with anyone on your roster. The most expensive
information action in the game and the most complete.
**Cost 3** · Requires Character Read, Background Check · Level 8 · Trust —

**Attitude Report** — will they be a problem
*Not "are they good". "Will they be trouble".*
**Effect:** Returns a direct prediction of a prospect's backstage behaviour:
how often they'll generate incidents, whether they respect authority, whether
they'll refuse bookings. **This does not stop you signing them.** It lets you
sign a known problem deliberately, which is a legitimate and sometimes correct
strategy — troublemakers generate stories.
**Cost 2** · Requires Character Read · Level 9 · Trust —

**Word From The Road** — hear about incidents you weren't near
*Somebody phones you.*
**Effect:** Once per show, an incident that occurred somewhere you couldn't see
is reported to you **after the fact but before the show ends** — late enough
that you can't have prevented it, early enough that you can still rule on it.
Converts one `missed` per night into a late ruling.
**Cost 2** · Requires Background Check · Level 10 · Trust —

**Contract Status** — when they're free
*You know the dates.*
**Effect:** Reveals contract expiry for every wrestler in rival promotions, and
— the sharp end — for **your own roster**. You now know exactly which of your
wrestlers can walk in eleven weeks, which turns their grievances into
deadlines. Prerequisite for Corporate's *Poach*.
**Cost 2** · Requires Indie Circuit Contacts · Level 12 · Trust —

**Second Set Of Eyes** — hire a scout
*Somebody else does the looking.*
**Effect:** Reports arrive without spending your calendar weeks — two a month,
free. **Your scout has taste.** They over-rate one thing (size, charisma,
technical ability, promo work) and under-rate another, consistently, and the
game never tells you which. You learn their bias by signing people. You may
replace them, and the new one has a different bias you also don't know.
**Cost 3** · Requires Deep Dive · Level 13 · Trust —

### Established

**The Feeder** — a developmental territory
*Somewhere to put people who aren't ready.*
**Effect:** Establish a developmental roster. Signed prospects can be parked
there: they improve slowly over months, cost nothing in airtime, and **cannot
be used**. Wrestlers left there longer than about six months start asking when
they're coming up, and one who is called up after being forgotten arrives with
a grudge already filed.
**Cost 3** · Requires Tryout Match · Level 15 · **Trust: Strong (34)** · *Doctrine: The Desk*

**Scout Your Own** — who's looking at your roster
*Somebody's been asking about Kestrel.*
**Effect:** You are told when a rival promotion is scouting one of your
wrestlers, and who. This is pure pressure: a wrestler being scouted while
carrying a grudge against you is a wrestler you are going to lose, and knowing
it does not fix it. It does let you get ahead of it — with Negotiation's
*Loyalty Bonus*, or by giving them what they've been asking for.
**Cost 2** · Requires Contract Status · Level 16 · Trust —

**The Hot Free Agent** — a name becomes available
*Everyone wants them. They'll talk to you.*
**Effect:** Once per season, trigger a marquee free agency event: an
established, high-ability wrestler enters the pool and multiple promotions
pursue them. Signing them requires trust, money, and usually a **promise about
their position on the card** — a promise recorded like any other, against a
wrestler with the standing to make breaking it catastrophic.
**Cost 3** · Requires Second Set Of Eyes · Level 18 · **Trust: Trusted (42)**

### 🏆 Capstones

**Player Development** — build someone
*You decide what they become.*
**Effect:** For wrestlers in developmental (requires **The Feeder**) or in their
first year, nominate a direction of growth: in-ring, charisma, or a specific
personality trait. Growth is slow — measured in months — and **you set
direction, not magnitude**. Development can stall, and a wrestler being
developed toward something they're not suited for stalls harder and knows it.
**Cost 4** · Requires The Feeder, Deep Dive · Level 20 · Trust —

**The Eye** — you are never wrong about talent
*You watch four minutes of a match in a leisure centre and you know.*
**Effect:** Every report is exact and immediate: full traits, exact ability, and
**ceiling** — the maximum this wrestler will ever reach. No calendar cost. Your
scout's bias no longer applies.
**The cost of perfect information:** you now know which of your wrestlers will
never be main-eventers, and the game knows you know. Those wrestlers still want
to be pushed, still file `opportunity` grudges when they aren't, and the
comfortable ambiguity that let you keep them hopeful is gone. Several wrestlers
you were happy with become wrestlers you are managing down.
**Cost 5** · Requires Second Set Of Eyes, Deep Dive · Level 24 · **Trust: Strong (34)**

---

# 🌸 NEGOTIATION & TIME REQUESTS

*What do they want, and what will you trade?*

**This branch also introduces a system that does not exist.** Today, a wrestler
only makes a demand as part of an incident — something has gone wrong and they
are in your office about it. Negotiation adds the peacetime version: **a
standing queue of requests**, arriving whether or not anything is on fire.

A request has a **wrestler**, a **want**, an **intensity**, and a **deadline**.
Wants include: more time in a match, a specific opponent, a win, a title shot,
a tag partner, a stipulation, a night off, a match on television at all, and
*not* working with a named person.

Every request is a small version of the game's core question. A wrestler asking
for four more minutes is asking you to take four minutes from somebody else,
and the branch's job is to give you more answers than "yes" and "no" — because
"yes" and "no" is where the game starts, and it should not be where it ends.

The Negotiation GM's problem is that every clever answer is a commitment, and
commitments accumulate faster than shows do.

### Foundation

**They're Asking** — requests exist
*People want things. Now you can see the list.*
**Effect:** **Unlocks the request system.** A queue of open requests with
wrestler, want, and deadline, visible on the booking screen. Requests that
expire unanswered file an `opportunity` memory, so ignoring the list is a
decision with a cost.
**Cost 1** · Requires — · Level 1 · Trust —

**Read The Ask** — how badly do they want it
*You can tell the difference between a wish and a line in the sand.*
**Effect:** Requests display intensity in words — "would like", "has been
asking", "this is the third time", "will not let this go". A high-intensity
request denied without a compromise is very close to an incident.
**Cost 1** · Requires They're Asking · Level 3 · Trust —

**Not Tonight** — defer with a date
*"Not this week. Week after."*
**Effect:** Defer a request to a specific named week rather than denying it.
The wrestler accepts and the request re-enters the queue then, at higher
intensity. **The game remembers you deferred it**, and deferring the same
request twice reads as a refusal with extra steps.
**Cost 1** · Requires They're Asking · Level 4 · Trust —

**Split The Difference** — part of what they asked for
*They wanted six minutes. They're getting three.*
**Effect:** Grant a partial version of any quantitative request — some of the
time, a shorter title shot window, one of the two opponents named. Partial
grants land as genuinely neutral for most wrestlers and as an insult for the
proud ones, which is exactly the sort of thing `traits.js` should be deciding.
**Cost 2** · Requires Read The Ask · Level 5 · Trust —

**Make It Up To You** — the compromise that gets recorded
*"Not tonight. But you're first in line next week, and I mean it."*
**Effect:** When denying a request for additional time, you may instead offer
**priority consideration next week**. The wrestler may accept the compromise —
proud and impatient wrestlers may not — and the game **records the
commitment**. Honouring it next week pays as a kept promise; not honouring it
costs more than the flat refusal would have.
**Cost 2** · Requires Split The Difference · Level 6 · Trust —

### Working

**What They Actually Want** — the ask behind the ask
*He says he wants more time. He wants to not be in the opener.*
**Effect:** Reveals the underlying want behind a request when the two differ,
which is roughly a third of the time. Granting the surface request when the
real want is different produces almost no goodwill — a mechanic that only
becomes visible once you have this upgrade, and which has been quietly running
the whole time.
**Cost 2** · Requires Read The Ask, *Locker Room: Private Meeting* · Level 7 · Trust —

**Ask Them For One** — you initiate
*"I need a favour."*
**Effect:** Reverse the channel. Ask a wrestler to do something they would
normally refuse — lose to someone below them, work with an enemy, drop a title,
put over a debut. They weigh it against their standing with you, their traits,
and their live memories. A wrestler you have kept promises to says yes far more
often. A refusal is not free for them either: refusing a direct ask files a
memory *they* carry about *you*.
**Cost 2** · Requires Make It Up To You · Level 8 · Trust —

**Trade** — this for that
*You can have the title shot. Here's what it costs.*
**Effect:** Grant any request with a condition attached: take a loss this week,
work with someone you dislike, give up your spot next week, drop the belt in
six weeks. Both halves are recorded, and **both can be broken** — a wrestler
who takes the deal and then refuses their half is a live incident with your
authority on the line in public.
**Cost 3** · Requires Ask Them For One · Level 9 · Trust —

**The Handshake Deal** — nothing on paper
*"Between us."*
**Effect:** Make an agreement the game does **not** record as a formal
commitment — no deadline, no breach penalty, no executive visibility. The
wrestler remembers it anyway, exactly as strongly. This is a tool for GMs who
want to promise more than they can track, and it is a trap in precisely the way
that sounds. Honouring a handshake deal unprompted is worth more than honouring
a recorded one.
**Cost 2** · Requires Make It Up To You · Level 11 · Trust — · **Excludes Paper Trail** *(Authority)* · *Locked by Doctrine: The Desk*

**Time Bank** — credit for giving it up
*He went short three weeks running. He's owed.*
**Effect:** A wrestler who accepts less time than they asked for, or gives time
up voluntarily, accumulates credit. **They choose when to cash it**, not you —
a banked wrestler will one day request something large and expect it granted,
and the game will remind you they earned it. Credit caps at three and expires
after about eight weeks. This is an economy the *wrestler* controls, which is
the point.
**Cost 3** · Requires Split The Difference · Level 13 · Trust — · **Excludes The Veteran's Rate**

### Established

**The Veteran's Rate** — ask a veteran to take less
*"I need you to go short tonight so the kid gets his ten minutes."*
**Effect:** Ask a high-standing veteran to accept reduced time to protect
somebody else's segment. Most will say yes; it is what veterans are for.
**Overused, it stops being a favour** — asked more than twice in a month, a
veteran begins filing `airtime` memories and their standing with you drops
faster than a younger wrestler's would, because they know what you are doing.
**Cost 2** · Requires Ask Them For One · Level 14 · Trust — · **Excludes Time Bank**

**Contract Talks** — renegotiate
*Money, guaranteed dates, or creative input. Pick what you're offering.*
**Effect:** Renegotiate with any wrestler, offering one of three:
- **Money** — costs budget, reduces request intensity broadly.
- **Guaranteed appearances** — they must be booked every week or it's a breach.
- **Creative input** — **that wrestler may now refuse any booking without it
  counting as insubordination**, permanently. It cannot be revoked.
Creative input is the most powerful thing you can give a wrestler and the most
dangerous. It should be presented plainly and taken rarely.
**Cost 3** · Requires Trade · Level 16 · **Trust: Solid (22)**

**Loyalty Bonus** — keep them
*You pay them to stop taking calls.*
**Effect:** Pay to make a wrestler refuse outside offers for a season. Requires
Scouting's *Scout Your Own* to know who needs it. **A loyalty bonus paid to an
unhappy wrestler buys their contract, not their goodwill** — they stay, and
they stay angry, and now they know you'll pay.
**Cost 2** · Requires *Scouting: Scout Your Own* · Level 17 · **Trust: Good (27)**

### 🏆 Capstones

**Everyone Gets A Meeting** — the whole room, one sitting
*You clear the afternoon. Everybody who wants something gets five minutes.*
**Effect:** Once per week, run a full request round: every wrestler with an
open want states it, in sequence, and you answer all of them in one sitting.
Costs a large pre-show block (roughly 20 minutes).
**The catch is the format.** They are answering in front of each other. Every
refusal is witnessed by everyone still waiting, and the locker room compares
notes: granting three requests and refusing nine does not read as nine
individual disappointments, it reads as **a pattern**, and the game applies it
as one. Handled well it is the strongest single locker-room action in the game.
Handled badly it is a mutiny with a sign-up sheet.
**Cost 4** · Requires Trade, What They Actually Want · Level 19 · Trust —

**Your Word Is Good** — the reputation you can only lose
*You have never once told this person something that wasn't true.*
**Effect:** Tracked per wrestler. A wrestler to whom you have **never broken a
promise, commitment, deferral or handshake deal** will accept **one request per
season from you regardless of what it is** — a loss to someone they hate, a
title drop, a match with a partner they despise.
**It is lost the first time you break anything with that person, permanently**,
and `coolGrudges()` does not restore it. It cannot be re-earned. The capstone
does not make you more persuasive; it converts a long record of honesty into
one enormous favour, once, and then it is gone.
**Cost 5** · Requires Everyone Gets A Meeting, *Locker Room: Promise Them Something* · Level 23 · Trust —

---
## 9. How the branches connect

### The six mutual exclusions

Each is a philosophical fork, not a balance tax. Taking one greys the other
permanently, with the reason shown on the board.

| A | B | The argument |
|---|---|---|
| **The Open Door** *(Auth)* | **Chain Of Command** *(Auth)* | You are reachable, or you are represented. Not both. |
| **Paper Trail** *(Auth)* | **The Handshake Deal** *(Neg)* | Everything on the record, or nothing on the record. |
| **Security On Retainer** *(Auth)* | **Locker Room Sources** *(LR)* | A building with your guards posted in it is a building where nobody tells you anything. |
| **Line In The Sand** *(Auth)* | **Cold Open** *(Prod)* | You cannot declare a rule to a room you never gathered. Cold Open costs you the entire pre-show block, and Line In The Sand is the pre-show block's best use. |
| **Time Bank** *(Neg)* | **The Veteran's Rate** *(Neg)* | A formal economy of owed minutes, or an informal one of favours asked. Running both means nobody knows what they're owed. |
| **Network Favor** *(Corp)* | **Creative Control** *(Corp)* | You cannot ask favours of people whose authority you have taken. |

Note that **four of the six cross branches.** These are the exclusions that
actually shape a build, because they force a player who has invested in one
branch to concede something in another.

### Prerequisites that reach across branches

Five upgrades require an upgrade from a different branch. These are the tree's
spine — they are what stops a single-branch build from being viable past the
mid-game.

| Upgrade | Needs, from elsewhere |
|---|---|
| **Poach** *(Corporate)* | Contract Status *(Scouting)* |
| **Loyalty Bonus** *(Negotiation)* | Scout Your Own *(Scouting)* |
| **What They Actually Want** *(Negotiation)* | Private Meeting *(Locker Room)* |
| **Your Word Is Good** *(Negotiation capstone)* | Promise Them Something *(Locker Room)* |
| **Iron Man Match** *(Booking)* | 90 minutes of television *(Corporate, in practice)* |

### Combinations that do something new

Twelve pairings where holding both changes behaviour beyond the sum. These are
where a build stops being a list and starts being a style of play.

**Tryout Match + Dark Match** *(Scouting × Production)* — run the tryout off
television. Without Dark Match, every tryout is a gamble with a live segment.

**Word From The Road + The Building Is Mine** *(Scouting × Authority)* —
redundant by design. Holding both refunds Word From The Road's points, once,
with a note. The tree should be honest when it has sold you the same thing
twice.

**Commercial Break + The Hard Camera** *(Production × Production)* — stage an
attack the audience never sees. The locker room witnesses it, the executive
review doesn't, and the thread heats up without any of it being your fault on
paper.

**Read The Room + Deep Dive** *(Authority × Scouting)* — Read The Room's
accuracy is a function of how well you know the wrestler. On a wrestler you've
Deep Dived, it is nearly always right. On a stranger it is close to a coin
flip. This is the cleanest example of two branches multiplying.

**Attitude Report + Line In The Sand** *(Scouting × Authority)* — sign a known
troublemaker, then declare the rule you know they'll break. Deliberately
manufacturing the incident you want, in the room you're standing in, at the
severity you chose. This is the tree's most satisfying two-card combo and it
should be discoverable rather than signposted.

**Contract Talks (creative input) + Because I Said So** *(Negotiation ×
Authority)* — direct conflict. A wrestler with creative input **cannot** be
forced through; the override greys out for them specifically, permanently.
Giving creative input to somebody you were relying on forcing is a mistake the
game should let you make.

**The Main Event Scene + Open Challenge** *(Booking × Booking)* — with a
declared scene, only scene members answer an open challenge. The mechanic that
let anybody come through the curtain now can't, because you told the audience
who matters.

**Promise Them Something + Time Bank** *(Locker Room × Negotiation)* — banked
credit and open promises stack into one visible ledger on the wrestler's card.
It reads as a debt sheet, which is what it is.

**Scout Your Own + Read The Grudge** *(Scouting × Locker Room)* — you know a
rival is asking about a wrestler and you know precisely what that wrestler is
angry about. You have the diagnosis and the deadline, and probably not the
minutes.

**Faction Summit + Split Screen** *(Locker Room × Production)* — the only
reliable way to survive a faction beatdown during a live show, because you can
run the segment and be in the other room.

**House Show Loop + Working Relationship** *(Corporate × Booking)* — house
shows build `matches` and `segments` fast, which is the fastest legal route to
clearing a tag-team relationship gate without spending television on a team
that might not work.

**Set The Priorities + Book The Long Game** — *impossible*. Doctrine: The Desk
grants the first and locks the second. Named here because players will look for
it: you can plan for head office or you can plan for the audience, not both.

### Doctrine, restated as builds

The Doctrine picks at level 6 and level 20 are the tree's coarsest fork.
Because you take two of three, there are exactly three end-states:

| Doctrines | The GM |
|---|---|
| **Hand + Ear** | Runs the building personally. Force and repair, both by hand. No corporate cover, no long-range planning, but the deepest set of tools for the room in front of them. |
| **Hand + Desk** | The company man. Discipline backed by head office. Can dismiss people and can rewrite what they're graded on. Has almost nothing for a locker room that has decided it hates them. |
| **Ear + Desk** | The diplomat. Buys goodwill and spends institutional capital. Cannot force anybody to do anything, ever, and every problem must be solved by negotiation before it becomes an incident. |

### Five specialisations that fall out of the economy

Not classes — nobody picks these — but the shapes ~97 points reliably produce.

**The Disciplinarian.** Authority + Production. Hand + Desk. Runs a tight,
fast show and a frightened locker room. `troubleFactor()` is low, so the night
is quiet; when it does go wrong, it goes badly wrong, because nobody warned
them and nobody will help. Capstones: Final Say, Card Subject To Change.

**The Players' GM.** Locker Room + Negotiation. Ear + Desk. Almost never rules
harshly; almost never has to. Runs on promises, and the failure state is a
promise ledger they can no longer service — six live commitments and one
hour of television. Capstones: They'd Run Through A Wall, Your Word Is Good.

**The Producer.** Production + Booking. Any doctrine. The show is immaculate
and the building is on fire. Highest grades in the game and the worst
`bossView()`. Capstones: We'll Fix It In The Truck, The Main Event Scene.

**The Corporate Operator.** Corporate + Authority. Hand + Desk. Three hours of
television, four championships, twenty-eight wrestlers, and a roster-use
verdict that has read "narrow" for eleven straight weeks. Capstones: Three-Hour
Show, Creative Control.

**The Scout.** Scouting + Negotiation. Ear + Desk. Builds the roster rather
than managing it. Weakest in the moment — few live tools, little authority —
and by season three has the best talent in the game and knows exactly what
every one of them wants. Capstones: The Eye, Everyone Gets A Meeting.

---

## 10. The skill-tree screen

### The shape

**Seven vertical lanes, four horizontal tiers, read bottom-to-top.** A
management-game upgrade board: you can put a finger on a level 1 node and trace
it up to the capstone it feeds.

Bottom-to-top matters. It reads as *growth* — the tree gets taller as you get
better — and it puts the capstones at the top of the screen where they act as
the goal you scroll toward, rather than at the bottom where they'd read as a
footnote.

```
                                                     [ GM LEVEL 17 · 8 points · capstones 2/4 ]

  LEGACY      ◆FINAL SAY    ◆RUN A WALL   ◆MAIN EVENT  ◆TRUCK      ◆3 HOURS    ◆THE EYE    ◆YOUR WORD
  (20–30)     ◆BUILDING     ◆NOBODY QUITS ◆LONG GAME   ◆CARD SUBJ  ◆CREATIVE   ◆PLAYER DEV ◆EVERY MTG
              ─────────────────────────────────────────────────────────────────────────────────────
  ESTABLISHED  ○ Dismissal   ● Apology     ● Battle R.  ● Split Scr  ● 4th Belt  ● The Feeder ● Contract
  (13–19)      ● Long Mem.   ● Faction     ● Protect     ● Overrun    ● Poach     ● Hot F/A    ○ Loyalty
               ● Reinstate   ● Speak For   ● Forced P.   ● Gorilla    ● House Sh  ● Scout Own  ● Vet Rate
              ═════════════════════ D O C T R I N E   I I   ·   level 20 ═══════════════════════════
  WORKING      ● Because     ● Vet's Word  ● No.1 Cont  ● Flex Run   ● 120 MIN   ● Deep Dive  ● Trade
  (6–12)       ● Example     ● Sources     ● Open Chal  ● Hard Cam   ● Favor     ● Attitude   ● Ask One
               ● Retainer    ● Emergency   ● Advertise  ● Comm Brk   ● Priority  ● Tryout     ● Actually
               ○ Open Door   ● Cool It     ● Scramble   ● Dark Mtch  ● 3rd Belt  ● Word Road  ● Handshake
               ⊗ Chain Cmd   ● Pairing     ● Just Along ● Run Back   ● EB III    ● Contract   ● Time Bank
              ═════════════════════ D O C T R I N E   I   ·   level 6 ════════════════════════════
  FOUNDATION   ● Line/Sand   ● Know Room   ● Tag Team   ● Stopwatch  ● EB I      ● Backgrnd   ● They're
  (1–5)        ● Send Word   ● Door Hours  ● Triple     ● Go Home    ● 2nd Belt  ● Tape       ● Read Ask
               ● Hold That   ● Read Grudge ● Submission ● Buy 2 Min  ● EB II     ● Indie      ● Not Tonight
               ● Paper Trail ● Private Mtg ● Fatal 4    ● Hard Out   ● Make Case ● Character  ● Split Diff
               ● Read Room   ● Promise     ● Working R. ⊗ Cold Open  ●           ● Injury     ● Make It Up

               AUTHORITY     LOCKER ROOM   BOOKING      PRODUCTION   CORPORATE   SCOUTING     NEGOTIATION
                 🔴             🟢            🔵           🟠            ⚙️           🔷            🌸
```

`●` owned · `○` available now · `◇` locked by level or trust · `⊗` excluded,
struck through · `◆` capstone

### The four tiers

| Tier | Levels | Feel |
|---|---|---|
| **Foundation** | 1–5 | Cheap, mostly 1 point, mostly a single verb. This is where the player learns what the branch is *for*. |
| **Working** | 6–12 | The bulk of the tree. 2–3 points. Where builds diverge. |
| **Established** | 13–19 | Expensive, gated on trust as well as level. Requires committing to a branch. |
| **Legacy** | 20–30 | Capstones only. Four slots for fifteen doors. |

### The two Doctrine bands

Full-width horizontal bars **across all seven lanes** at the level 6 and level
20 boundaries. Nothing else in the layout crosses lanes, so these read
immediately as gates the whole tree passes through.

Before you pick: the bar shows three doors. After: it shows your Doctrine's
crest, and every upgrade the other two Doctrines would have given you is struck
through in its lane. **Struck through, not hidden.** The player should be able
to look at their board and see the game they are not playing.

### Connectors

- **Solid vertical lines** — prerequisite within a branch. Bright when both
  ends are owned, dim when the child is unreachable.
- **Dotted diagonals** — cross-branch prerequisites. There are only five, and
  they should be the most visually obvious lines on the board, because they are
  the ones that surprise people.
- **Red crossed lines** — mutual exclusions. Drawn permanently, including
  between lanes. The four cross-branch exclusions are the busiest lines on the
  screen and should be.
- **Faint amber arcs, on hover only** — combination synergies from §9. Hovering
  Attitude Report lights an arc to Line In The Sand with the combo name
  floating on it. Never shown by default; twelve arcs drawn at once is noise.

### Trace mode

Click any locked upgrade → the board dims to near-black and lights **only the
path to it**: every prerequisite, the level bar it needs, the trust band it
needs, and a running total in the corner.

> **THREE-HOUR SHOW**
> 5 points · you have 8
> Needs: 150-Minute Broadcast (4) → 120-Minute (3) → Expanded Broadcast II ✓
> Needs: GM Level 22 — you are 17
> Needs: Management Trust: Untouchable (75) — you are at 44
> **Total from here: 12 points, 5 levels, 31 trust**
> **Capstone slots: you have 2 of 4 remaining**

This is the single most important interaction on the screen. A tree you can't
plan against is a tree you spend points in at random.

### The header

Left: **GM Level**, XP bar with the exact number to next level. Centre:
**unspent points**, large, and the capstone counter (`2 / 4`) beside it, because
the capstone cap is the constraint players will forget. Right: **Management
Trust** band and **Standing** phrase, both as words — "Trusted", "They think you
have the place in hand" — never as numbers, consistent with the rest of the
game.

### Two panels the tree needs and boards usually don't have

**"What this cost me."** A tab listing every upgrade permanently unavailable to
this GM, and why: excluded by choice, locked by Doctrine, capstone cap. In a
game about disappointing people, the screen that shows you what you gave up is
thematically load-bearing.

**"What changed."** A tab showing, for each owned upgrade, the number of times
it has actually been used. A GM who bought Emergency Mediation eleven weeks ago
and has used it twice should be able to find that out. It is also, bluntly, the
best balance telemetry the game will ever get.

### Responsive

At phone width the seven lanes become a **branch picker** — seven cards showing
owned/total and the next available upgrade — opening into one lane at a time,
full height, with the Doctrine bars still crossing it. The board view is a
desktop luxury; the picker is what most players will use.

---
## 11. Upgrades that would break the game

Every upgrade in this document had a more powerful version I wanted to write.
This section is the audit: what the tempting version was, why it would have
hurt, and what is in the tree instead. Then the ones still in the tree that I
think are the genuine remaining risks, with the nerf already written in case
playtesting says so.

### A. Rewritten before they got in

**Because I Said So**
- ❌ *Tempting:* Override any refusal, unlimited, no consequence.
- **Why it breaks:** Refusal is one of the game's four or five real pressure
  sources. An unlimited override deletes it, and with it the entire reason to
  keep a wrestler happy. This is the single most dangerous upgrade in the
  document and it is also the one the player wants most.
- ✅ *Shipped:* Once per show. Permanent grudge. Doubles if they lose the match
  you forced them into. Second use on the same wrestler inside a month risks
  a walkout. Requires Standing: Plain — a GM head office already doubts cannot
  use it at all.

**Read The Room**
- ❌ *Tempting:* Show exactly how each ruling will be received.
- **Why it breaks:** Judgement *is* the gameplay. A reliable preview turns
  every incident into a lookup.
- ✅ *Shipped:* A hint, wrong about a fifth of the time, and wrong more often
  on wrestlers you've never scouted. Scales with Deep Dive, so accuracy is
  something you buy per person rather than globally.

**Chain Of Command**
- ❌ *Tempting:* A deputy handles incidents you can't reach, correctly.
- **Why it breaks:** Presence is the Tier 3 mechanic. Anything that resolves
  incidents in rooms you aren't in removes the cost of being in the wrong place.
- ✅ *Shipped:* The deputy rules the way *they* would — read off their own
  traits — and it goes on **your** record. You have not delegated the
  consequence, only the decision.

**Security On Retainer**
- ❌ *Tempting:* Post guards; those rooms stop generating incidents.
- **Why it breaks:** Removes trouble rather than relocating it.
- ✅ *Shipped:* Posted rooms resolve one step lower **and go dark**. Hard-
  excludes Locker Room Sources. You bought quiet by buying blindness.

**Card Subject To Change**
- ❌ *Tempting:* Rewrite the card live, freely.
- **Why it breaks:** Deletes the cost of bad planning, which is most of the
  Booking branch's tension.
- ✅ *Shipped:* Once per show. Removed wrestlers file an airtime grudge as
  though denied. An advertised match removed is **still a breach**. It salvages
  disasters; it does not improve good shows.

**Network Favor**
- ❌ *Tempting:* Erase one bad show per season.
- **Why it breaks:** A get-out-of-jail card makes one week a year consequence-
  free, and players will bank it for exactly the week they were going to
  gamble anyway.
- ✅ *Shipped:* Downgrades the damage by one step, does not erase it, does not
  touch locker-room memory, and the next favour is harder to get.

**Split Screen**
- ❌ *Tempting:* Two segments at once, half the clock cost.
- **Why it breaks:** A flat 50% discount on the game's scarcest resource. Every
  other clock decision becomes trivial.
- ✅ *Shipped:* **No clock saving at all.** You gain a slot, not minutes.
  Doubled incident chance across both, and you can only stand in one room.

**Time Bank**
- ❌ *Tempting:* Bank minutes, spend them when you like.
- **Why it breaks:** Gives the player a savings account against the clock, and
  the clock is supposed to be a wall.
- ✅ *Shipped:* **The wrestler cashes it, not you.** Capped at three, expires in
  eight weeks. It is a liability with a friendly name.

**Your Word Is Good**
- ❌ *Tempting:* Wrestlers you've kept promises to always agree.
- **Why it breaks:** "Always" removes the negotiation.
- ✅ *Shipped:* **One request per season per wrestler**, and the standing is
  lost permanently the first time you break anything with that person. It
  converts a long record into one big favour and then it is spent.

**Player Development**
- ❌ *Tempting:* Choose a wrestler's stats.
- **Why it breaks:** Roster limitation is the thing you book around.
- ✅ *Shipped:* Direction, not magnitude. Months, not weeks. Can stall, and
  stalls harder when you're developing someone toward what they aren't.

**Poach / Talent Budget**
- ❌ *Tempting:* Sign your way out of a thin roster.
- **Why it breaks:** Every roster problem becomes a shopping problem.
- ✅ *Shipped:* One signing a month, gated on trust, and — the important part —
  **roster use is a share, not a count**, so a bigger roster makes the
  executive's broad-usage verdict *harder*. Every signing is a new person who
  expects to be used.

### B. Still in, still the biggest risks

These four I have left as written because I think they're worth the danger, but
they are the ones to watch in playtesting. Each has its nerf pre-written.

**1. The Building Is Mine** *(Authority capstone)*
The risk is that perfect incident awareness makes location choice trivial —
you always know where to go, so you always go to the right place. The
accountability cost (`missed` → `ignored`) is an elegant answer on paper, but
it only bites a GM who *can't* get there, and a well-built GM usually can.
> **Nerf if needed:** reports arrive with a delay proportional to distance —
> you learn about the far end of the building ninety seconds late, by which
> point walking there is a choice about what you're abandoning rather than a
> free correction.

**2. Everyone Gets A Meeting** *(Negotiation capstone)*
Batch-processing the request queue is a real efficiency gain, and efficiency
gains are exactly what this tree is supposed to avoid selling. The public-
refusal mechanic is meant to be the counterweight, but if the pattern penalty
is tuned soft, this becomes "clear the queue in one action."
> **Nerf if needed:** the pattern penalty scales with the *ratio* of refusals
> to grants rather than the count, so a GM who runs the meeting and says no to
> most of the room takes a locker-room hit larger than the nine individual
> refusals would have been. Refusing everyone should be strictly worse than
> never having held the meeting.

**3. We'll Fix It In The Truck** *(Production capstone)*
Reclassifying a real incident as content lets you launder disorder into grade.
The locker-room cost is severe and escalating, but grade drives trust and trust
drives the broadcast ladder, so there's a compounding loop here.
> **Nerf if needed:** cap it at once per **month**, and make the reclassified
> incident still count toward `backstage` disorder at half weight — it improves
> the grade without fully cleaning the record.

**4. The Eye** *(Scouting capstone)*
Perfect talent information is the classic management-game power creep. The
"you now know who your ceiling players are, and so does the game" cost is real
and I like it a great deal, but it is a *narrative* cost paid against a
*mechanical* benefit, and those rarely balance.
> **Nerf if needed:** exact on ability, **ranges on personality**, and
> **ceiling never shown at all** — replaced by a single adjective ("has a top
> of the card in him", "solid hand, always will be") that is right about
> four times in five.

### C. Things deliberately not written

Whole categories that were considered and rejected, listed so nobody adds them
later thinking they were an oversight.

| Not written | Why |
|---|---|
| Anything expressed as a percentage to the player | §1. The rule is the rule. |
| Morale regeneration, grudge decay acceleration, "wrestlers forgive faster" | Attacks the memory system, which is the game's spine, and does it invisibly. |
| A global `troubleFactor()` reduction | That number should move because of what you *did*, never because of what you *bought*. |
| Extra security beyond three, or security that never runs out | Security running out mid-show is one of the best pressure moments in the game. |
| An upgrade that reveals the executive's scoring formula | `reviewShow()` deliberately never exports its score. Selling the formula means players optimise the formula instead of the show. |
| Retries, undo, "re-roll this incident" | The game is a record of decisions. Nothing may edit the record. |
| Extra minutes not tied to the broadcast ladder | Runtime is the master resource and it has exactly one source: head office. |
| A second GM, an assistant who acts autonomously | Two of you is not this game. Chain Of Command is the closest it gets, and it costs you your own record. |
| Permanent stat boosts to wrestlers | Wrestlers change because of what happened to them, not because of what you unlocked. |

### D. Three structural safeguards

Independent of any single upgrade, three properties of the system are what
actually keep it honest. If the tree ever feels too easy, check these first.

**1. The point ceiling.** ~97 points against ~250 points of tree. If a future
tier adds income without adding cost, builds converge and the tree stops being
a set of choices. **Keep ownership between a third and two-fifths.**

**2. The capstone cap.** Four of fifteen, non-refundable. This is the
strongest single guarantee that two GMs at level 30 are different GMs. It
should never rise, and no upgrade should ever grant a fifth slot.

**3. Growth outruns tools.** The tree's difficulty balance depends on the game
scaling *with* the player: 60 → 180 minutes, 15 → 28 wrestlers, 1 → 4
championships, 0 → 6 live commitments, plus the main event scene's politics and
the request queue's steady pressure. **A level 25 GM must have more problems
than a level 5 GM, not the same problems with better answers.** If a tier ever
adds tools without adding load, that is the moment this system stops working —
regardless of how well any individual upgrade is balanced.

---

## Appendix: notes for whoever builds this

Not part of the design, but worth writing down while it's fresh.

**Two new systems.** Scouting (talent pool, reports, accuracy, calendar weeks,
developmental) and Negotiation (request queue, wants, intensity, deadlines,
commitments) are both greenfield. Each is a tier's worth of work on its own and
neither should be attempted as part of "build the skill tree."

**One removal.** Booking gates existing features. Any save past week 20 must be
granted every Booking upgrade at or below its GM level for free on migration,
and the release notes must say so plainly.

**One behaviour change to existing code.** `awardTrust()` currently promotes
the broadcast tier automatically when trust crosses a threshold. Under this
design it should mark the tier **available** and leave the promotion to a point
spend. Same for `slotsEarned()` in `model/titles.js`.

**Where the state lives.** A `state.gm` object — `{ level, xp, points, spent:
[], doctrines: [], excluded: [], capstones: [] }` — alongside `state.gmRecord`
rather than inside it. `gmRecord` is a record of what happened; `state.gm` is a
record of what you became. Keeping them apart means `authorityValue()` doesn't
have to know the tree exists.

**Unlock checks belong in the model.** `has(state, 'because-i-said-so')` in a
new `model/progression.js`, called from wherever the option is offered. The UI
must never decide whether an upgrade is owned, and `model/` must never import
from `ui/` — same boundary as everywhere else.

**Upgrades are ids, never strings.** `up_because_i_said_so`, consistent with
`w_3`, `si_12`, `th_2`. No display text in the save, same as the journal.

**XP is derived where it can be.** Most XP sources above are already events the
journal files. Where possible, compute the week's XP by walking the journal at
show end rather than incrementing a counter as things happen — one source of
truth, and it survives a migration.
