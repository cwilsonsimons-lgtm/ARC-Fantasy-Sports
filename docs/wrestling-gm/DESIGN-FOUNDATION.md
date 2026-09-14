# Wrestling GM RPG: Design Foundation

Status: foundation document. This supersedes all previous designs and implementations.
Scope: identity and core loop only. No feature design beyond what is written here.

The purpose of this document is to fix what the game *is* so that later work cannot
drift. Anything not in this document is not yet part of the game.

---

## 0. One-line identity

A wrestling RPG where you play the kayfabe General Manager of a weekly show, and the
roster is the game.

The backbone is WWE 2K GM Mode: build the roster, book the show, run the show, live
with the results, build to a monthly premium live event, repeat. The difference is that
in GM Mode the roster is inventory, and here the roster is twenty people who each
believe they should be the star, who remember how you treated them, and who will argue
with you about it.

---

## 1. The player's core fantasy

**You have total authority and almost no control.**

You can book anything. You cannot make anyone happy about it. Every decision you make
is simultaneously a piece of television and a message to every person on the roster,
all of whom are keeping score.

Three things follow from that, and they are the spine of the whole design:

**You are a character in the world, not a cursor.** The wrestlers have opinions about
you specifically. Your reputation lives in their heads as trust, resentment and
memories, not as a number on your dashboard. A wrestler who has been lied to twice
hears your next promise differently.

**You create conditions; the roster creates stories.** You choose who shares a ring,
who gets the time, who gets the belt, who gets ignored. What those choices turn into is
not yours to script. The satisfaction is watching a feud you did not plan become the
best thing on your show.

**The plan is always wrong by the end of the night.** Not catastrophically, usually.
But something always moves, and the pleasure is in adapting well rather than in
executing cleanly.

### What this fantasy is not

Naming these is the primary anti-drift device in this document.

- Not a booker sim where you write angles and outcomes. You make offers and the roster
  answers.
- Not a finance sim. Money exists to make people argue.
- Not a match-quality optimizer. Maximizing star ratings is a losing strategy if the
  locker room hates you.
- Not a story engine that narrates at you. The game gives you a world with opinions in
  it. The story is what you remember afterwards.

---

## 2. The minute-to-minute loop

The smallest unit of play, the thing the player does thousands of times:

**Incomplete information arrives. You spend something you do not have enough of. You
get a reaction that is partly legible. Your model of the roster updates.**

The three scarce things, always in tension:

| Scarce thing | What spends it |
|---|---|
| Show time | Match limits, promos, segments, walking between rooms during a broadcast |
| Attention | Being in one location means not being in the other eight |
| Goodwill | Every booking, every refusal you overrule, every segment you cut |

Goodwill is not a meter. It is the sum of what people think of you, and you can only
estimate it. That estimation problem is the game.

### The concrete moments

- **Choosing a room.** You are on the location screen. You pick where to be. Moving
  costs time and means you are not at Gorilla.
- **Having a short conversation.** Three or four exchanges, not a dialogue tree epic.
  You ask; they answer in a way colored by personality, mood, standing, and what they
  remember about you. Sometimes they decline to answer at all.
- **Reading a notification.** Something happened somewhere else. It reached you late.
  It may be secondhand. It may be shaded by whoever told you.
- **Watching a clock you do not control.** A match is running. You do not know when it
  ends. You are deciding what the rest of the night looks like while it happens.
- **Making a call with a cost on both sides.** Every fix during a live show takes
  something from someone. There is no free adjustment.

The defining texture: you never have the full picture, and the clock never stops.

---

## 3. The weekly loop

Five beats. The week always produces something to manage, even when nothing dramatic
happens.

**1. Aftermath.** Last week settles. Records and rankings update. Overnight, wrestlers
form opinions about what happened and file them as memories. Consequences arrive:
complaints, injury reports, someone who noticed they were left off the show, morale
shifts from wins and losses.

**2. Roster week.** Office and backstage time. You can talk to people, take meetings,
handle requests, scout, deal with contracts. You have far less time than roster, so
choosing who to ignore is a real decision, and being ignored is something wrestlers
notice and remember.

**3. Booking the card.** You build the show: segments in order, each one a match or a
promo or an angle, each with an assigned time limit, against a fixed broadcast budget.
Then you pitch it. Wrestlers respond. They accept, accept with resentment, push back,
or refuse outright with a stated reason. This is where "you can book anything, they do
not have to like it" actually bites, and it is the most important screen in the game.

**4. The live show.** The centerpiece. Matches resolve on their own schedule. Backstage
runs in parallel whether you are watching or not. You move between locations, you fill
or cut time, you react. Your card survives this beat about half intact.

**5. Fallout.** The show is graded: rating, crowd reaction, management's read on you.
Wrestlers grade it too, individually and selfishly. New grudges exist that did not
exist this morning. Which is beat 1 of next week.

The weekly loop's job is to teach the player to plan loosely.

---

## 4. The monthly premium live event loop

Three or four weeks of TV, then one PLE. The month is the unit in which promises come
due.

**The build creates expectations you did not explicitly make.** You do not declare
plans in a menu. You create expectations by booking: repeated competitive matches, a
win streak you keep feeding, a contender you keep spotlighting. The roster reads those
patterns and forms beliefs about what the PLE card should be. So does the audience.

**The PLE is where the record gets cashed.** Longer show, bigger time budget, higher
stakes. Wins and losses count for more. Championships are expected to be defended and
can change hands. A wrestler's PLE placement is the single loudest statement you make
about their worth all month.

**The card the roster expects and the card you book are rarely identical.** That gap is
the central drama of the format. Rankings are public in-world. If the number one
contender is in the opening match, everyone can see it, and the people who can see it
include his allies.

**Management grades the month, not the night.** A single bad show is survivable. A
month that fails to build to anything is not.

**The aftershock reshuffles everything.** Title changes rewrite the rankings and create
new contenders overnight. Whoever lost big wants a rematch or wants out. Contract
conversations spike because people just watched where they stand. The month after a PLE
starts from a genuinely different roster state than the month before.

---

## 5. The wrestler RPG model, at a high level

Six layers per wrestler. Nothing here is a new system; it is an organization of what
the game is about.

**Identity (stable).** Personality traits, ego, ambition. This is the lens through
which the wrestler interprets everything. It barely changes, and it is what makes two
wrestlers in identical situations behave differently.

**Ability (slow-moving).** A deliberately small performance stat set: in-ring work,
charisma and mic, durability, star power. Kept small on purpose. This is the minimum
needed to run a match and no more. Resist growing it.

**Standing (public, earned).** Wins and losses, current streak, ranking, championships
held and lost, career status from rookie through jobber, midcard, main event, veteran,
declining. This is the public record, and it is the vocabulary every argument is made
in.

**State (fast-moving).** Morale, momentum, health and fatigue, current mood. This is
what the recent past did to them.

**Ties (relational).** A relationship value and a shared history with each other
wrestler, from which allies and enemies emerge rather than being declared. Separately, a
relationship with the GM, held as trust and respect, which are not the same thing and
can diverge sharply.

**Memory (the engine).** A list of remembered events: what happened, who did it, how it
felt, how much it still matters. Memory decays but does not vanish, and large events
scar permanently.

### The two rules that make this work

**Memory is what turns stats into character.** A wrestler's reaction to a booking is
not computed from morale alone. It is computed from morale plus what they remember, and
when they push back they cite the memory out loud. "You told me I was next in line in
July" is the difference between an RPG and a spreadsheet.

**Every wrestler runs the same evaluation, and personality only changes the weights.**
There is one function that answers "how do I feel about this?" for every ask in the
game. A rookie and a main-eventer run identical logic and land in completely different
places because their egos, ambitions and standings weight the inputs differently. This
is both believable and buildable, and it is why a jobber accepts nearly anything while a
top star refuses a match he considers beneath him or needlessly risky.

### The accept-or-refuse check

Every ask, whether a match, a partner, a loss, a time slot or a spot on the card, is
evaluated against roughly:

- Is this beneath my standing?
- Is this dangerous to me?
- Does this serve or block my ambition?
- Do I trust this GM, and what do I remember?
- What is my mood right now?

The output is one of: accept, accept resentfully, push back and negotiate, or refuse.
Refusals always carry a stated reason, and that reason is always something the player
could have anticipated from visible or discoverable state.

---

## 6. How RNG interacts with stats and personality

The philosophy in one line: **RNG chooses from a menu the world wrote.**

Randomness never decides what kind of thing happens. It decides which of the currently
plausible things happens, and how hard. Four stages, applied to every uncertain event in
the game, from match finishes to backstage incidents to conversation reactions:

**1. Eligibility.** State decides what is even possible. A loyal ally with high trust is
not in the betrayal draw at all. A wrestler with no grievance cannot storm out. This
stage is what prevents random nonsense.

**2. Weighting.** Stats, personality, standing and memory set the odds among eligible
outcomes. Nothing in the game is ever a flat coin flip.

**3. The roll.** RNG picks. This is the only place true randomness enters.

**4. The receipt.** The game can always say which state caused it. Legibility after the
fact is mandatory. The player should be able to look at any surprise and say "of course,
because of that."

### The shaping rule

**State sets the center of the distribution. Personality sets its width. RNG draws.
Memory explains.**

A volatile wrestler has a wide range of plausible reactions to the same news, so you
genuinely cannot predict him. A consummate professional has a narrow one, so you can.
Both are running the same math.

### Two consequences worth stating

**Variance is banded by competence, not uniform.** A great wrestler's floor is higher
than a rookie's ceiling in most circumstances. Upsets happen through a narrow tail and
specific circumstances, not through a coin flip, which is exactly what makes them mean
something.

**Rare events require a cause on record.** There is no random heel turn. A betrayal
requires accumulated grievance. A walkout requires a history of being ignored. RNG can
surprise the player, but it can never surprise them without a receipt.

---

## 7. The live backstage system, at a high level

**Space.** The backstage is a small graph of rooms you move between from a location
screen: Gorilla Position, GM Office, Locker Room, Hallways, Medical, Interview Area,
Production, Catering, Parking and Loading. Occupying a room is a choice with a cost. You
are not in the other eight, and moving burns show clock.

**The show simulates everywhere at once.** Incidents seed in rooms based on who is
present and what they brought with them: grudges, disappointment about the card,
contract anxiety, an injury, someone who just lost. Events do not wait for the player to
arrive.

**Information is a separate system from events.** This is the central design idea of the
whole backstage layer. An event happening and you knowing about it are two different
things. Every event has a discovery profile: who witnessed it, whether those people
would tell you, how long it takes to reach you, and how distorted it is on arrival. In
the room, you get it raw and immediately. Two corridors away, you get a version, later,
from someone with their own agenda.

Reports can be late, partial, secondhand, or simply wrong.

**Unattended problems escalate on a timer.** Stages, not a cliff. A tense exchange
becomes an argument becomes a shouting match becomes someone refusing to go out.
Escalation damages locker-room morale, specific relationships, trust in you,
management's confidence, and the show itself. The core tension of the format is that the
thing that needs you is never where you are.

**Intervening costs something.** You leave Gorilla and the broadcast runs without your
attention. Conflict management skill determines how well an intervention lands.

**Backstage material can be promoted to television.** Turning a real problem into
content is the pressure release valve, and it should be the most satisfying move in the
game: the night is falling apart, and you put the falling apart on camera and it rates.

**Almost every show has some chaos, and most of it is small.** The floor is friction,
not crisis. There is always something to manage. When nothing is wrong, the roster is
still there to talk to, and talking to them is how you find out what is about to be
wrong.

**The awareness upgrade improves the report stream, never the events.** Backstage
awareness makes information faster, more accurate and broader in coverage. It does not
make the world calmer.

You are managing a fog of war made of people.

---

## 8. How matches and time limits work

**The GM assigns a time limit, not a duration.** The limit is a container. The
simulation decides the contents. "Singles match, fifteen minute limit" is an
instruction about the maximum, not a prediction.

**The simulation runs the match in beats.** Each beat can produce a finish attempt whose
success depends on the wrestlers' stats, current momentum, condition and fatigue, their
chemistry, the match circumstances, and RNG, filtered through the four-stage model in
section 6. So the finish arrives when it arrives. A fifteen minute limit can end at
ninety seconds, at seven minutes, at fourteen, or run the full distance to a time-limit
draw.

**The limit is itself a message to the wrestler.** This is the connection between the
timing system and the RPG, and it matters as much as the sim. A main-eventer given six
minutes is insulted. A rookie given twenty knows he is being exposed. Wrestlers evaluate
the time they are given exactly as they evaluate the opponent and the result.

**Time-limit draws are real outcomes with real consequences.** Nothing resolved, both
men with a case, rankings unmoved, rematch pressure created, and two wrestlers with
opinions about whether that was fair to them.

**The show clock is the real resource.** Booked limits are a budget. Actual runtimes are
the spend. The variance between them is the game. If a fifteen minute match ends in two,
you have thirteen minutes of television to fill right now. If everything runs long, you
are cutting.

**The live levers**, each with a cost attached:

- Extend a later match's limit. Changes what those wrestlers think you think of them.
- Give a promo more time. Requires someone who can actually carry it.
- Add an impromptu segment. Needs a willing participant on short notice.
- Add an impromptu match. Needs two healthy people willing to work unplanned.
- Cut or move something. Insults whoever was in it, and they find out.
- Put a backstage situation on television. Cheap, effective, and not always wise.

Every fix costs goodwill somewhere. That is what keeps the timing problem from being a
puzzle and makes it an RPG problem instead.

**Fatigue and risk scale with time.** Long matches raise the quality ceiling for capable
workers and raise injury and fatigue risk for everyone. A veteran with durability
problems given a twenty minute limit is a decision with consequences.

**The result override.** The player can force a specific result when they absolutely
want it. It is an honest tool, not a cheat, and it carries no in-world penalty. It
should be deliberate and confirmed rather than a casual dropdown, because it is the one
place where the fiction of "I do not control outcomes" is suspended by choice. Overrides
are recorded in the save. If the player does not override, they live with what happens.

---

## 9. How rankings, championships and records create motivation

This is the engine that makes the roster generate stories without a story system.

**The record is public, permanent, and quoted.** Wins, losses, streaks. Wrestlers know
their own numbers and everyone else's, and the record is the language every argument in
the game is made in.

**Rankings are derived, visible in-world, and create entitlement.** A wrestler knows he
is ranked third. Knowing it is what makes him believe things are owed to him.

**The mechanism, in one sentence: every wrestler continuously compares what the record
says they deserve against what they are actually getting, and the gap is the
grievance.** Expected treatment is computed from standing, that is rank, streak, title
history and career status, then filtered through ego, which inflates the expectation, and
ambition, which determines whether they act on it. A humble veteran and an insecure
midcarder with identical records want very different things.

That is the whole motivation system. Six straight wins and a title shot handed to
someone ranked below him is not a scripted event. It is a wrestler noticing a gap and
having the ego and ambition to come find you about it.

**Championships sit at the top of everything.** Holding one changes status, expectations
and how much of a target you are. Every ranked wrestler carries a title ambition with an
urgency attached. Losing a belt creates one of the strongest memories in the game and
reshapes the holder's behavior for months.

**Ignoring the record escalates, in order:** private complaint, confrontation, morale
collapse, sympathy shift as their allies take their side, refusal to work as booked,
contract leverage, departure. The player always gets warnings before the expensive
consequences.

**And the counterweight, which is the player's real strategy: trust is what lets you
book against the rankings.** You can explain a decision. You can promise a future spot.
You can ask someone to take a loss for a reason. Whether that works depends entirely on
whether you have kept your word before. A GM with a history of honoring promises can
book almost anything. A GM who has burned people twice cannot book a clean squash
without a fight.

Booking with the rankings is safe and dull. Booking against them is where the stories
are. The game should make that trade honestly available.

---

## 10. How budget and contracts support the drama without becoming the focus

**The governing principle: money is only ever a conversation topic.**

Every financial fact reaches the player through a person, not a spreadsheet. You do not
discover your payroll is lopsided by opening a report. You discover it because a
wrestler found out what his opponent makes and came to your office about it.

**Keep the numbers coarse.** One monthly budget. A payroll total. Round salary figures
so comparison is easy and arithmetic is not a skill. No line-item accounting, no
revenue optimization, no merchandise or ticketing minigame. Income trends with your show
ratings and that is the entire connection between doing well and having money.

**Contracts carry only what creates drama.** Salary and expiry are enough for
everything below. Resist adding fields.

**The five drama hooks, and their mechanisms:**

- **Wrestlers compare salaries.** Salary knowledge spreads through the locker room using
  the same information system as backstage events in section 7. Who knows what, how
  accurately, and how fast. No new system required.
- **Successful wrestlers demand raises.** A wrestler whose standing has outgrown his pay
  files an ask. It is a conversation with a deadline, not a form.
- **Someone threatens to leave.** This is the escalation endpoint of unresolved
  grievance from section 9, not a separate mechanic. Money is often the excuse rather
  than the cause.
- **A wrestler nearing free agency demands a push.** Expiry is a clock that makes
  ambition urgent and gives the wrestler leverage he knows he has.
- **Stars versus depth.** The budget is tight enough that one big signing costs you three
  midcarders, and roster capacity from GM level makes the choice bite twice.

**The guardrail: if a player can win this game by being good at money, the design is
broken.** Money must only ever shape who is available to you and who is unhappy with
you. It never becomes the thing being optimized.

---

## 11. How GM progression works, at a high level

Two separate tracks, deliberately kept separate.

### GM Level: automatic, and represents company trust

Earned through experience. Nothing here is purchased, because these are things the
company decides about you rather than skills you train.

- Roster capacity increases at certain levels, for example a bump at level 5. Higher
  levels mean the company trusts you with a larger operation.
- Budget size grows.
- Show length and format permissions expand.
- Venue and PLE scale increase.

Roster capacity is explicitly not in the skill tree.

### Skill tree: purchased, and changes how systems behave for you

Nine branches, matching the domains that already exist in the game. One line each, and
this list should not grow:

| Branch | What it changes |
|---|---|
| Authority | Wrestlers more willing to accept bookings; refusals cost you less |
| Communication | Conversations land better; explanations are believed |
| Negotiation | Raises, re-signings, talking someone down |
| Production | Segment quality, more live levers, smaller penalty for dead air |
| Scouting | See hidden ability and potential; evaluate free agents and prospects |
| Contracts | Better terms available, cheaper deals, cleaner exits |
| Backstage awareness | Information speed, accuracy and coverage |
| Corporate influence | Management patience, budget flexibility, survive a bad month |
| Conflict management | De-escalate incidents, mediate grudges, salvage relationships |

**The rule that keeps the tree honest: skills change the texture of your interactions,
never the outcomes directly.** Better information, better odds in a conversation, more
time, more leverage. Never "your matches are rated higher."

### Experience comes from the things the game is about

Show ratings, making new stars, producing rivalries that land, surviving crises well,
PLE performance, keeping management's support. You level up by making good television
and handling people well. There is nothing to grind.

### The long arc

Across seasons, the goals are the ones already stated: the highest-rated show, real
stars you created, great rivalries, enough management support to keep the job, fan
popularity, and eventually a Hall of Fame level GM legacy. The legacy is a record of the
stars you made and the stories that happened on your watch, not a high score.

---

## 12. What the first playable prototype should contain

The prototype exists to test one question: **do the wrestlers feel like people with
opinions, and does the live clock force real adaptation?** Everything that does not
serve that question is cut, including things this document has already specified.

### In

**Roster.** Around fourteen wrestlers, hand-authored, spread across career tiers: two
main event, four upper midcard, four midcard, four lower card and rookies. Every one
carries the full six-layer model from section 5, including starting relationships and
starting memories, so the locker room is interesting on week one.

**Mode.** One brand. Solo sandbox. No competing GM.

**Length.** Six to eight consecutive weekly shows. No PLE yet. Long enough for a rivalry
to form on its own.

**Booking screen.** Five or six segments. Singles matches, one tag match, promos. An
assigned time limit on each. A fixed broadcast budget, for example sixty minutes of
television with forty-five minutes of usable content.

**The pitch step.** The single most important feature in the prototype. When you book
someone, they answer: accept, accept resentfully, push back, or refuse with a stated
reason. If this beat is not compelling, nothing else in the design matters.

**Match simulation.** Minute by minute, finish check per beat, time-limit draws, a
result, a rough quality rating, and fatigue with a small injury chance. A readable beat
log, no commentary engine.

**The live show.** The clock runs. Surplus and deficit are always visible. Four levers
only: extend a later limit, extend a promo, add an impromptu segment, cut something.

**Backstage.** Four locations: Gorilla Position, GM Office, Locker Room, Medical.
Incidents seed and escalate in stages. Notifications arrive delayed and occasionally
distorted. You can walk over and intervene, at the cost of not being at Gorilla.

**Conversations.** Four question types: what do you think of this wrestler, how do you
feel about your role, do you want a match with this person, do you know anything about
the locker room situation. Answers colored by state. Refusal to talk is possible.

**Records and rankings.** Win and loss records, streaks, one ranked list, one
championship. That is enough for entitlement to exist, which is enough for section 9 to
run.

**Memory log, visible to the player.** Cheap to build and it is the debugging window for
the entire design. If you can read a wrestler's memories and his behavior does not
follow from them, the sim is wrong and you can see exactly where.

**The result override,** with a confirmation step.

### Explicitly out of the prototype

Contracts and salaries. Budget. The skill tree. GM levels and roster capacity. PLEs.
Competing brands. Free agency and signings. Scouting and hidden stats. Tag team
formation beyond a single booked pairing. The other five backstage locations. Multi-
season play. Anything cosmetic.

All of these are in the design. None of them are in the prototype. They get added only
after the core question above is answered yes.

### Success criteria

After eight weeks of play, the prototype passes if all four of these are true:

1. The player can describe a story that emerged which they did not plan.
2. At least one rivalry formed from wrestler behavior rather than player selection.
3. The player was refused at least once and had to change their plans.
4. A match ended at a time the player did not expect and forced a live scramble.

If those four are not happening, the core is wrong, and no quantity of additional
features will fix it. That is the whole reason to build the prototype in this shape.

---

## 13. Guardrails for every future feature

Any proposed addition must pass all six of these, or it does not go in. This section
exists because the previous version drifted.

1. **Does it give the roster more to have opinions about?** If it adds systems the
   wrestlers do not care about, cut it.
2. **Does it arrive through a person?** Information the player reads off a panel with no
   human attached is a last resort, not a default.
3. **Can the player still be surprised by it, and still understand the surprise
   afterwards?** Both halves are required.
4. **Does it make the plan more fragile or less?** Features that make the week more
   predictable are working against the game.
5. **Is it optimizable in isolation?** If a player can get good at this subsystem
   without getting good at managing people, it is the wrong subsystem.
6. **Would cutting it make the game less about being a GM?** If not, cut it.
