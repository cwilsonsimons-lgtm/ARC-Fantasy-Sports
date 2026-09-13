// Every upgrade the GM can buy, and the seven branches they sit in.
//
// This is the catalogue, not the rules — nothing in here runs. `built: true`
// marks an upgrade the game actually honours somewhere; everything else sits on
// the board greyed out, because a tree you cannot see the end of is not a tree,
// it is a list. The full design lives in docs/gm-progression.md and this file
// is generated from it: when the two disagree, this file is wrong.
//
// The three gates are deliberately different numbers. `level` is competence and
// time served. `trust` is the network's opinion of the show — the same figure
// model/network.js moves. `standing` is head office's opinion of how the
// building is run, which is bossView() and not the same thing at all. A GM can
// be Trusted and badly regarded at once: good television out of a building
// nobody is in charge of.

export const BRANCHES = [
  { id: 'authority',   name: 'Authority',   colour: '#e4574c',
    question: 'Will they do what you say?' },
  { id: 'locker',      name: 'Locker Room', colour: '#3fc77f',
    question: 'Do they want to work for you?' },
  { id: 'booking',     name: 'Booking',     colour: '#4f9fe8',
    question: 'What can you put on television?' },
  { id: 'production',  name: 'Production',  colour: '#e0a83c',
    question: 'Can you run the show live?' },
  { id: 'corporate',   name: 'Corporate',   colour: '#8aa0bd',
    question: 'How much rope do they give you?' },
  { id: 'scouting',    name: 'Scouting',    colour: '#3fb8b0',
    question: 'Who is out there, and who is in your building?' },
  { id: 'negotiation', name: 'Negotiation', colour: '#c2679a',
    question: 'What do they want, and what will you trade?' },
];

// Read bottom to top on the board: cheap verbs at the bottom, the four capstone
// slots at the top.
export const TIERS = [
  { id: 'Foundation',  label: 'Foundation',  levels: '1-5' },
  { id: 'Working',     label: 'Working',     levels: '6-12' },
  { id: 'Established', label: 'Established', levels: '13-19' },
  { id: 'Capstones',   label: 'Legacy',      levels: '20-30' },
];

// Trust is stored as a number and shown as a word, the same way morale is.
export const TRUST_BANDS = [
  [75, 'Untouchable'], [58, 'Backed'], [42, 'Trusted'], [34, 'Strong'],
  [27, 'Good'], [22, 'Solid'], [15, 'Fine'], [6, 'Noted'], [0, 'Provisional'],
];

export const STANDING_NEEDED = {
  'Plain or better': 40,
  'Fine or better': 56,
  'In Hand': 72,
};

export const UPGRADES = [
  {
    id: 'line-in-the-sand',
    name: 'Line In The Sand',
    branch: 'authority', tier: 'Foundation',
    cost: 1, level: 1,
    excludes: ['cold-open'],
    hook: 'declare a rule and be held to it',
    effect: 'New pre-show action. Any incident that breaks a declared rule is '
      + 'raised one severity step. Ruling harshly on a declared breach is '
      + 'recorded as fair rather than harsh. Rules you declare and then fail to '
      + 'enforce are recorded as weak at double weight.',
  },
  {
    id: 'send-word',
    name: 'Send Word',
    branch: 'authority', tier: 'Foundation',
    cost: 1, level: 2,
    hook: 'rule on a room you are not standing in',
    effect: 'New action, 1 minute. Issue any ruling to an incident in a room '
      + 'you can\'t reach in time. The ruling lands one proportionality step '
      + 'weaker (fair becomes weak, harsh becomes fair), you do not witness the '
      + 'reaction, and you get no presence XP for it.',
  },
  {
    id: 'hold-that-thought',
    name: 'Hold That Thought',
    branch: 'authority', tier: 'Foundation',
    cost: 2, level: 3,
    requires: ['line-in-the-sand'],
    hook: 'make "later" mean something',
    effect: 'Deal with it later now asks you to name a room and a minute. The '
      + 'incident resurfaces there, at full severity, and both parties are '
      + 'present. Missing your own appointment records delayed twice.',
  },
  {
    id: 'paper-trail',
    name: 'Paper Trail',
    branch: 'authority', tier: 'Foundation',
    cost: 1, level: 4,
    excludes: ['the-handshake-deal'],
    hook: 'warnings that accumulate',
    effect: 'Formal warnings are now counted per wrestler and shown on their '
      + 'card. A second warning unlocks the suspension responses one step earlier '
      + 'for that wrestler. A third makes Dismissal available against them, if '
      + 'you have it.',
    built: true,
  },
  {
    id: 'read-the-room',
    name: 'Read The Room',
    branch: 'authority', tier: 'Foundation',
    cost: 2, level: 4,
    hook: 'see the call before you make it',
    effect: 'Response buttons show the likely locker-room reading (fair / '
      + 'harsh / weak) before you commit. The reading is wrong about a fifth of '
      + 'the time, and wrong more often for wrestlers whose traits you have never '
      + 'had revealed and in rooms where you have spent little time. It is a '
      + 'hint, not a preview.',
    built: true,
  },
  {
    id: 'because-i-said-so',
    name: 'Because I Said So',
    branch: 'authority', tier: 'Working',
    cost: 3, level: 6,
    standing: 'Plain or better',
    requires: ['paper-trail'],
    doctrine: 'The Hand',
    hook: 'force it through',
    effect: 'Once per show, override a refusal to wrestle or to appear. The '
      + 'wrestler goes out. Consequences: a permanent grudge memory at heavy '
      + 'weight, and if they lose the match they were forced into, the grudge '
      + 'doubles. Using it a second time on the same wrestler inside a month puts '
      + 'them at real risk of walking out of the building. Recorded as harsh.',
  },
  {
    id: 'make-an-example',
    name: 'Make An Example',
    branch: 'authority', tier: 'Working',
    cost: 2, level: 7,
    requires: ['line-in-the-sand'],
    doctrine: 'The Hand',
    hook: 'rule in front of everyone',
    effect: 'New modifier on any ruling. Costs 4 minutes to gather. The '
      + 'ruling\'s effect on locker-room opinion applies to every wrestler '
      + 'present, not just the parties — in both directions. A fair call in front '
      + 'of twelve people is the strongest authority move in the game. A harsh '
      + 'one in front of twelve people is the strongest resentment move in the '
      + 'game.',
  },
  {
    id: 'security-on-retainer',
    name: 'Security On Retainer',
    branch: 'authority', tier: 'Working',
    cost: 2, level: 8,
    excludes: ['locker-room-sources'],
    hook: 'a third body, and a post',
    effect: 'SECURITY_STAFF 2 → 3. New pre-show action: post one guard at a '
      + 'location for the night. Incidents originating in that room resolve one '
      + 'severity step lower before you ever hear about them — and you do not '
      + 'hear about them. The room goes quiet and goes dark.',
  },
  {
    id: 'suspension-with-cause',
    name: 'Suspension With Cause',
    branch: 'authority', tier: 'Working',
    cost: 2, level: 9,
    requires: ['paper-trail'],
    hook: 'a way back in',
    effect: 'Any suspension can carry one condition: apologise to a named '
      + 'wrestler, work a dark match, drop a title. The wrestler returns when the '
      + 'condition is met rather than when the clock runs out. Conditions can be '
      + 'refused, and a refused condition converts the suspension to indefinite. '
      + 'The locker room reads a conditional suspension as fair where a flat one '
      + 'of the same length reads harsh.',
  },
  {
    id: 'chain-of-command',
    name: 'Chain Of Command',
    branch: 'authority', tier: 'Working',
    cost: 3, level: 10,
    excludes: ['the-open-door'],
    hook: 'delegate the small stuff',
    effect: 'Appoint a locker-room leader. Minor and moderate incidents in '
      + 'rooms you are not in are ruled on by them automatically. They rule the '
      + 'way they would, not the way you would — a hot-headed deputy rules harsh, '
      + 'a peacemaker rules weak — and every one of those rulings goes on your '
      + 'record. You can change deputy once a month; the outgoing one takes it '
      + 'personally.',
  },
  {
    id: 'the-open-door',
    name: 'The Open Door',
    branch: 'authority', tier: 'Working',
    cost: 2, level: 10,
    excludes: ['chain-of-command'],
    hook: 'be reachable',
    effect: 'Wrestlers storming into your office arrive with their demand '
      + 'legible — you see what they want and what they\'d settle for before you '
      + 'answer. Additionally, any wrestler anywhere in the building can choose '
      + 'to come to you instead of erupting where they stand, which converts some '
      + 'incidents into conversations. The cost: your office is never empty, and '
      + 'time spent there is time not spent anywhere else.',
  },
  {
    id: 'reinstatement-terms',
    name: 'Reinstatement Terms',
    branch: 'authority', tier: 'Established',
    cost: 2, level: 13,
    requires: ['suspension-with-cause'],
    hook: 'bring them back on your terms',
    effect: 'An indefinitely suspended wrestler can be reinstated with a '
      + 'negotiated term attached (a loss to a named opponent, a period without '
      + 'television, a public apology). Reinstating without terms is recorded as '
      + 'gaveIn; reinstating with them is recorded as fair.',
  },
  {
    id: 'the-long-memory',
    name: 'The Long Memory',
    branch: 'authority', tier: 'Established',
    cost: 3, level: 15,
    requires: ['read-the-room'],
    hook: 'cite the record',
    effect: 'When ruling, you may cite up to two past incidents involving the '
      + 'same wrestler. Citing raises the effective severity of the current '
      + 'incident, which unlocks harsher responses without those responses '
      + 'reading as disproportionate. Citing something the locker room considers '
      + 'settled — an incident already ruled on fairly, or older than about ten '
      + 'weeks — backfires and records harsh.',
  },
  {
    id: 'dismissal',
    name: 'Dismissal',
    branch: 'authority', tier: 'Established',
    cost: 3, level: 17,
    trust: 'Good',
    standing: 'Fine or better',
    requires: ['paper-trail', 'suspension-with-cause'],
    doctrine: 'The Hand',
    hook: 'the last one',
    effect: 'Release a wrestler permanently. Requires three formal warnings '
      + 'on their file, or one critical incident. The roster does not forget: '
      + 'dismissal files a heavy memory with every wrestler who was close to '
      + 'them, and the executive review notes it for four weeks. Wrestlers you '
      + 'dismiss can turn up on a rival promotion\'s roster later, if Scouting is '
      + 'developed.',
  },
  {
    id: 'final-say',
    name: 'Final Say',
    branch: 'authority', tier: 'Capstones',
    cost: 5, level: 20,
    standing: 'In Hand',
    requires: ['because-i-said-so', 'the-long-memory'],
    doctrine: 'The Hand',
    hook: 'nobody walks out on you',
    effect: 'Once per month, a wrestler who has walked out of the building '
      + 'can be recalled. They come back, and they are available for one segment '
      + 'tonight, and they will do what you booked. It is recorded as harsh '
      + 'whether or not the segment goes well, and the wrestler\'s grudge against '
      + 'you never fully fades — coolGrudges() does not touch it. A recalled '
      + 'wrestler who is recalled again inside a season leaves the promotion.',
  },
  {
    id: 'the-building-is-mine',
    name: 'The Building Is Mine',
    branch: 'authority', tier: 'Capstones',
    cost: 5, level: 24,
    trust: 'Trusted',
    requires: ['chain-of-command', 'the-open-door'],
    hook: 'you hear about everything',
    effect: 'Every incident anywhere in the building is reported to you the '
      + 'moment it starts, with location and parties, regardless of where you '
      + 'are. The cost is accountability: an incident you were told about and did '
      + 'not attend is now recorded as ignored, not missed. missed effectively '
      + 'stops existing for you. You wanted to know.',
  },
  {
    id: 'know-your-locker-room',
    name: 'Know Your Locker Room',
    branch: 'locker', tier: 'Foundation',
    cost: 1, level: 1,
    hook: 'read the room, one person at a time',
    effect: 'Every wrestler\'s card gains a line naming their strongest '
      + 'current memory in plain words — "still angry about the Kestrel finish", '
      + '"hasn\'t forgotten you backed him against Vance." Demeanour, not digits: '
      + 'no number, no bar. Memories weaker than a threshold don\'t show, so a '
      + 'settled wrestler shows nothing, which is itself information.',
    built: true,
  },
  {
    id: 'open-door-hours',
    name: 'Open Door Hours',
    branch: 'locker', tier: 'Foundation',
    cost: 1, level: 2,
    hook: 'five minutes before doors',
    effect: 'New pre-show action costing 5 minutes off the top. Up to two '
      + 'wrestlers with live grievances present them as conversations rather than '
      + 'erupting later in the night. Which two is decided by grievance weight, '
      + 'not by you — you don\'t get to pick who walks in.',
  },
  {
    id: 'read-the-grudge',
    name: 'Read The Grudge',
    branch: 'locker', tier: 'Foundation',
    cost: 2, level: 3,
    requires: ['know-your-locker-room'],
    hook: 'what it\'s actually about',
    effect: 'Grudges shown on a wrestler\'s card name their source and target: '
      + 'which of the seven memory sources it came from (opportunity, airtime, '
      + 'result, title, gm, ally, peer) and who it\'s aimed at. A grudge aimed at '
      + 'another wrestler and a grudge aimed at you look identical without this.',
    built: true,
  },
  {
    id: 'private-meeting',
    name: 'Private Meeting',
    branch: 'locker', tier: 'Foundation',
    cost: 2, level: 4,
    hook: 'somewhere that isn\'t your office',
    effect: 'New action, 4 minutes, available in any room. The wrestler '
      + 'states what they actually want, in one sentence, honestly — which is not '
      + 'always what they\'ve been complaining about. Available once per wrestler '
      + 'per week. A meeting held in your office instead gets you the complaint, '
      + 'not the want.',
  },
  {
    id: 'promise-them-something',
    name: 'Promise Them Something',
    branch: 'locker', tier: 'Foundation',
    cost: 2, level: 5,
    hook: 'put it on the record',
    effect: 'New response, available in most conversations and most '
      + 'incidents. Record a specific commitment: a match, an opponent, a title '
      + 'shot, a partner, a minimum of airtime, a night off. The game tracks it '
      + 'with a deadline. Keeping it files a strong positive memory and pays 40 '
      + 'XP; letting it lapse files a memory heavier than the one you would have '
      + 'got for simply refusing in the first place. Promising nothing is safer '
      + 'than promising badly.',
  },
  {
    id: 'the-pairing',
    name: 'The Pairing',
    branch: 'locker', tier: 'Working',
    cost: 1, level: 6,
    requires: ['know-your-locker-room'],
    hook: 'see how two people actually get on',
    effect: 'Select any two wrestlers to see their relationship in words: how '
      + 'often they\'ve worked, whether they\'ve teamed, whether either owes the '
      + 'other, and whether the warmth runs both ways. This is the information '
      + 'the tag-team gates in the Booking branch are checked against — without '
      + 'it you\'re guessing at whether a team is legal.',
  },
  {
    id: 'locker-room-sources',
    name: 'Locker Room Sources',
    branch: 'locker', tier: 'Working',
    cost: 2, level: 7,
    excludes: ['security-on-retainer'],
    hook: 'you hear things',
    effect: 'Incidents in rooms adjacent to yours are reported to you as they '
      + 'start, with parties named but not detail. You still have to walk there. '
      + 'This is the difference between arriving during and arriving after.',
  },
  {
    id: 'emergency-mediation',
    name: 'Emergency Mediation',
    branch: 'locker', tier: 'Working',
    cost: 3, level: 8,
    requires: ['private-meeting'],
    hook: 'mediate without both of them',
    effect: 'Bring them both in loses its needsTwo requirement. Mediating '
      + 'with one party present costs the same minutes and lands at reduced '
      + 'strength — the absent party accepts the outcome but files a small memory '
      + 'about not having been asked. Mediating with neither present is possible '
      + 'in an emergency and holds only until the end of the night.',
  },
  {
    id: 'veteran-s-word',
    name: 'Veteran\'s Word',
    branch: 'locker', tier: 'Working',
    cost: 2, level: 10,
    requires: ['the-pairing'],
    doctrine: 'The Ear',
    hook: 'send someone who isn\'t you',
    effect: 'New action, 1 minute. Ask a high-standing veteran to handle an '
      + 'incident on your behalf. They may refuse — the more it costs them '
      + 'socially, the more likely they refuse. If they do it, it resolves as '
      + 'fair, you spend no walk, and they are now owed a favour by you, which '
      + 'will be called in as a request you\'d rather not grant.',
  },
  {
    id: 'cool-it-down',
    name: 'Cool It Down',
    branch: 'locker', tier: 'Working',
    cost: 2, level: 11,
    requires: ['private-meeting'],
    hook: 'a night off that isn\'t a punishment',
    effect: 'One wrestler per week can be stood down with their consent — '
      + 'they are asked, and a wrestler in a hot streak or chasing a title will '
      + 'say no. A consented stand-down files no negative memory and lets grudges '
      + 'cool at roughly twice the normal rate. It costs you a body on the card.',
  },
  {
    id: 'apology-brokered',
    name: 'Apology Brokered',
    branch: 'locker', tier: 'Established',
    cost: 3, level: 13,
    requires: ['emergency-mediation'],
    doctrine: 'The Ear',
    hook: 'make them shake hands',
    effect: 'New action against a live feud thread, 6 minutes, both parties '
      + 'required. On success the thread\'s heat drops sharply and both file a '
      + 'positive memory about you. On failure it is public — the refusing '
      + 'party\'s grudge against the other hardens permanently, and every witness '
      + 'sees the GM\'s authority publicly declined. Success chance reads off both '
      + 'wrestlers\' traits and the thread\'s peak heat; a thread at feud level '
      + 'will usually refuse.',
  },
  {
    id: 'faction-summit',
    name: 'Faction Summit',
    branch: 'locker', tier: 'Established',
    cost: 3, level: 15,
    requires: ['the-pairing'],
    hook: 'the whole group at once',
    effect: 'New action, 8 minutes. Address an entire faction as a unit: hear '
      + 'their collective grievance, and make one ruling that lands on all of '
      + 'them. A faction handled as a faction responds far better than four '
      + 'wrestlers handled individually. A faction ruled against as a unit '
      + 'responds far worse.',
  },
  {
    id: 'speak-for-them',
    name: 'Speak For Them',
    branch: 'locker', tier: 'Established',
    cost: 2, level: 16,
    requires: ['emergency-mediation'],
    hook: 'a wrestler can argue somebody else\'s case',
    effect: 'In any mediation or dispute, a wrestler with a tie to one of the '
      + 'parties may attend in their place. Their argument carries the weight of '
      + 'their own standing, not the absent party\'s. This lets you resolve '
      + 'incidents involving wrestlers who refuse to be in the same room as you — '
      + 'and it means a popular wrestler can start speaking for people you would '
      + 'rather deal with directly.',
  },
  {
    id: 'nobody-quits-on-me',
    name: 'Nobody Quits On Me',
    branch: 'locker', tier: 'Capstones',
    cost: 4, level: 19,
    requires: ['private-meeting', 'emergency-mediation'],
    doctrine: 'The Ear',
    hook: 'they come to you first',
    effect: 'A wrestler about to walk out of the building comes to your '
      + 'office first and tells you they\'re leaving. You get one conversation. '
      + 'The conditions are real: you must be in your office or able to reach it '
      + 'inside the minutes they\'ll wait, and the conversation costs 5 minutes '
      + 'you may not have during a live show. If you\'re at Gorilla with nine '
      + 'minutes of television left, they will wait, and then they will go.',
  },
  {
    id: 'they-d-run-through-a-wall',
    name: 'They\'d Run Through A Wall',
    branch: 'locker', tier: 'Capstones',
    cost: 5, level: 23,
    requires: ['apology-brokered', 'faction-summit'],
    doctrine: 'The Ear',
    hook: 'call in everything at once',
    effect: 'Once per season. Every bookable wrestler accepts their booking '
      + 'this week without refusal, without negotiation, regardless of grudge, '
      + 'opponent or result. Nobody says no. The cost is the mechanic: every '
      + 'wrestler who complied files a debt against you. For the following four '
      + 'weeks, incoming requests arrive at heavier weight, refusals of those '
      + 'requests land as weak rather than neutral, and any promise you break in '
      + 'that window costs double. You have spent the locker room\'s goodwill in '
      + 'one night and you will spend a month paying it back.',
  },
  {
    id: 'tag-team-wrestling',
    name: 'Tag Team Wrestling',
    branch: 'booking', tier: 'Foundation',
    cost: 1, level: 1,
    hook: 'two on two',
    effect: 'Unlocks sides: [2,2]. Both members of a side must have closeness '
      + '≥ 10. Teaming builds teamed on the relationship, which is the fastest '
      + 'legal route to a tie forming.',
    built: true,
  },
  {
    id: 'triple-threat',
    name: 'Triple Threat',
    branch: 'booking', tier: 'Foundation',
    cost: 1, level: 2,
    hook: 'three sides, one fall',
    effect: 'Unlocks sides: [1,1,1]. Introduces the fall rule: decideFall() '
      + 'picks which side eats the loss, and the third side records no defeat at '
      + 'all. The tutorial text should say this out loud.',
    built: true,
  },
  {
    id: 'stipulation-submission-match',
    name: 'Stipulation: Submission Match',
    branch: 'booking', tier: 'Foundation',
    cost: 1, level: 3,
    hook: 'a finish with no count',
    effect: 'Unlocks the Submission match type (min 10 minutes). Increases '
      + 'the chance of the submission held too long post-match outcome, which is '
      + 'one of the game\'s best incident generators.',
    built: true,
  },
  {
    id: 'fatal-four-way',
    name: 'Fatal Four-Way',
    branch: 'booking', tier: 'Foundation',
    cost: 2, level: 4,
    requires: ['triple-threat'],
    hook: 'four sides',
    effect: 'Unlocks sides: [1,1,1,1]. Three of four wrestlers take no loss.',
    built: true,
  },
  {
    id: 'working-relationship',
    name: 'Working Relationship',
    branch: 'booking', tier: 'Foundation',
    cost: 1, level: 5,
    requires: ['tag-team-wrestling'],
    hook: 'relax the tag gate',
    effect: 'Tag teams may be formed between wrestlers with closeness ≥ 5 and '
      + 'warmth in both directions.',
    built: true,
  },
  {
    id: 'six-person-tag',
    name: 'Six-Person Tag',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 6,
    requires: ['working-relationship'],
    hook: 'three a side, and four',
    effect: 'Unlocks sides: [3,3] and [4,4], and uneven multi-man sides. Six- '
      + 'and eight-person tags are the cheapest way to get bodies on television '
      + 'inside a short window, which makes them the roster-use answer for a GM '
      + 'stuck on the hour.',
  },
  {
    id: 'stipulation-hardcore-ladder',
    name: 'Stipulation: Hardcore & Ladder',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 7,
    requires: ['stipulation-submission-match'],
    hook: 'weapons and height',
    effect: 'Unlocks Hardcore (min 8) and Ladder (min 12). Both raise injury '
      + 'chance meaningfully. A wrestler injured in a stipulation you chose files '
      + 'a memory about it.',
  },
  {
    id: 'number-one-contender',
    name: 'Number One Contender',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 8,
    hook: 'a match that creates a debt',
    effect: 'Any match can be designated a number one contender match for a '
      + 'named championship. The winner is owed a title shot inside four weeks, '
      + 'and the game tracks it. Delivering on time pays 35 XP. Letting it lapse '
      + 'is a breach: the executive review counts it, the contender files a heavy '
      + 'opportunity memory, and the championship\'s credibility takes a visible '
      + 'hit that persists.',
  },
  {
    id: 'just-get-along',
    name: 'Just Get Along',
    branch: 'booking', tier: 'Working',
    cost: 1, level: 9,
    requires: ['working-relationship'],
    hook: 'relax the tag gate again',
    effect: 'Tag teams may be formed between any two wrestlers with positive '
      + 'warmth in at least one direction.',
  },
  {
    id: 'the-scramble',
    name: 'The Scramble',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 10,
    requires: ['fatal-four-way'],
    hook: 'five, six, seven, eight ways',
    effect: 'Unlocks sides up to MAX_SIDES = 8 for singles-per-side '
      + 'arrangements, and mixed arrangements up to 8 sides.',
  },
  {
    id: 'open-challenge',
    name: 'Open Challenge',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 11,
    requires: ['number-one-contender'],
    hook: 'book a slot without an opponent',
    effect: 'Book a segment with one named wrestler and an empty opposite '
      + 'side. Who answers is decided at the moment of the segment, weighted by '
      + 'who has a live grievance with them, who is chasing a title they hold, '
      + 'who has been unused for weeks, and who is simply in the building. You do '
      + 'not choose. Nobody answering is a possible outcome, and it is '
      + 'embarrassing.',
  },
  {
    id: 'advertise-it',
    name: 'Advertise It',
    branch: 'booking', tier: 'Working',
    cost: 2, level: 12,
    hook: 'announce it in advance',
    effect: 'Announce a match one to four weeks ahead. Advertised matches '
      + 'generate anticipation the executive review counts positively, and the '
      + 'audience notices. An advertised match that does not happen is a breach, '
      + 'which the existing reviewShow() already punishes hard. Advertising a '
      + 'match involving a wrestler with an unresolved grudge against their '
      + 'announced opponent is a gamble.',
  },
  {
    id: 'forced-partnership',
    name: 'Forced Partnership',
    branch: 'booking', tier: 'Established',
    cost: 3, level: 13,
    requires: ['just-get-along'],
    hook: 'team anybody',
    effect: 'Removes the relationship gate on tag teams entirely. Partners '
      + 'with a live feud thread will visibly fail to cooperate; a partnership '
      + 'between active enemies has a real chance of one abandoning the other '
      + 'mid-match, which files the abandoned thread event (weight +6 — one of '
      + 'the heaviest in the game) and creates an opportunity.',
  },
  {
    id: 'stipulation-cage-last-man-standing',
    name: 'Stipulation: Cage & Last Man Standing',
    branch: 'booking', tier: 'Established',
    cost: 2, level: 14,
    requires: ['stipulation-hardcore-ladder'],
    hook: 'no escape and no count-out',
    effect: 'Unlocks Steel Cage (min 12) and Last Man Standing (min 14). A '
      + 'cage match suppresses run-ins and saves entirely, which means it is the '
      + 'one match type where a beatdown finishes what it started.',
  },
  {
    id: 'battle-royal',
    name: 'Battle Royal',
    branch: 'booking', tier: 'Established',
    cost: 3, level: 15,
    requires: ['the-scramble'],
    hook: 'everybody',
    effect: 'Unlocks the open-field Battle Royal shape. No cap on '
      + 'participants. Only the winner records a win; nobody records a loss, '
      + 'which makes it the single best tool in the game for putting the entire '
      + 'roster on television in one segment without damaging anyone. It also, at '
      + 'high chaos, generates more post-match incidents than any other match '
      + 'type.',
  },
  {
    id: 'protect-the-fall',
    name: 'Protect The Fall',
    branch: 'booking', tier: 'Established',
    cost: 3, level: 16,
    requires: ['fatal-four-way'],
    hook: 'choose who loses',
    effect: 'In any match with three or more sides, you nominate which side '
      + 'takes the fall, overriding decideFall()\'s weighted draw. The nominated '
      + 'side\'s wrestlers know they were chosen — a wrestler protected too often '
      + 'stops believing their wins mean anything, and a wrestler nominated three '
      + 'times in six weeks files an opportunity grudge whether or not they lost '
      + 'anything on paper.',
  },
  {
    id: 'iron-man-match',
    name: 'Iron Man Match',
    branch: 'booking', tier: 'Established',
    cost: 3, level: 18,
    trust: 'Fine',
    requires: ['stipulation-cage-last-man-standing'],
    hook: 'the long one',
    effect: 'Unlocks Iron Man (min 25 minutes). Effectively impossible below '
      + 'a 90-minute broadcast, which is why it sits here.',
  },
  {
    id: 'the-main-event-scene',
    name: 'The Main Event Scene',
    branch: 'booking', tier: 'Capstones',
    cost: 4, level: 20,
    trust: 'Solid',
    requires: ['number-one-contender', 'advertise-it'],
    hook: 'designate a top tier',
    effect: 'Nominate four to six wrestlers as the main event scene. They '
      + 'gain automatic contendership logic (title shots route through them), the '
      + 'executive review weights their usage heavily, and the audience treats '
      + 'their matches as main events regardless of card position. The cost: '
      + 'everyone in the scene now expects to be in the main event every week. '
      + 'Being on the card but not in the main event files a small opportunity '
      + 'memory each time. Dropping someone out of the scene is a critical '
      + 'incident, guaranteed, with the wrestler and with everyone tied to them. '
      + 'You have created a hierarchy, and hierarchies have politics.',
  },
  {
    id: 'book-the-long-game',
    name: 'Book The Long Game',
    branch: 'booking', tier: 'Capstones',
    cost: 5, level: 24,
    trust: 'Strong',
    requires: ['the-main-event-scene'],
    shutBy: 'The Desk',
    hook: 'plan an arc and be held to it',
    effect: 'Plot a multi-week storyline: two to four participants, three to '
      + 'eight weeks, with checkpoints you define (a betrayal in week 3, a '
      + 'contender match in week 5, a blow-off in week 8). The game shows the arc '
      + 'on the calendar and the executive review grades you against your own '
      + 'plan — hitting checkpoints pays large XP and trust, missing them costs '
      + 'more than never having planned. Wrestlers in a plotted arc who are '
      + 'booked outside it notice. An arc cannot be abandoned; it can only be '
      + 'failed.',
  },
  {
    id: 'stopwatch',
    name: 'Stopwatch',
    branch: 'production', tier: 'Foundation',
    cost: 1, level: 1,
    hook: 'see the overrun as it happens',
    effect: 'The clock strip shows live overrun/underrun against the planned '
      + 'rundown, per segment and cumulative, rather than only at the end.',
    built: true,
  },
  {
    id: 'go-home',
    name: 'Go Home',
    branch: 'production', tier: 'Foundation',
    cost: 1, level: 2,
    requires: ['stopwatch'],
    hook: 'send a message to the ring',
    effect: 'New live action, free. Signal the wrestlers in a live match to '
      + 'go to the finish. The match ends at the next natural point, up to 3 '
      + 'minutes early. The wrestlers know they were cut short and file a small '
      + 'airtime memory — smaller than being cut off outright, larger than '
      + 'nothing.',
  },
  {
    id: 'buy-me-two-minutes',
    name: 'Buy Me Two Minutes',
    branch: 'production', tier: 'Foundation',
    cost: 2, level: 4,
    requires: ['stopwatch'],
    hook: 'stretch a live segment',
    effect: 'New live action. Extend the current segment by up to 2 minutes. '
      + 'The extra time comes off the back of the show, not out of thin air — you '
      + 'will be 2 minutes short somewhere. Wrestlers asked to stretch file a '
      + 'small positive memory (they were trusted with the time) unless it '
      + 'happens to them twice in one night.',
  },
  {
    id: 'hard-out',
    name: 'Hard Out',
    branch: 'production', tier: 'Foundation',
    cost: 2, level: 5,
    requires: ['go-home'],
    hook: 'cut it dead',
    effect: 'New live action. End the current segment immediately, wherever '
      + 'it is. Recovers all remaining planned minutes. The wrestlers involved '
      + 'file a significant airtime grudge, and a match cut before its finish '
      + 'produces no clean result — no win is recorded for anyone, which has '
      + 'consequences for contendership and for anyone who was supposed to be '
      + 'going over.',
  },
  {
    id: 'cold-open',
    name: 'Cold Open',
    branch: 'production', tier: 'Foundation',
    cost: 1, level: 6,
    excludes: ['line-in-the-sand'],
    hook: 'start in the middle',
    effect: 'Open the broadcast with a segment already in progress. Saves 2 '
      + 'minutes of the window. The cost is your pre-show block — no Open Door '
      + 'Hours, no Line In The Sand, no walking the building before the light '
      + 'goes on. You start the night blind.',
  },
  {
    id: 'commercial-break',
    name: 'Commercial Break',
    branch: 'production', tier: 'Working',
    cost: 2, level: 7,
    requires: ['stopwatch'],
    hook: 'a gap in the broadcast',
    effect: 'Insert a commercial break, recovering 2 minutes of window. '
      + 'Anything that happens during the break — a run-in, a beatdown, an '
      + 'arrival — is witnessed only by people in the building, not by the '
      + 'audience. This is the mechanically interesting part: you can stage '
      + 'something the audience did not see, which the locker room knows about '
      + 'and the executive review does not.',
  },
  {
    id: 'the-hard-camera',
    name: 'The Hard Camera',
    branch: 'production', tier: 'Working',
    cost: 2, level: 8,
    requires: ['commercial-break'],
    hook: 'choose what they see',
    effect: 'When an incident occurs during a live segment, choose whether it '
      + 'goes out on air. On air: the audience reacts, the executive review '
      + 'counts it, and the thread\'s heat spreads to the whole roster. Off air: '
      + 'the incident happens, the locker room knows, and the show carries on as '
      + 'if it didn\'t.',
  },
  {
    id: 'flexible-rundown',
    name: 'Flexible Rundown',
    branch: 'production', tier: 'Working',
    cost: 3, level: 9,
    requires: ['hard-out', 'buy-me-two-minutes'],
    hook: 'reorder what\'s left',
    effect: 'New live action, costs 1 minute. Reorder every remaining item on '
      + 'the card. Wrestlers moved later file a small airtime memory; wrestlers '
      + 'moved earlier without warning are unprepared, and their segment carries '
      + 'a higher chance of a post-match incident. This is the branch\'s '
      + 'workhorse.',
  },
  {
    id: 'dark-match',
    name: 'Dark Match',
    branch: 'production', tier: 'Working',
    cost: 2, level: 10,
    hook: 'off television',
    effect: 'Run a match outside the broadcast window. Costs real clock but '
      + 'no airtime. No executive grade impact, no audience reaction, no airtime '
      + 'credit for the participants — but the result is real, injuries are real, '
      + 'and it is the only way to give a returning or untested wrestler a match '
      + 'without spending television on them. Pairs directly with Scouting\'s '
      + 'Tryout Match.',
  },
  {
    id: 'run-it-back',
    name: 'Run It Back',
    branch: 'production', tier: 'Working',
    cost: 2, level: 12,
    requires: ['the-hard-camera'],
    hook: 'replay it',
    effect: 'Spend 1 minute of window replaying a moment from earlier in the '
      + 'show. The moment\'s thread event is re-filed at increased weight and its '
      + 'heat spreads to every wrestler in the building rather than just '
      + 'witnesses. Replaying a moment somebody is ashamed of is a deliberate '
      + 'provocation and the game treats it as one.',
  },
  {
    id: 'gorilla-sightlines',
    name: 'Gorilla Sightlines',
    branch: 'production', tier: 'Working',
    cost: 2, level: 13,
    requires: ['flexible-rundown'],
    hook: 'the position is worth something',
    effect: 'Standing at Gorilla now shows the live state of every remaining '
      + 'item on the card — participants, readiness, who is where, who hasn\'t '
      + 'turned up. It converts Gorilla from "the room next to the ring" into the '
      + 'game\'s command position, which makes the choice to leave it meaningful.',
  },
  {
    id: 'overrun',
    name: 'Overrun',
    branch: 'production', tier: 'Working',
    cost: 2, level: 14,
    trust: 'Solid',
    requires: ['hard-out'],
    hook: 'go long on purpose',
    effect: 'Deliberately exceed the broadcast window by up to 8 minutes. The '
      + 'finish lands properly, the segment isn\'t butchered, the locker room '
      + 'notices you protected their match. reviewShow() records timing: \'long\' '
      + 'and the grade takes the hit automatically — there is no version of this '
      + 'that doesn\'t cost trust. Using it is a bet that the segment is worth a '
      + 'grade.',
  },
  {
    id: 'split-screen',
    name: 'Split Screen',
    branch: 'production', tier: 'Working',
    cost: 3, level: 16,
    trust: 'Good',
    requires: ['flexible-rundown', 'gorilla-sightlines'],
    hook: 'two things at once',
    effect: 'Run two segments simultaneously. This does not save clock — both '
      + 'segments run their full length in parallel, so you gain a slot, not '
      + 'minutes. The chance of a post-match or backstage incident is doubled '
      + 'across both, and you can only be in one of the two rooms, so one of them '
      + 'is happening without you by definition.',
  },
  {
    id: 'card-subject-to-change',
    name: 'Card Subject To Change',
    branch: 'production', tier: 'Capstones',
    cost: 4, level: 18,
    trust: 'Good',
    requires: ['flexible-rundown', 'gorilla-sightlines'],
    hook: 'rewrite it live',
    effect: 'Once per show, replace a booked item outright while on air — a '
      + 'different match, different participants, different shape. The '
      + 'replacement is built from whoever is available and in the building. The '
      + 'costs are real: every wrestler removed from the card files an '
      + 'opportunity grudge as though denied airtime, and if the removed match '
      + 'was advertised, it is still a breach — the audience was promised it. '
      + 'This is a tool for salvaging a collapsing show, not for improvising a '
      + 'better one.',
  },
  {
    id: 'we-ll-fix-it-in-the-truck',
    name: 'We\'ll Fix It In The Truck',
    branch: 'production', tier: 'Capstones',
    cost: 5, level: 22,
    trust: 'Trusted',
    requires: ['the-hard-camera', 'card-subject-to-change'],
    hook: 'call it an angle',
    effect: 'Once per show, take an unplanned incident that went out on air '
      + 'and frame it as intentional. The executive review reclassifies it: '
      + 'instead of counting toward backstage: out of hand, it counts as content, '
      + 'and a genuinely shocking incident can turn a C into a B. The locker room '
      + 'is not fooled. Everyone who witnessed it files a memory about the GM '
      + 'covering it up, and the wrestlers involved — who know exactly what '
      + 'happened — file a heavier one. Used twice in a month, the locker room\'s '
      + 'read on your honesty shifts permanently and your rulings start landing '
      + 'one step weaker across the board.',
  },
  {
    id: 'expanded-broadcast-i',
    name: 'Expanded Broadcast I',
    branch: 'corporate', tier: 'Foundation',
    cost: 1, level: 2,
    trust: 'Noted (6)',
    hook: 'seventy-five minutes',
    effect: 'Broadcast window 60 → 75. Fifteen minutes is one more match or '
      + 'two more segments; at this stage of the game it is the difference '
      + 'between five wrestlers used and eight.',
    built: true,
  },
  {
    id: 'the-second-belt',
    name: 'The Second Belt',
    branch: 'corporate', tier: 'Foundation',
    cost: 2, level: 4,
    trust: '10',
    hook: 'another championship',
    effect: 'Opens the second championship slot from UNLOCKABLE_TITLES. A '
      + 'second title doubles the number of wrestlers who have something to chase '
      + 'and introduces the first real championship politics: two champions, and '
      + 'only one main event.',
    built: true,
  },
  {
    id: 'expanded-broadcast-ii',
    name: 'Expanded Broadcast II',
    branch: 'corporate', tier: 'Foundation',
    cost: 2, level: 5,
    trust: 'Fine (15)',
    requires: ['expanded-broadcast-i'],
    hook: 'ninety minutes',
    effect: 'Broadcast window 75 → 90. The first length at which a match can '
      + 'run past fifteen minutes without eating the rest of the card, which is '
      + 'where stipulations stop being a luxury.',
    built: true,
  },
  {
    id: 'make-your-case',
    name: 'Make Your Case',
    branch: 'corporate', tier: 'Foundation',
    cost: 2, level: 6,
    hook: 'argue the grade',
    effect: 'New post-show action. Once per week, contest the executive '
      + 'review by nominating which verdict you think was misjudged and why (a '
      + 'walkout you prevented, a light show you filled with an unadvertised '
      + 'match). It can go either way — a good case moves the grade up one step, '
      + 'a bad one moves it down. The executive remembers being argued with: '
      + 'three cases in a season and they stop listening.',
  },
  {
    id: 'talent-budget',
    name: 'Talent Budget',
    branch: 'corporate', tier: 'Working',
    cost: 2, level: 7,
    trust: 'Fine (15)',
    hook: 'sign someone',
    effect: 'Sign one free agent per month. Without the Scouting branch you '
      + 'sign blind — a name, an archetype, and nothing else. With Scouting you '
      + 'sign knowingly. Every signing is a wrestler who now expects to be used, '
      + 'and the roster-use verdict in reviewShow() is a share, not a count: a '
      + 'bigger roster makes "broad" harder, not easier.',
  },
  {
    id: 'expanded-broadcast-iii',
    name: 'Expanded Broadcast III',
    branch: 'corporate', tier: 'Working',
    cost: 2, level: 8,
    trust: 'Good (27)',
    requires: ['expanded-broadcast-ii'],
    hook: 'one hundred and five',
    effect: 'Broadcast window 90 → 105. An optional rung: 120 requires only '
      + 'Expanded Broadcast II, so this is fifteen minutes bought five levels '
      + 'early rather than a step on the way.',
  },
  {
    id: 'set-the-priorities',
    name: 'Set The Priorities',
    branch: 'corporate', tier: 'Working',
    cost: 2, level: 8,
    requires: ['make-your-case'],
    doctrine: 'The Desk',
    hook: 'tell them what to grade you on',
    effect: 'Once per quarter (13 weeks), nominate which of the four '
      + 'executive verdicts — timing, locker room, roster use, backstage order — '
      + 'is weighted double for the quarter. The other three are still graded, '
      + 'and the one you nominated is unforgiving: failing your own stated '
      + 'priority costs more than failing anything else. This is the clearest '
      + '"declare and be held to it" mechanic in the tree.',
  },
  {
    id: '120-minute-broadcast',
    name: '120-Minute Broadcast',
    branch: 'corporate', tier: 'Working',
    cost: 3, level: 10,
    trust: 'Good (27)',
    requires: ['expanded-broadcast-ii'],
    hook: 'two full hours',
    effect: 'Broadcast window → 120 minutes. The show is now long enough to '
      + 'carry a genuine undercard, which means the roster needs to be deep '
      + 'enough to fill one.',
  },
  {
    id: 'the-third-belt',
    name: 'The Third Belt',
    branch: 'corporate', tier: 'Working',
    cost: 2, level: 10,
    trust: 'Solid (22)',
    requires: ['the-second-belt'],
    hook: 'tag titles or a secondary',
    effect: 'Opens the third championship slot. A belt held by two people '
      + 'needs every side of its match to be two people, so tag titles are also a '
      + 'standing booking constraint you have chosen to take on.',
  },
  {
    id: 'network-favor',
    name: 'Network Favor',
    branch: 'corporate', tier: 'Working',
    cost: 3, level: 12,
    trust: 'Good (27)',
    requires: ['make-your-case'],
    excludes: ['creative-control'],
    hook: 'cash something in',
    effect: 'Once per season, applied after a show: downgrade the damage of '
      + 'one bad grade by one step (a D counts as a C, a C as a B). It does not '
      + 'erase the show and it does not touch the locker room\'s memory of it. '
      + 'Cashing a favour is noted; the executive\'s willingness to grant the next '
      + 'one falls.',
  },
  {
    id: 'talent-relations-contact',
    name: 'Talent Relations Contact',
    branch: 'corporate', tier: 'Working',
    cost: 2, level: 13,
    requires: ['set-the-priorities'],
    doctrine: 'The Desk',
    hook: 'they tell you what they want',
    effect: 'Head office nominates a wrestler they believe should be '
      + 'champion, or a wrestler they believe should not be. You may comply or '
      + 'ignore it. Complying pays trust; ignoring it costs trust and, if the '
      + 'wrestler in question is genuinely wrong for the spot, the executive is '
      + 'sometimes right and sometimes not — the nomination is based on their '
      + 'read, and their read is based on the same surface data the audience has.',
  },
  {
    id: 'house-show-loop',
    name: 'House Show Loop',
    branch: 'corporate', tier: 'Established',
    cost: 3, level: 15,
    trust: 'Strong (34)',
    requires: ['talent-budget'],
    hook: 'run dates that aren\'t on television',
    effect: 'New calendar action between shows. A house show loop gives every '
      + 'participating wrestler airtime-equivalent credit, builds matches and '
      + 'segments on relationships fast, and lets you test a pairing off camera. '
      + 'It consumes the between-show week, which means no scouting that week and '
      + 'no recovery for injuries. It is a way of buying locker-room stability '
      + 'with time.',
  },
  {
    id: 'the-fourth-belt',
    name: 'The Fourth Belt',
    branch: 'corporate', tier: 'Established',
    cost: 3, level: 17,
    trust: 'Trusted (42)',
    requires: ['the-third-belt'],
    hook: 'a fourth championship',
    effect: 'Opens the fourth championship slot. Four belts on a roster under '
      + 'twenty means most of the card is a title picture, and a champion who is '
      + 'not defending is a champion the audience stops believing in.',
  },
  {
    id: 'poach',
    name: 'Poach',
    branch: 'corporate', tier: 'Established',
    cost: 3, level: 18,
    trust: 'Trusted (42)',
    requires: ['talent-budget', 'contract-status'],
    hook: 'sign someone who already has a job',
    effect: 'Sign a wrestler from a rival promotion when their contract '
      + 'expires. Requires Scouting\'s Contract Status to know when that is. A '
      + 'poached wrestler arrives with a reputation and with existing opinions '
      + 'about people on your roster — including, sometimes, someone you '
      + 'dismissed.',
  },
  {
    id: '150-minute-broadcast',
    name: '150-Minute Broadcast',
    branch: 'corporate', tier: 'Capstones',
    cost: 4, level: 16,
    trust: 'Backed (58)',
    requires: ['120-minute-broadcast'],
    hook: 'two and a half hours',
    effect: 'Window → 150. At this length the show cannot be filled by the '
      + 'top half of the roster, and the executive\'s roster-use verdict becomes '
      + 'the hardest of the four to satisfy rather than the easiest.',
  },
  {
    id: 'three-hour-show',
    name: 'Three-Hour Show',
    branch: 'corporate', tier: 'Capstones',
    cost: 5, level: 22,
    trust: 'Untouchable (75)',
    requires: ['150-minute-broadcast'],
    hook: 'the flagship',
    effect: 'Window → 180. Requires, in practice, a roster of 24+ and at '
      + 'least three championships to be anything other than an endurance test. '
      + 'The last hour of a three-hour show that you cannot fill is the most '
      + 'visible failure state in the game.',
  },
  {
    id: 'creative-control',
    name: 'Creative Control',
    branch: 'corporate', tier: 'Capstones',
    cost: 5, level: 25,
    trust: 'Untouchable (75)',
    requires: ['set-the-priorities', '120-minute-broadcast'],
    excludes: ['network-favor'],
    doctrine: 'The Desk',
    hook: 'set your own terms',
    effect: 'Each week you set your own broadcast length within a band (±30 '
      + 'minutes of your tier) and declare your own main event in advance. The '
      + 'executive review stops grading you against their priorities and starts '
      + 'grading you against yours — the plan you filed on Monday. This is not '
      + 'easier. Their standards are generic; yours are specific, and the game '
      + 'holds you to a plan you wrote when you were optimistic. A missed '
      + 'self-declared main event is a breach at double weight.',
  },
  {
    id: 'background-check',
    name: 'Background Check',
    branch: 'scouting', tier: 'Foundation',
    cost: 1, level: 2,
    hook: 'learn one thing about one of your own',
    effect: 'One report per week on a roster member. Reveals one hidden '
      + 'personality trait with its reading in words ("hot-headed", "keeps his '
      + 'own counsel"). Which trait is revealed is chosen by relevance — the one '
      + 'most affecting their recent behaviour — not by you.',
    built: true,
  },
  {
    id: 'tape-study',
    name: 'Tape Study',
    branch: 'scouting', tier: 'Foundation',
    cost: 1, level: 3,
    hook: 'watch the matches',
    effect: 'Reveals in-ring and charisma bands for any wrestler, on roster '
      + 'or in the pool. Bands, not numbers — "excellent", "solid", "limited". '
      + 'Costs no calendar time for your own roster; one week per pool prospect.',
    built: true,
  },
  {
    id: 'indie-circuit-contacts',
    name: 'Indie Circuit Contacts',
    branch: 'scouting', tier: 'Foundation',
    cost: 2, level: 4,
    requires: ['tape-study'],
    hook: 'there is an outside world',
    effect: 'Unlocks the talent pool. Three names per month become visible, '
      + 'with a name, an archetype, and one vague sentence. This is the upgrade '
      + 'that makes Corporate\'s Talent Budget mean anything — without it you are '
      + 'signing from a list of strangers.',
  },
  {
    id: 'character-read',
    name: 'Character Read',
    branch: 'scouting', tier: 'Foundation',
    cost: 2, level: 5,
    requires: ['indie-circuit-contacts'],
    hook: 'personality, not ability',
    effect: 'Extends reports to personality traits for pool prospects — two '
      + 'traits per report, chosen by prominence. A prospect who reads "excellent '
      + 'in the ring, extremely difficult" is a decision, which is the whole '
      + 'point.',
  },
  {
    id: 'injury-history',
    name: 'Injury History',
    branch: 'scouting', tier: 'Foundation',
    cost: 1, level: 6,
    requires: ['tape-study'],
    hook: 'the body',
    effect: 'Reveals injury history and durability for any wrestler, roster '
      + 'or pool. Signing someone whose durability you did not check and losing '
      + 'them for eight weeks is a mistake the game will let you make exactly '
      + 'once.',
    built: true,
  },
  {
    id: 'tryout-match',
    name: 'Tryout Match',
    branch: 'scouting', tier: 'Working',
    cost: 2, level: 7,
    requires: ['character-read'],
    hook: 'bring them in',
    effect: 'Bring a pool prospect to a show for a single match. Pairs with '
      + 'Production\'s Dark Match to run it off television, or risk it on air. A '
      + 'tryout reveals ability exactly and personality partially, and the '
      + 'prospect forms their first opinion of you based on how the night went — '
      + 'a prospect booked to lose in three minutes remembers that if you sign '
      + 'them later.',
  },
  {
    id: 'deep-dive',
    name: 'Deep Dive',
    branch: 'scouting', tier: 'Working',
    cost: 3, level: 8,
    requires: ['character-read', 'background-check'],
    hook: 'everything about one person',
    effect: 'Costs two calendar weeks. Returns a complete personality read on '
      + 'one wrestler — all eleven traits, with readings — plus their history and '
      + 'their existing relationships with anyone on your roster. The most '
      + 'expensive information action in the game and the most complete.',
  },
  {
    id: 'attitude-report',
    name: 'Attitude Report',
    branch: 'scouting', tier: 'Working',
    cost: 2, level: 9,
    requires: ['character-read'],
    hook: 'will they be a problem',
    effect: 'Returns a direct prediction of a prospect\'s backstage behaviour: '
      + 'how often they\'ll generate incidents, whether they respect authority, '
      + 'whether they\'ll refuse bookings. This does not stop you signing them. It '
      + 'lets you sign a known problem deliberately, which is a legitimate and '
      + 'sometimes correct strategy — troublemakers generate stories.',
  },
  {
    id: 'word-from-the-road',
    name: 'Word From The Road',
    branch: 'scouting', tier: 'Working',
    cost: 2, level: 10,
    requires: ['background-check'],
    hook: 'hear about incidents you weren\'t near',
    effect: 'Once per show, an incident that occurred somewhere you couldn\'t '
      + 'see is reported to you after the fact but before the show ends — late '
      + 'enough that you can\'t have prevented it, early enough that you can still '
      + 'rule on it. Converts one missed per night into a late ruling.',
  },
  {
    id: 'contract-status',
    name: 'Contract Status',
    branch: 'scouting', tier: 'Working',
    cost: 2, level: 12,
    requires: ['indie-circuit-contacts'],
    hook: 'when they\'re free',
    effect: 'Reveals contract expiry for every wrestler in rival promotions, '
      + 'and — the sharp end — for your own roster. You now know exactly which of '
      + 'your wrestlers can walk in eleven weeks, which turns their grievances '
      + 'into deadlines. Prerequisite for Corporate\'s Poach.',
  },
  {
    id: 'second-set-of-eyes',
    name: 'Second Set Of Eyes',
    branch: 'scouting', tier: 'Working',
    cost: 3, level: 13,
    requires: ['deep-dive'],
    hook: 'hire a scout',
    effect: 'Reports arrive without spending your calendar weeks — two a '
      + 'month, free. Your scout has taste. They over-rate one thing (size, '
      + 'charisma, technical ability, promo work) and under-rate another, '
      + 'consistently, and the game never tells you which. You learn their bias '
      + 'by signing people. You may replace them, and the new one has a different '
      + 'bias you also don\'t know.',
  },
  {
    id: 'the-feeder',
    name: 'The Feeder',
    branch: 'scouting', tier: 'Established',
    cost: 3, level: 15,
    trust: 'Strong (34)',
    requires: ['tryout-match'],
    doctrine: 'The Desk',
    hook: 'a developmental territory',
    effect: 'Establish a developmental roster. Signed prospects can be parked '
      + 'there: they improve slowly over months, cost nothing in airtime, and '
      + 'cannot be used. Wrestlers left there longer than about six months start '
      + 'asking when they\'re coming up, and one who is called up after being '
      + 'forgotten arrives with a grudge already filed.',
  },
  {
    id: 'scout-your-own',
    name: 'Scout Your Own',
    branch: 'scouting', tier: 'Established',
    cost: 2, level: 16,
    requires: ['contract-status'],
    hook: 'who\'s looking at your roster',
    effect: 'You are told when a rival promotion is scouting one of your '
      + 'wrestlers, and who. This is pure pressure: a wrestler being scouted '
      + 'while carrying a grudge against you is a wrestler you are going to lose, '
      + 'and knowing it does not fix it. It does let you get ahead of it — with '
      + 'Negotiation\'s Loyalty Bonus, or by giving them what they\'ve been asking '
      + 'for.',
  },
  {
    id: 'the-hot-free-agent',
    name: 'The Hot Free Agent',
    branch: 'scouting', tier: 'Established',
    cost: 3, level: 18,
    trust: 'Trusted (42)',
    requires: ['second-set-of-eyes'],
    hook: 'a name becomes available',
    effect: 'Once per season, trigger a marquee free agency event: an '
      + 'established, high-ability wrestler enters the pool and multiple '
      + 'promotions pursue them. Signing them requires trust, money, and usually '
      + 'a promise about their position on the card — a promise recorded like any '
      + 'other, against a wrestler with the standing to make breaking it '
      + 'catastrophic.',
  },
  {
    id: 'player-development',
    name: 'Player Development',
    branch: 'scouting', tier: 'Capstones',
    cost: 4, level: 20,
    requires: ['the-feeder', 'deep-dive'],
    hook: 'build someone',
    effect: 'For wrestlers in developmental (requires The Feeder) or in their '
      + 'first year, nominate a direction of growth: in-ring, charisma, or a '
      + 'specific personality trait. Growth is slow — measured in months — and '
      + 'you set direction, not magnitude. Development can stall, and a wrestler '
      + 'being developed toward something they\'re not suited for stalls harder '
      + 'and knows it.',
  },
  {
    id: 'the-eye',
    name: 'The Eye',
    branch: 'scouting', tier: 'Capstones',
    cost: 5, level: 24,
    trust: 'Strong (34)',
    requires: ['second-set-of-eyes', 'deep-dive'],
    hook: 'you are never wrong about talent',
    effect: 'Every report is exact and immediate: full traits, exact ability, '
      + 'and ceiling — the maximum this wrestler will ever reach. No calendar '
      + 'cost. Your scout\'s bias no longer applies. The cost of perfect '
      + 'information: you now know which of your wrestlers will never be '
      + 'main-eventers, and the game knows you know. Those wrestlers still want '
      + 'to be pushed, still file opportunity grudges when they aren\'t, and the '
      + 'comfortable ambiguity that let you keep them hopeful is gone. Several '
      + 'wrestlers you were happy with become wrestlers you are managing down.',
  },
  {
    id: 'they-re-asking',
    name: 'They\'re Asking',
    branch: 'negotiation', tier: 'Foundation',
    cost: 1, level: 1,
    hook: 'requests exist',
    effect: 'Unlocks the request system. A queue of open requests with '
      + 'wrestler, want, and deadline, visible on the booking screen. Requests '
      + 'that expire unanswered file an opportunity memory, so ignoring the list '
      + 'is a decision with a cost.',
  },
  {
    id: 'read-the-ask',
    name: 'Read The Ask',
    branch: 'negotiation', tier: 'Foundation',
    cost: 1, level: 3,
    requires: ['they-re-asking'],
    hook: 'how badly do they want it',
    effect: 'Requests display intensity in words — "would like", "has been '
      + 'asking", "this is the third time", "will not let this go". A '
      + 'high-intensity request denied without a compromise is very close to an '
      + 'incident.',
  },
  {
    id: 'not-tonight',
    name: 'Not Tonight',
    branch: 'negotiation', tier: 'Foundation',
    cost: 1, level: 4,
    requires: ['they-re-asking'],
    hook: 'defer with a date',
    effect: 'Defer a request to a specific named week rather than denying it. '
      + 'The wrestler accepts and the request re-enters the queue then, at higher '
      + 'intensity. The game remembers you deferred it, and deferring the same '
      + 'request twice reads as a refusal with extra steps.',
  },
  {
    id: 'split-the-difference',
    name: 'Split The Difference',
    branch: 'negotiation', tier: 'Foundation',
    cost: 2, level: 5,
    requires: ['read-the-ask'],
    hook: 'part of what they asked for',
    effect: 'Grant a partial version of any quantitative request — some of '
      + 'the time, a shorter title shot window, one of the two opponents named. '
      + 'Partial grants land as genuinely neutral for most wrestlers and as an '
      + 'insult for the proud ones, which is exactly the sort of thing traits.js '
      + 'should be deciding.',
  },
  {
    id: 'make-it-up-to-you',
    name: 'Make It Up To You',
    branch: 'negotiation', tier: 'Foundation',
    cost: 2, level: 6,
    requires: ['split-the-difference'],
    hook: 'the compromise that gets recorded',
    effect: 'When denying a request for additional time, you may instead '
      + 'offer priority consideration next week. The wrestler may accept the '
      + 'compromise — proud and impatient wrestlers may not — and the game '
      + 'records the commitment. Honouring it next week pays as a kept promise; '
      + 'not honouring it costs more than the flat refusal would have.',
  },
  {
    id: 'what-they-actually-want',
    name: 'What They Actually Want',
    branch: 'negotiation', tier: 'Working',
    cost: 2, level: 7,
    requires: ['read-the-ask', 'private-meeting'],
    hook: 'the ask behind the ask',
    effect: 'Reveals the underlying want behind a request when the two '
      + 'differ, which is roughly a third of the time. Granting the surface '
      + 'request when the real want is different produces almost no goodwill — a '
      + 'mechanic that only becomes visible once you have this upgrade, and which '
      + 'has been quietly running the whole time.',
  },
  {
    id: 'ask-them-for-one',
    name: 'Ask Them For One',
    branch: 'negotiation', tier: 'Working',
    cost: 2, level: 8,
    requires: ['make-it-up-to-you'],
    hook: 'you initiate',
    effect: 'Reverse the channel. Ask a wrestler to do something they would '
      + 'normally refuse — lose to someone below them, work with an enemy, drop a '
      + 'title, put over a debut. They weigh it against their standing with you, '
      + 'their traits, and their live memories. A wrestler you have kept promises '
      + 'to says yes far more often. A refusal is not free for them either: '
      + 'refusing a direct ask files a memory they carry about you.',
  },
  {
    id: 'trade',
    name: 'Trade',
    branch: 'negotiation', tier: 'Working',
    cost: 3, level: 9,
    requires: ['ask-them-for-one'],
    hook: 'this for that',
    effect: 'Grant any request with a condition attached: take a loss this '
      + 'week, work with someone you dislike, give up your spot next week, drop '
      + 'the belt in six weeks. Both halves are recorded, and both can be broken '
      + '— a wrestler who takes the deal and then refuses their half is a live '
      + 'incident with your authority on the line in public.',
  },
  {
    id: 'the-handshake-deal',
    name: 'The Handshake Deal',
    branch: 'negotiation', tier: 'Working',
    cost: 2, level: 11,
    requires: ['make-it-up-to-you'],
    excludes: ['paper-trail'],
    shutBy: 'The Desk',
    hook: 'nothing on paper',
    effect: 'Make an agreement the game does not record as a formal '
      + 'commitment — no deadline, no breach penalty, no executive visibility. '
      + 'The wrestler remembers it anyway, exactly as strongly. This is a tool '
      + 'for GMs who want to promise more than they can track, and it is a trap '
      + 'in precisely the way that sounds. Honouring a handshake deal unprompted '
      + 'is worth more than honouring a recorded one.',
  },
  {
    id: 'time-bank',
    name: 'Time Bank',
    branch: 'negotiation', tier: 'Working',
    cost: 3, level: 13,
    requires: ['split-the-difference'],
    excludes: ['the-veteran-s-rate'],
    hook: 'credit for giving it up',
    effect: 'A wrestler who accepts less time than they asked for, or gives '
      + 'time up voluntarily, accumulates credit. They choose when to cash it, '
      + 'not you — a banked wrestler will one day request something large and '
      + 'expect it granted, and the game will remind you they earned it. Credit '
      + 'caps at three and expires after about eight weeks. This is an economy '
      + 'the wrestler controls, which is the point.',
  },
  {
    id: 'the-veteran-s-rate',
    name: 'The Veteran\'s Rate',
    branch: 'negotiation', tier: 'Established',
    cost: 2, level: 14,
    requires: ['ask-them-for-one'],
    excludes: ['time-bank'],
    hook: 'ask a veteran to take less',
    effect: 'Ask a high-standing veteran to accept reduced time to protect '
      + 'somebody else\'s segment. Most will say yes; it is what veterans are for. '
      + 'Overused, it stops being a favour — asked more than twice in a month, a '
      + 'veteran begins filing airtime memories and their standing with you drops '
      + 'faster than a younger wrestler\'s would, because they know what you are '
      + 'doing.',
  },
  {
    id: 'contract-talks',
    name: 'Contract Talks',
    branch: 'negotiation', tier: 'Established',
    cost: 3, level: 16,
    trust: 'Solid (22)',
    requires: ['trade'],
    hook: 'renegotiate',
    effect: 'Renegotiate with any wrestler, offering one of three: - Money — '
      + 'costs budget, reduces request intensity broadly. - Guaranteed '
      + 'appearances — they must be booked every week or it\'s a breach. - '
      + 'Creative input — that wrestler may now refuse any booking without it '
      + 'counting as insubordination, permanently. It cannot be revoked. Creative '
      + 'input is the most powerful thing you can give a wrestler and the most '
      + 'dangerous. It should be presented plainly and taken rarely.',
  },
  {
    id: 'loyalty-bonus',
    name: 'Loyalty Bonus',
    branch: 'negotiation', tier: 'Established',
    cost: 2, level: 17,
    trust: 'Good (27)',
    requires: ['scout-your-own'],
    hook: 'keep them',
    effect: 'Pay to make a wrestler refuse outside offers for a season. '
      + 'Requires Scouting\'s Scout Your Own to know who needs it. A loyalty bonus '
      + 'paid to an unhappy wrestler buys their contract, not their goodwill — '
      + 'they stay, and they stay angry, and now they know you\'ll pay.',
  },
  {
    id: 'everyone-gets-a-meeting',
    name: 'Everyone Gets A Meeting',
    branch: 'negotiation', tier: 'Capstones',
    cost: 4, level: 19,
    requires: ['trade', 'what-they-actually-want'],
    hook: 'the whole room, one sitting',
    effect: 'Once per week, run a full request round: every wrestler with an '
      + 'open want states it, in sequence, and you answer all of them in one '
      + 'sitting. Costs a large pre-show block (roughly 20 minutes). The catch is '
      + 'the format. They are answering in front of each other. Every refusal is '
      + 'witnessed by everyone still waiting, and the locker room compares notes: '
      + 'granting three requests and refusing nine does not read as nine '
      + 'individual disappointments, it reads as a pattern, and the game applies '
      + 'it as one. Handled well it is the strongest single locker-room action in '
      + 'the game. Handled badly it is a mutiny with a sign-up sheet.',
  },
  {
    id: 'your-word-is-good',
    name: 'Your Word Is Good',
    branch: 'negotiation', tier: 'Capstones',
    cost: 5, level: 23,
    requires: ['everyone-gets-a-meeting', 'promise-them-something'],
    hook: 'the reputation you can only lose',
    effect: 'Tracked per wrestler. A wrestler to whom you have never broken a '
      + 'promise, commitment, deferral or handshake deal will accept one request '
      + 'per season from you regardless of what it is — a loss to someone they '
      + 'hate, a title drop, a match with a partner they despise. It is lost the '
      + 'first time you break anything with that person, permanently, and '
      + 'coolGrudges() does not restore it. It cannot be re-earned. The capstone '
      + 'does not make you more persuasive; it converts a long record of honesty '
      + 'into one enormous favour, once, and then it is gone.',
  },
];

const INDEX = new Map(UPGRADES.map(u => [u.id, u]));

export function upgrade(id) {
  return INDEX.get(id) || null;
}

export function branchOf(id) {
  return BRANCHES.find(b => b.id === id) || null;
}

export function upgradesIn(branchId, tierId) {
  return UPGRADES.filter(u => u.branch === branchId && u.tier === tierId);
}

export function trustBand(trust) {
  const band = TRUST_BANDS.find(([floor]) => trust >= floor);
  return band ? band[1] : 'Provisional';
}

// A requirement written as a band name resolves to the number it stands for.
// 'Good (27)' and 'Good' are the same gate; the design document writes both.
export function trustNeeded(label) {
  if (!label) return 0;
  const digits = /\((\d+)\)|^(\d+)$/.exec(label);
  if (digits) return Number(digits[1] || digits[2]);
  const band = TRUST_BANDS.find(([, word]) => word === label.trim());
  return band ? band[0] : 0;
}

export function standingNeeded(label) {
  return label ? (STANDING_NEEDED[label] || 0) : 0;
}
