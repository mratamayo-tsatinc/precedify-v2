// ============================================================================
// CONSOLE DRAWER — CONTENT BRIDGE (placeholder / testing wiring)
// ----------------------------------------------------------------------------
// Wires the single shared console-drawer.js panel to Precedify's actual
// state (state.js) so every profile shows the SAME panel/tab but with
// content specific to whichever profile is currently active.
//
// This file intentionally does NOT edit state.js / main.js / render-*.js,
// and does NOT rely on knowing the name of whatever function handles a
// profile switch (that function lives in a file not available when this
// bridge was written). Instead it polls a cheap signature of the relevant
// state fields on a short interval and only recomputes/repushes content
// when that signature actually changes — this makes it correct regardless
// of which function mutates state.profileId/state.itemIndex, and immune to
// <script> load-order issues (unlike wrapping a function that might not
// exist yet at this file's load time).
//
// CONTENT: the drawer shows a per-profile LESSON — the rule the profile is
// testing, plus a short worked example using its own (illustrative, not
// the student's actual) numbers — so a student can read how to approach
// the activity before attempting it, rather than guessing. See the
// LESSONS map below. Every profile in generator.js's PROFILES array now
// has a hand-authored entry there, built the same way 'direct-ltr' (the
// first one written) was: a heading, hand-written rule prose, a
// buildExampleTree() that constructs a real tree using that SAME
// profile's own allowedOperators/operandSources/evaluationPattern (so the
// worked example is a genuine instance of the pattern, not a simplified
// stand-in), and hand-written tips. buildFallbackLesson() below is kept
// as a safety net for any FUTURE profile added to PROFILES without a
// matching LESSONS entry yet — it is no longer expected to trigger for
// any of the profiles that exist today.
//
// WORKED EXAMPLE RENDERING: the worked example is NOT a hand-described
// list of {before, op, after, note} strings that would have to be kept in
// sync with the engine by hand. Instead buildLessonExampleTrace() builds a
// real expression tree and runs it through the SAME buildCanonicalTrace()
// (engine.js) used everywhere else, and renderLessonExampleTimeline() then
// renders that trace with the SAME per-row building blocks
// renderCanonicalPlayback() (render-session.js) uses for the "Show correct
// solution" playback — renderStaticExpr, buildColorMap, stepColor,
// pendingNodeId, stepTooltip. The only difference is presentational: every
// row here is already "revealed" (no pb.index gating, no .tl-future rows,
// no Play/Pause controls) and nothing gets an entrance-animation class
// (row-enter / tok-card-flash / tok-colored-flash), since this is a static
// reference sitting inside a lesson, not a live/interactive playback. This
// keeps the lesson's worked example visually and data-consistent with how
// a correct derivation is shown everywhere else in the app, and means a
// future engine change (new operator, new precedence tier, etc.) can never
// make the lesson's own arithmetic silently wrong.
//
// CONNECTOR ARROWS: connector-lines.js's own drawConnectorLines()/
// drawCanonicalConnectorLines() hardcode their target panel
// (document.querySelector('.eval-panel') / '.solution-playback')), and
// neither is ever called near the console drawer anyway — this drawer's
// content is pushed entirely by this file's own poll loop, outside
// main.js's render(). So drawLessonConnectorLines() below instead calls
// straight into connector-lines.js's panel-agnostic building blocks —
// buildConnectorVisuals() and appendConnectorSvg(), neither of which is
// scoped to a specific selector — against our own lesson timeline element.
// Those functions rely on the same data-token-id / data-op-left /
// data-op-right attributes renderStaticExpr() (render-tree.js) already
// stamps onto every token it renders — the exact same call used above —
// so no changes to connector-lines.js or render-tree.js are needed. The
// drawer also mirrors the header's global "Links on/off" state
// (state.showConnectors) rather than always drawing, and computeSignature()
// includes it so toggling that control refreshes the lesson's arrows too.
//
// TERMINAL COLOR PALETTE: buildConnectorVisuals()/buildColorMap() color
// each step from connector-lines.js/dom-helpers.js's own stepColor() — a
// multi-hue "rainbow" palette that's the right call for the live session
// and solution-playback panels, since it helps a student tell one step's
// operator/result apart from another's across a busy panel. Reused as-is
// here, it made the drawer's worked example look like a transplanted piece
// of that panel — including .tok-card's bordered "memory card" widget for
// substituted variables/constants — rather than terminal output. So this
// file deliberately does NOT reuse stepColor() for color (only for the
// GEOMETRY/plumbing functions that don't bake in a hue): buildGreenColorMap()
// below mirrors buildColorMap()'s exact "first-touch wins per resultNodeId"
// keying, but maps every key to one fixed TERMINAL_GREEN; tl-dots are given
// that same fixed color directly when built; and drawLessonConnectorLines()
// recolors the arrows buildConnectorVisuals() hands back before appending
// them. console-drawer.css separately flattens .tok-card to plain inline
// text and dims (rather than hues) the base/not-yet-produced token classes,
// so the whole worked example reads as a single-color terminal print, with
// brightness/weight — not hue — distinguishing "produced" values from
// plain source text.
//
// Safe to delete entirely at any time: doing so only stops pushing content
// into the drawer (which then just sits empty/hidden again) — it can never
// break login, scoring, persistence, or rendering, since it only ever
// READS state/currentProfile() and only ever CALLS the public
// public console-drawer.js API (setConsoleDrawerTitle, setConsoleDrawerContent,
// showConsoleDrawerTab, hideConsoleDrawerTab, closeConsoleDrawer) plus the
// existing public rendering helpers (h, renderStaticExpr, buildColorMap,
// stepColor, pendingNodeId, stepTooltip, buildCanonicalTrace).
// ============================================================================
(function(){
  const POLL_MS = 250;
  let lastSignature = null;

  // Fixed terminal accent color for the worked example — matches
  // console-drawer.css's --console-drawer-fg fallback (#33ff66), the same
  // green the rest of the drawer's content area (.console-drawer-content)
  // already renders in by default. Used in place of connector-lines.js/
  // dom-helpers.js's per-step stepColor() rainbow — see the file header's
  // "TERMINAL COLOR PALETTE" note above for why.
  const TERMINAL_GREEN = '#33ff66';

  // A cheap string fingerprint of everything that should trigger a content
  // refresh: screen + profile + the global connector-line toggle.
  // Deliberately excludes item index/checked state — content is per-PROFILE
  // (the lesson for that profile), not per-item, so navigating between
  // items within the same profile must never cause a re-push. showConnectors
  // IS included: it doesn't change the lesson TEXT, but it changes whether
  // drawLessonConnectorLines() should be drawing arrows on it, and nothing
  // else in this file's poll loop would otherwise notice that toggle.
  function computeSignature(){
    try{
      if(typeof state !== 'object' || !state) return null;
      return [state.screen, state.profileId, state.showConnectors].join('|');
    }catch(e){ return null; }
  }

  // --- lesson content -------------------------------------------------------
  // Keyed by PROFILES[i].id (see generator.js). Each entry is written
  // specifically to that profile's own allowedOperators/evaluationPattern —
  // NOT auto-derived from the profile object — because "what the student
  // needs to know before guessing" is a teaching decision, not something
  // safely inferable from operatorCount/operandSources alone. `rule`/`tips`
  // stay hand-authored prose. The worked example itself, however, is NOT
  // hand-authored data — see buildLessonExampleTrace() below, which builds
  // a real tree for this lesson and lets the engine derive it, exactly the
  // way a student's own item is derived.
  //
  // Every profile below is filled in now, following the exact shape
  // 'direct-ltr' established: heading, hand-written rule prose, a
  // buildExampleTree() that constructs a real tree via makeBinOp/
  // makeLiteral/makeNamed/makeUnary (engine.js) shaped the same way
  // generator.js's own buildTree()/buildParenOverride*/
  // buildRelationalBooleanMix would shape a genuine instance of that
  // profile — same operator tiers, same operand-kind mix, same
  // parenthesization/unary-wrap/boolean rules — so the worked example
  // reads as a real item from that profile, not a simplified stand-in.
  // Values are hand-picked to keep the walked-through arithmetic small
  // and readable, which is a teaching call, not something derived from
  // the profile object. buildFallbackLesson() below is kept only as a
  // safety net for a future profile added to PROFILES without a matching
  // entry here yet.
  const LESSONS = {
    'direct-ltr': {
      heading: 'Direct Left-to-Right Evaluation',
      rule: [
        '+ and - sit on the SAME precedence tier — neither one ever outranks the other.',
        'When an expression uses only + and -, there is no precedence decision to make: operators resolve strictly in the order they appear, left to right.'
      ],
      // Builds the example tree for THIS lesson: 20 - 5 + 3. Kept as a
      // function (not a fixed pre-built tree) purely so every call gets
      // fresh node ids from nextId() (engine.js) — matters if this ever
      // gets called more than once per page load.
      buildExampleTree: () => makeBinOp('+', makeBinOp('-', makeLiteral(20), makeLiteral(5)), makeLiteral(3)),
      tips: [
        "Don't jump to an operator further right just because it looks simpler.",
        'With tied precedence, the LEFTMOST ready operator is always next.'
      ]
    },
    'mult-precedence': {
      heading: 'Multiplication Precedence',
      rule: [
        '* outranks + and -.',
        'Even when a * appears to the RIGHT of a + or -, the * still runs first — position in the expression never overrides precedence.'
      ],
      // 4 + 3 * 2 — the * binds its two operands into one unit before
      // the + ever touches them, so this is NOT 4+3 then *2.
      buildExampleTree: () => makeBinOp('+', makeLiteral(4), makeBinOp('*', makeLiteral(3), makeLiteral(2))),
      tips: [
        'Scan the whole expression for the highest-precedence operator first — not just the leftmost one.',
        'Only once every * (and /) is resolved do + and - get their turn.'
      ]
    },
    'same-precedence-assoc': {
      heading: 'Same-Precedence Associativity',
      rule: [
        '* and / share one precedence tier — neither outranks the other.',
        'With no precedence decision to make, they resolve strictly left to right, exactly like + and - do among themselves.'
      ],
      // 12 * 4 / 6 * 2 — left to right: ((12*4)/6)*2 = (48/6)*2 = 8*2 = 16.
      buildExampleTree: () => makeBinOp('*', makeBinOp('/', makeBinOp('*', makeLiteral(12), makeLiteral(4)), makeLiteral(6)), makeLiteral(2)),
      tips: [
        "Don't assume the operator that 'looks' more natural to group runs first — there's no such rule here.",
        'With tied precedence, always take the leftmost ready operator next.'
      ]
    },
    'full-basic-precedence': {
      heading: 'Full Basic Precedence',
      rule: [
        '+, -, *, and / are all in play together now.',
        '* and / (the higher tier) resolve first wherever they appear, left to right among themselves; only then do + and - resolve, also left to right.'
      ],
      // 6 + 8 * 3 - 12 / 4 = 6 + 24 - 3 = 27.
      buildExampleTree: () => makeBinOp('-', makeBinOp('+', makeLiteral(6), makeBinOp('*', makeLiteral(8), makeLiteral(3))), makeBinOp('/', makeLiteral(12), makeLiteral(4))),
      tips: [
        'Find and resolve every * and / first, left to right, before touching any + or -.',
        'Once only + and - are left, finish those left to right too.'
      ]
    },
    'modulus': {
      heading: 'Modulus',
      rule: [
        '% shares its precedence tier with * and / — it outranks + and - the exact same way multiplication does.',
        'Treat % as "one of the high-tier operators," not as a special case.'
      ],
      // 10 + 9 % 4 * 2 — % and * share the high tier, resolve left to
      // right first: (9%4)*2 = 1*2 = 2; then 10 + 2 = 12.
      buildExampleTree: () => makeBinOp('+', makeLiteral(10), makeBinOp('*', makeBinOp('%', makeLiteral(9), makeLiteral(4)), makeLiteral(2))),
      tips: [
        'When scanning for what runs first, treat % exactly like * — same tier, same urgency.',
        'Resolve the high tier (*, /, %) left to right before the low tier (+, -).'
      ]
    },
    'parens-override': {
      heading: 'Parentheses Override',
      rule: [
        'Parentheses force whatever is inside them to resolve FIRST, even if the operator inside would normally rank lower than an operator waiting outside.',
        'The parens are the override.'
      ],
      // (5 - 2) * 4 * 3 — without the parens this would be 5 - 2*4*3 =
      // 5 - 24 = -19; the parens force the subtraction to run first
      // instead: (5-2)=3, 3*4=12, 12*3=36.
      buildExampleTree: () => makeBinOp('*', makeBinOp('*', makeBinOp('-', makeLiteral(5), makeLiteral(2)), makeLiteral(4)), makeLiteral(3)),
      tips: [
        'Whatever sits inside parentheses always resolves first — no exceptions.',
        'Ask what the expression WOULD be without the parens, so the override actually stands out.'
      ]
    },
    'parens-override-multi': {
      heading: 'Parentheses Override (Multi-Operator)',
      rule: [
        'This time the forced group itself contains TWO operators from different tiers.',
        'Resolve the whole group as its own mini-expression first — respecting precedence INSIDE it — before anything outside the parens gets to touch the result.'
      ],
      // (8 + 3 * 2) * 5 * 4 — inside the parens, precedence still
      // applies: 3*2=6, 8+6=14. Only then does the outside multiply in:
      // 14*5=70, 70*4=280.
      buildExampleTree: () => makeBinOp('*', makeBinOp('*', makeBinOp('+', makeLiteral(8), makeBinOp('*', makeLiteral(3), makeLiteral(2))), makeLiteral(5)), makeLiteral(4)),
      tips: [
        'Inside the parens, precedence still applies normally — resolve the * before the + even there.',
        'Only after the whole parenthesized group is a single value does anything outside it get to run.'
      ]
    },
    'parens-override-dual': {
      heading: 'Parentheses Override (Two Separate Groups)',
      rule: [
        'Two independent parenthesized groups sit side by side — neither is nested inside the other.',
        'Resolve each group completely on its own first, then combine the two results with whatever operator connects them.'
      ],
      // (6 + 4) * (9 - 5) * 2 — each group resolves independently:
      // 6+4=10, 9-5=4. Then combine left to right: 10*4=40, 40*2=80.
      buildExampleTree: () => makeBinOp('*', makeBinOp('*', makeBinOp('+', makeLiteral(6), makeLiteral(4)), makeBinOp('-', makeLiteral(9), makeLiteral(5))), makeLiteral(2)),
      tips: [
        'Treat each parenthesized group as its own separate mini-problem — solve it in isolation first.',
        'Only after BOTH groups are single values do you combine them with the operator(s) outside.'
      ]
    },
    'variables-arithmetic': {
      heading: 'Variables + Arithmetic',
      rule: [
        'Every variable is substituted with its declared value BEFORE any arithmetic runs.',
        'Once substituted, a variable is just a plain number — precedence applies to it exactly like a literal.'
      ],
      // x=5, y=2, z=3 — x + y * z: the * still runs first even though
      // its operands are variables: y*z=2*3=6, then x+6=5+6=11.
      buildExampleTree: () => makeBinOp('+', makeNamed('variable', 'x', 5), makeBinOp('*', makeNamed('variable', 'y', 2), makeNamed('variable', 'z', 3))),
      tips: [
        'Substitute every variable for its declared value first, mentally or on paper.',
        'Once substituted, apply the same precedence rules as any other expression.'
      ]
    },
    'mixed-variables-literals': {
      heading: 'Mixed Variables + Literals',
      rule: [
        'Literals and variables can sit side by side in the same expression.',
        'It makes no difference to precedence which kind an operand is — a substituted variable and a literal are both just values once the substitution is done.'
      ],
      // literal 10, x=4, literal 2, y=3 — 10 + x * 2 - y:
      // x*2=4*2=8, 10+8=18, 18-y=18-3=15.
      buildExampleTree: () => makeBinOp('-', makeBinOp('+', makeLiteral(10), makeBinOp('*', makeNamed('variable', 'x', 4), makeLiteral(2))), makeNamed('variable', 'y', 3)),
      tips: [
        'Substitute any variables first — after that, literals and variables are indistinguishable.',
        'Then resolve high-tier operators before low-tier ones, same as always.'
      ]
    },
    'variables-constants': {
      heading: 'Variables + Constants',
      rule: [
        'Constants behave exactly like variables once evaluation starts — the only real difference is where the value comes from (declared once, never reassigned).',
        'Precedence treats a constant and a variable identically.'
      ],
      // x=4, RATE=5, y=2, LIMIT=3 — x + RATE * y - LIMIT:
      // RATE*y=5*2=10, x+10=4+10=14, 14-LIMIT=14-3=11.
      buildExampleTree: () => makeBinOp('-', makeBinOp('+', makeNamed('variable', 'x', 4), makeBinOp('*', makeNamed('constant', 'RATE', 5), makeNamed('variable', 'y', 2))), makeNamed('constant', 'LIMIT', 3)),
      tips: [
        "Don't treat a constant as 'special' — substitute its declared value exactly like a variable's.",
        'Once every variable and constant is substituted, resolve precedence as usual.'
      ]
    },
    'literals-variables-constants': {
      heading: 'Literals + Variables + Constants',
      rule: [
        'All three operand kinds — literals, variables, and constants — can appear together in one expression.',
        'Where a value comes from never changes how precedence treats it.'
      ],
      // literal 8, x=3, RATE=2, y=5, literal 4 —
      // 8 + x * RATE - y + 4: x*RATE=3*2=6, 8+6=14, 14-y=14-5=9, 9+4=13.
      buildExampleTree: () => makeBinOp('+', makeBinOp('-', makeBinOp('+', makeLiteral(8), makeBinOp('*', makeNamed('variable', 'x', 3), makeNamed('constant', 'RATE', 2))), makeNamed('variable', 'y', 5)), makeLiteral(4)),
      tips: [
        'Substitute every variable and constant into a plain number first — that turns the whole line into ordinary arithmetic.',
        'From there, resolve precedence and left-to-right ties exactly as with any other expression.'
      ]
    },
    'mixed-mastery': {
      heading: 'Mixed Mastery',
      rule: [
        'Everything so far compounds here: literals, variables, constants, negative values, every arithmetic operator including %, and parentheses that override precedence when required.'
      ],
      // RATE=5, x=-3, y=8, literal 6, SCALE=2 —
      // (RATE + x) * y - 6 % SCALE: the parens force RATE+x to resolve
      // before the *, since * outranks +: RATE+x=5+(-3)=2, 2*y=2*8=16;
      // separately 6%SCALE=6%2=0; 16-0=16.
      buildExampleTree: () => makeBinOp('-', makeBinOp('*', makeBinOp('+', makeNamed('constant', 'RATE', 5), makeNamed('variable', 'x', -3)), makeNamed('variable', 'y', 8)), makeBinOp('%', makeLiteral(6), makeNamed('constant', 'SCALE', 2))),
      tips: [
        'Work in layers: substitute every value first, then resolve anything forced by parentheses, then apply ordinary precedence to what remains.',
        "Don't let a negative value change the rules — it's still just a value being operated on."
      ]
    },
    'unary-only': {
      heading: 'Unary ++ / -- Only',
      rule: [
        'Every operand here is a variable carrying a prefix or postfix ++ or --, and that unary step ALWAYS resolves before the surrounding + / - operators touch it.',
        'Prefix changes the value first; postfix uses the original value, and the change only registers after.'
      ],
      // ++x (prefix, x=5 -> used as 6) + y-- (postfix, y=10 -> used as
      // the ORIGINAL 10) - --z (prefix, z=3 -> used as 2):
      // 6 + 10 - 2 = 14.
      buildExampleTree: () => makeBinOp('-', makeBinOp('+', makeUnary('++', 'prefix', makeNamed('variable', 'x', 5)), makeUnary('--', 'postfix', makeNamed('variable', 'y', 10))), makeUnary('--', 'prefix', makeNamed('variable', 'z', 3))),
      tips: [
        'Resolve each unary operator on its own variable before combining anything with + or -.',
        "Prefix (++x) acts immediately; postfix (x++) uses the variable's original value first."
      ]
    },
    'unary-mix': {
      heading: 'Unary Mixed with Literals, Variables & Constants',
      rule: [
        'Only SOME of the variable operands carry a ++ or -- here — literals and constants never do.',
        'Check each operand individually: resolve any unary step on a variable first, then treat the result like any other plain value.'
      ],
      // literal 4, ++x (prefix, x=3 -> used as 4), RATE=5, y=6 (no
      // unary), literal 2 — 4 + ++x * RATE - y * 2:
      // ++x*RATE=4*5=20, 4+20=24; y*2=6*2=12; 24-12=12.
      buildExampleTree: () => makeBinOp('-', makeBinOp('+', makeLiteral(4), makeBinOp('*', makeUnary('++', 'prefix', makeNamed('variable', 'x', 3)), makeNamed('constant', 'RATE', 5))), makeBinOp('*', makeNamed('variable', 'y', 6), makeLiteral(2))),
      tips: [
        'Check each operand one at a time — a literal or constant is always plain, but a variable might carry ++/-- that needs resolving first.',
        'Once every unary step is resolved, precedence works exactly like the fully-arithmetic profiles.'
      ]
    },
    'relational-simple': {
      heading: 'Relational Operators (Simple)',
      rule: [
        'Comparison operators (<, >, <=, >=, ==, !=) sit BELOW arithmetic in precedence.',
        'Whatever arithmetic surrounds a comparison always finishes first; the comparison itself runs last and produces a true/false result.'
      ],
      // 5 + 3 > 6 — the + finishes first (5+3=8), then the comparison
      // runs last: 8 > 6 = true.
      buildExampleTree: () => makeBinOp('>', makeBinOp('+', makeLiteral(5), makeLiteral(3)), makeLiteral(6)),
      tips: [
        'Resolve all the arithmetic on both sides first, exactly as if the comparison weren\u2019t there.',
        'Only once each side is a single number does the comparison itself run.'
      ]
    },
    'relational-variables': {
      heading: 'Relational Operators with Variables',
      rule: [
        "A comparison's operands can be variables or constants, not just literals.",
        'Substitute those first, let any arithmetic finish, and only then does the comparison run — same order as with plain literals.'
      ],
      // x=4, literal 2, LIMIT=10 — x + 2 <= LIMIT: x+2=4+2=6, 6<=10=true.
      buildExampleTree: () => makeBinOp('<=', makeBinOp('+', makeNamed('variable', 'x', 4), makeLiteral(2)), makeNamed('constant', 'LIMIT', 10)),
      tips: [
        'Substitute every variable and constant into a plain number first, on both sides of the comparison.',
        'The comparison is still always the last thing to run, no matter what its operands are made of.'
      ]
    },
    'relational-boolean-mix': {
      heading: 'Relational + Boolean Mix (with !)',
      rule: [
        'A single relational comparison always resolves first and produces a true/false result.',
        'From there, && and || combine that result with boolean variables — some of which may carry a leading ! that flips them before they\u2019re used.'
      ],
      // 8 > 5 (true) && flag1(true) || !flag2 (flag2=false, so !flag2 =
      // true): true && true = true; true || true = true.
      buildExampleTree: () => makeBinOp('||', makeBinOp('&&', makeBinOp('>', makeLiteral(8), makeLiteral(5)), makeNamed('variable', 'flag1', true)), makeUnary('!', 'prefix', makeNamed('variable', 'flag2', false))),
      tips: [
        'Resolve the relational comparison to true or false first — that always happens before && or ||.',
        'Resolve any ! on a boolean variable next, then combine everything left to right with && / ||.'
      ]
    },
    'declaration-chain': {
      heading: 'Declaration Chain',
      rule: [
        'Execute declarations from top to bottom so each name receives a value in memory.',
        'A later initializer may use a variable or constant assigned by an earlier statement. Resolve that initializer first, then click = to commit its value.',
        'The final expression unlocks only after every required declaration has been assigned.'
      ],
      buildExampleTree: () => makeBinOp('-', makeBinOp('*', makeNamed('variable', 'y', 15), makeNamed('constant', 'RATE', 2)), makeNamed('variable', 'x', 10)),
      tips: [
        'A name cannot be substituted until its declaration has completed.',
        'Declaration checks and final-expression checks share the item’s point budget.'
      ]
    }
  };

  function buildFallbackLesson(profile){
    const opsList = Array.isArray(profile.allowedOperators) ? profile.allowedOperators.join('  ') : '?';
    return [
      `LESSON: ${profile.name || profile.id}`,
      '',
      (profile.description || 'No description available for this profile yet.'),
      '',
      `operators in play : ${opsList}`,
      `parentheses       : ${profile.parentheses ? 'yes' : 'no'}`,
      '',
      '(Full step-by-step lesson for this profile is coming soon —',
      " this is the generic fallback view.)"
    ].join('\n');
  }

  // Runs a lesson's own buildExampleTree() through the SAME
  // buildCanonicalTrace() (engine.js) every other derivation in this app
  // uses — live session, answer-key playback, everything. Returns
  // {steps, finalValue, treeStates}, identical in shape to
  // item.canonicalTrace.
  function buildLessonExampleTrace(lesson){
    const tree = lesson.buildExampleTree();
    return buildCanonicalTrace(tree);
  }

  // Mirrors buildColorMap()'s (dom-helpers.js) exact "first-touch wins per
  // resultNodeId" keying — same node-id keys a real colorMap would produce
  // for these same steps — but maps every key to the fixed TERMINAL_GREEN
  // instead of that function's per-step rainbow. renderStaticExpr() reads
  // whatever color this map gives it and applies it inline per-token, so
  // supplying green here is enough on its own to make every "produced"
  // token green — no CSS override needed for those specific tokens.
  function buildGreenColorMap(steps, uptoCount){
    const map = new Map();
    for(let i=0; i<uptoCount; i++){
      const id = steps[i].resultNodeId;
      if(!map.has(id)) map.set(id, TERMINAL_GREEN);
    }
    return map;
  }

  // Renders a canonical trace using the SAME row-building calls
  // renderCanonicalPlayback() (render-session.js) uses for the "Show
  // correct solution" playback — renderStaticExpr, pendingNodeId — so the
  // GEOMETRY (rows, tokens, node ids) is identical to how a real correct
  // derivation is shown elsewhere in the app. Differs from that function
  // in two ways: (1) every row is already "revealed" (no pb.index /
  // .tl-future gating, no Play/Pause controls, no row-enter/flash
  // animation classes), since this is a static reference embedded in a
  // lesson, not a live playback; and (2) COLOR comes from
  // buildGreenColorMap()/TERMINAL_GREEN above, not buildColorMap()/
  // stepColor()'s rainbow — see the file header's "TERMINAL COLOR
  // PALETTE" note for why.
  function renderLessonExampleTimeline(canonicalTrace){
    const { steps, treeStates } = canonicalTrace;
    const total = steps.length;
    const timeline = h('div',{class:'timeline console-drawer-example-timeline'});

    // Row 0: the untouched original expression — same as
    // renderCanonicalPlayback's own state0Row, minus pb.index/row-enter.
    // Its dot stays the same neutral "not yet stepped" gray the live/
    // playback panels use for this same row (#4b5364) — that's already a
    // neutral, non-rainbow color, so it needs no terminal override.
    const pend0 = pendingNodeId(steps[0], treeStates[0]);
    timeline.appendChild(h('div',{class:'tl-row done'},
      h('div',{class:'tl-dot', style:'background:#4b5364;'}),
      h('div',{class:'code-out'},
        renderStaticExpr(treeStates[0], 0, new Map(), null, pend0, TERMINAL_GREEN), ';')
    ));

    // One row per step, all fully revealed, all in TERMINAL_GREEN.
    for(let i=0; i<total; i++){
      const colorMap = buildGreenColorMap(steps, i+1);
      const nextStep = steps[i+1];
      const pendId = nextStep ? pendingNodeId(nextStep, treeStates[i+1]) : null;
      const tip = stepTooltip(steps[i]);
      const row = h('div',{class:'tl-row done'});
      row.appendChild(h('div',{class:'tl-dot', style:`background:${TERMINAL_GREEN};`, title: tip}));
      row.appendChild(h('div',{class:'code-out'},
        renderStaticExpr(treeStates[i+1], 0, colorMap, null, pendId, nextStep ? TERMINAL_GREEN : null), ';'));
      timeline.appendChild(row);
    }

    return timeline;
  }

  // Assembles the full lesson as a real DOM node — heading, rule prose,
  // the engine-derived worked example timeline, its result, and tips.
  // Takes the already-built trace/timelineEl (rather than building them
  // itself) so the caller can hold onto that SAME timelineEl reference and
  // draw connector lines against it after it's attached to the live DOM —
  // see drawLessonConnectorLines() / syncConsoleDrawer() below. Returned
  // as a Node (not a string) so it can be passed straight to
  // setConsoleDrawerContent(), which accepts either (see console-drawer.js).
  function buildLessonNode(lesson, canonicalTrace, timelineEl){
    const wrap = h('div',{class:'console-drawer-lesson'});

    wrap.appendChild(h('div',{class:'lesson-heading'}, `LESSON: ${lesson.heading}`));

    const ruleBlock = h('div',{class:'lesson-rule'});
    lesson.rule.forEach(line => ruleBlock.appendChild(h('div',{}, line)));
    wrap.appendChild(ruleBlock);

    wrap.appendChild(h('div',{class:'lesson-example-label'}, 'Worked example (not your actual item — just the pattern):'));
    wrap.appendChild(timelineEl);
    wrap.appendChild(h('div',{class:'lesson-result'}, `Result: ${formatValue(canonicalTrace.finalValue)}`));

    const tipsBlock = h('div',{class:'lesson-tips'});
    lesson.tips.forEach(t => tipsBlock.appendChild(h('div',{}, '* ' + t)));
    wrap.appendChild(tipsBlock);

    return wrap;
  }

  // Draws the operator→result connector arrows onto an already-DOM-attached
  // lesson timeline, exactly the way connector-lines.js's own
  // drawConnectorLines()/drawCanonicalConnectorLines() do for the live
  // session / solution-playback panels — same buildConnectorVisuals() call,
  // same appendConnectorSvg() call — just against our own timelineEl
  // instead of a hardcoded '.eval-panel'/'.solution-playback' selector.
  // MUST be called only after timelineEl is actually attached to the live
  // document (i.e. after setConsoleDrawerContent has appended the node it's
  // part of) — getBoundingClientRect() on a detached node returns an
  // all-zero rect, which would silently draw zero-length/invisible lines.
  // Honors the same global state.showConnectors toggle the header's
  // "Links on/off" control drives elsewhere in the app, for consistency.
  function drawLessonConnectorLines(canonicalTrace, timelineEl){
    try{
      if(!timelineEl) return;
      const stale = timelineEl.querySelector('.connector-svg');
      if(stale) stale.remove();
      if(!state.showConnectors) return;
      if(typeof buildConnectorVisuals !== 'function' || typeof appendConnectorSvg !== 'function') return;
      const steps = canonicalTrace.steps;
      if(!steps || steps.length===0) return;

      const rows = timelineEl.querySelectorAll('.tl-row');
      const panelRect = timelineEl.getBoundingClientRect();
      const {paths, dots} = buildConnectorVisuals(panelRect, rows, steps, steps.length);

      // buildConnectorVisuals() colors each line/dot via connector-lines.js's
      // own originColorForStep()/stepColor() rainbow — right for the live/
      // solution panels it was written for, wrong for this drawer's
      // single-color terminal look. Recolor the elements it just built
      // rather than duplicating its geometry logic: isCurrent/isPast
      // weighting (opacity, stroke-width, dash pattern — all driven by the
      // connector-line-current/-past classes already on these elements)
      // is untouched; only the hue changes.
      paths.forEach(p => p.setAttribute('stroke', TERMINAL_GREEN));
      dots.forEach(d => d.setAttribute('fill', TERMINAL_GREEN));

      appendConnectorSvg(timelineEl, paths, dots);
    }catch(e){ /* decorative arrows must never break the drawer */ }
  }

  function syncConsoleDrawer(){
    try{
      if(typeof state !== 'object' || !state) return;

      // No session yet (still on the login screen) — nothing meaningful to
      // show. Hide the tab and make sure the panel isn't left open behind
      // the login overlay.
      if(state.screen !== 'session'){
        if(typeof hideConsoleDrawerTab === 'function') hideConsoleDrawerTab();
        if(typeof isConsoleDrawerOpen === 'function' && isConsoleDrawerOpen()
           && typeof closeConsoleDrawer === 'function') closeConsoleDrawer();
        return;
      }

      const profile = (typeof currentProfile === 'function') ? currentProfile() : null;
      const profileLabel = profile ? (profile.name || profile.title || profile.id || 'Profile') : 'Console';
      if(typeof setConsoleDrawerTitle === 'function') setConsoleDrawerTitle(`Lesson — ${profileLabel}`);

      const lesson = profile ? LESSONS[profile.id] : null;
      if(!lesson){
        // No profile, or no authored lesson yet for this one — plain-text
        // fallback, no worked example/connector lines to draw.
        if(typeof setConsoleDrawerContent === 'function'){
          setConsoleDrawerContent(profile ? buildFallbackLesson(profile) : 'No active profile.', {cursor:false});
        }
        if(typeof showConsoleDrawerTab === 'function') showConsoleDrawerTab();
        return;
      }

      try{
        const canonicalTrace = buildLessonExampleTrace(lesson);
        const timelineEl = renderLessonExampleTimeline(canonicalTrace);
        const node = buildLessonNode(lesson, canonicalTrace, timelineEl);
        if(typeof setConsoleDrawerContent === 'function') setConsoleDrawerContent(node, {cursor:false});
        // Only now — after setConsoleDrawerContent has attached `node`
        // (and therefore timelineEl, the same object reference) to the
        // live document — can connector-line geometry be measured.
        drawLessonConnectorLines(canonicalTrace, timelineEl);
      }catch(e){
        // buildCanonicalTrace can in principle throw EngineError (e.g.
        // STUCK — see engine.js), though not for this fixed, hand-picked
        // tree. Degrade to the plain-text fallback rather than leaving the
        // drawer in a half-built state.
        if(typeof setConsoleDrawerContent === 'function') setConsoleDrawerContent(buildFallbackLesson(profile), {cursor:false});
      }

      if(typeof showConsoleDrawerTab === 'function') showConsoleDrawerTab();
    }catch(e){ /* placeholder wiring must never surface an error */ }
  }

  function tick(){
    const sig = computeSignature();
    if(sig !== lastSignature){
      lastSignature = sig;
      syncConsoleDrawer();
    }
  }

  setInterval(tick, POLL_MS);
  // Also run once immediately (rather than waiting for the first interval
  // tick) so the tab/content are correct as soon as this script executes,
  // for whichever state already exists at that point (e.g. a resumed exam
  // session set up synchronously earlier in main.js). Note this file loads
  // BEFORE render-tree.js/render-session.js/dom-helpers.js's later
  // functions run their own top-level setup, but this first call only
  // ever *references* their functions inside a try/catch (syncConsoleDrawer
  // -> buildDrawerContent -> buildLessonNode -> renderStaticExpr etc.), so
  // if any of them aren't defined yet this immediate call just no-ops
  // silently and the next 250ms tick (by which point every script on the
  // page has finished loading) succeeds normally.
  tick();
})();
