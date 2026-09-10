// ============================================================================
// PROFILES — pure input data. Every exercise "flavor" the app can generate
// lives in this file, and ONLY this file: what operators are allowed, what
// operand mix, what shape the expression takes, how many items, how much
// each is worth. Nothing here is generation LOGIC — that's generator.js's
// job entirely (template parsing, operand resolution, tree building, type
// safety, validation). This file's only responsibility is describing WHAT
// to generate; generator.js is HOW.
//
// To add a new profile: add one object to PROFILES_RAW below and reload —
// validateProfiles() (generator.js) runs automatically at the bottom of
// this file and will throw immediately, naming the exact profile and
// problem, if anything doesn't line up (operand count mismatch, unknown
// operator, unresolvable tier keyword, etc.). See how-to-create-a-profile.md
// for a full walkthrough from minimal defaults to advanced atomic control.
//
// Depends on generator.js having already loaded (needs prec()-derived tier
// resolution, finalizeProfile, validateProfiles — see index.html's script
// order). Nothing in generator.js depends on this file — it never
// references a specific profile id, operator combination, or template by
// name, so this file can be edited freely without touching generator.js at
// all, and vice versa.
// ============================================================================

// ----------------------------------------------------------------------------
// Operator vocabulary. Only groups that are (a) a real, recognizable domain
// concept, or (b) reused verbatim by 2+ profiles, get a name here — see
// profile-config-proposal.md section 1 for the reasoning. Everything else is
// a literal array or a spread composition at its own profile's call site
// (see how-to-create-a-profile.md, Level 7).
// ----------------------------------------------------------------------------
const OPS = {
  ADD_SUB:     ['+','-'],
  ARITH_BASIC: ['+','-','*'],
  ARITH_ALL:   ['+','-','*','/'],
  COMPARISON:  ['<','>','<=','>=','==','!='],
  LOGICAL:     ['&&','||'],
  // NOTE: deliberately no '!' here or anywhere in OPS. '!' is never a binary
  // operator in this engine — prec()/evalOp() (engine.js) have no case for
  // it, only makeUnary() does. It only ever appears via a profile's
  // extras.unaryWrap.operators, never in an `allowed` list.
};

// ============================================================================
// THE ORIGINAL 18 PROFILES + OPT-IN PROGRAM EXTENSIONS — see
// profile-config-proposal.md for the original fields' full
// derivation, and this file's own validateProfiles()/test-generator.js for
// the fixes applied during actual implementation (several of which were
// only caught by building and running this, not by inspection):
//   - mixed-mastery's operandSources corrected (was summing to 6, not 5)
//     and its template now actually produces the parens its description
//     always claimed (was silently never true under the old evaluationPattern)
//   - literals-variables-constants' operandSources corrected (was summing to
//     6, not 5) -- the SAME class of bug as mixed-mastery, present in the
//     actual shipped generator.js and missed during the earlier by-hand
//     translation; only caught here because validateProfiles() actually
//     checks operand-slot counts against the template at load time
//   - parens-override-multi's template was initially transcribed with one
//     trailing operand instead of two, silently changing its shape (4
//     operands/3 tiers instead of the original's 5 operands/4 tiers) --
//     caught immediately by validateProfiles() rejecting the mismatch
//   - relational-boolean-mix uses cmp/and/or (not the coarser rel/logic),
//     and its template now uses EXPLICIT grouping to deterministically force
//     the required-parens moment its description promises, rather than
//     leaving it to chance. The original buildRelationalBooleanMix's
//     "sometimes needs parens" behavior turned out to be an ACCIDENT of
//     naive left-folding disagreeing with operator precedence (it could
//     build a lower-precedence '||' node where a higher-precedence '&&'
//     context would normally require parens) -- not a deliberate design.
//     Precedence-climbing (what every non-parenthesized template chain uses
//     here) is parens-free by construction, so achieving the SAME
//     pedagogical moment deterministically requires the template to say so
//     explicitly, via '('. Drops extras.booleanVariables in favor of the
//     template's own per-slot :bool tag.
//   - same-precedence-assoc / modulus use literal arrays; mixed-mastery uses
//     a spread composition — none of these are common enough to deserve a
//     named OPS constant
// ============================================================================
const PROFILES_RAW = [
  {
    meta: { id:'direct-ltr', name:'Direct Left-to-Right',
      description:'Establishes basic sequential evaluation. No precedence reasoning required.' },
    shape: { operandSources:{literal:4}, operandRange:{min:1,max:10}, allowNegativeOperands:false },
    operators: { allowed: OPS.ADD_SUB },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:1 },
  },
  {
    meta: { id:'mult-precedence', name:'Multiplication Precedence',
      description:'A higher-precedence operator must be evaluated before a lower one, regardless of position.' },
    shape: { operandSources:{literal:3}, operandRange:{min:1,max:10}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:1 },
  },
  {
    meta: { id:'same-precedence-assoc', name:'Same-Precedence Associativity',
      description:'Equal-precedence operators resolve strictly left to right.' },
    shape: { operandSources:{literal:4}, operandRange:{min:2,max:12}, allowNegativeOperands:false },
    operators: { allowed: ['*','/'] },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:3, pointsPerItem:1 },
  },
  {
    meta: { id:'full-basic-precedence', name:'Full Basic Precedence',
      description:'Combines +, -, *, / with genuine precedence and associativity requirements.' },
    shape: { operandSources:{literal:5}, operandRange:{min:1,max:10}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_ALL, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand op operand',
    scoring: { itemCount:3, pointsPerItem:2 },
  },
  {
    meta: { id:'modulus', name:'Modulus',
      description:'Introduces % and its precedence relationship with the other operators.' },
    shape: { operandSources:{literal:4}, operandRange:{min:2,max:8}, allowNegativeOperands:false },
    operators: { allowed: ['+','*','%'], constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:3, pointsPerItem:2 },
  },
  {
    meta: { id:'parens-override', name:'Parentheses Override',
      description:'Shows how explicit grouping overrides the normal precedence order.' },
    shape: { operandSources:{literal:4}, operandRange:{min:1,max:10}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_ALL },
    template: '(operand low operand) high operand high operand',
    scoring: { itemCount:3, pointsPerItem:2 },
  },
  {
    meta: { id:'parens-override-multi', name:'Parentheses Override (Multi-Operator)',
      description:'The parenthesized region itself contains two operators from different precedence tiers.' },
    shape: { operandSources:{literal:5}, operandRange:{min:1,max:12}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_ALL },
    template: '(operand low (operand high operand)) high operand high operand',
    scoring: { itemCount:3, pointsPerItem:3 },
  },
  {
    meta: { id:'parens-override-dual', name:'Parentheses Override (Two Separate Groups)',
      description:'Two independent parenthesized groups appear side by side in the same expression.' },
    shape: { operandSources:{literal:5}, operandRange:{min:1,max:12}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC },
    template: '(operand low operand) high (operand low operand) high operand',
    scoring: { itemCount:3, pointsPerItem:3 },
  },
  {
    meta: { id:'variables-arithmetic', name:'Variables + Arithmetic',
      description:'Introduces variable substitution before evaluation order becomes relevant.' },
    shape: { operandSources:{variable:3}, operandRange:{min:1,max:14}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:1 },
  },
  {
    meta: { id:'mixed-variables-literals', name:'Mixed Variables + Literals',
      description:'Combines variable substitution with a mix of literal operands.' },
    shape: { operandSources:{literal:2,variable:2}, operandRange:{min:1,max:16}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:2 },
  },
  {
    meta: { id:'variables-constants', name:'Variables + Constants',
      description:'Minimal exposure to declared constants alongside variables.' },
    shape: { operandSources:{variable:2,constant:2}, operandRange:{min:1,max:15}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:2 },
  },
  {
    meta: { id:'literals-variables-constants', name:'Literals + Variables + Constants',
      description:'Minimal exposure to literals with declared constants alongside variables.' },
    shape: { operandSources:{literal:1,variable:2,constant:2}, operandRange:{min:1,max:15}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:2 },
  },
  {
    meta: { id:'mixed-mastery', name:'Mixed Mastery',
      description:'Controlled mixture of variables, literals, constants, multiple precedence levels, and parentheses.' },
    shape: { operandSources:{literal:1,variable:2,constant:2}, operandRange:{min:1,max:20}, allowNegativeOperands:true },
    operators: { allowed: [...OPS.ARITH_ALL, '%'] },
    template: '(operand low operand) high operand op operand op operand',
    scoring: { itemCount:3, pointsPerItem:3 },
  },
  {
    meta: { id:'unary-only', name:'Unary ++ / -- Only',
      description:'Every operand is a variable carrying a prefix or postfix ++/-- that must be resolved before the remaining + / - operators run.' },
    shape: { operandSources:{variable:3}, operandRange:{min:1,max:20}, allowNegativeOperands:false },
    operators: { allowed: OPS.ADD_SUB },
    extras: { unaryWrap:{enabled:true, operators:['++','--'], forms:['prefix','postfix'], fraction:1.0} },
    template: 'operand:unary op operand:unary op operand:unary',
    scoring: { itemCount:3, pointsPerItem:2 },
  },
  {
    meta: { id:'unary-mix', name:'Unary Mixed with Literals, Variables & Constants',
      description:'++/-- appear only on some of the variable operands.' },
    shape: { operandSources:{literal:2,variable:2,constant:1}, operandRange:{min:1,max:8}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    extras: { unaryWrap:{enabled:true, operators:['++','--'], forms:['prefix','postfix'], fraction:0.6} },
    template: 'operand:unary op operand:unary op operand:unary op operand:unary op operand:unary',
    scoring: { itemCount:3, pointsPerItem:3 },
  },
  {
    meta: { id:'relational-simple', name:'Relational Operators (Simple)',
      description:'A comparison produces a boolean result — the arithmetic on either side still resolves first.' },
    shape: { operandSources:{literal:3}, operandRange:{min:1,max:11}, allowNegativeOperands:false },
    operators: { allowed: [...OPS.ADD_SUB, ...OPS.COMPARISON], constraints:{requireMultipleTiers:true, maxComparisons:1} },
    template: 'operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:1 },
  },
  {
    meta: { id:'relational-variables', name:'Relational Operators with Variables',
      description:'A comparison\u2019s operands include variables and constants, not just literals.' },
    shape: { operandSources:{literal:1,variable:1,constant:1}, operandRange:{min:1,max:10}, allowNegativeOperands:false },
    operators: { allowed: [...OPS.ADD_SUB, ...OPS.COMPARISON], constraints:{requireMultipleTiers:true, maxComparisons:1} },
    template: 'operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:2 },
  },
  {
    meta: { id:'relational-boolean-mix', name:'Relational + Boolean Mix (with !)',
      description:'A relational comparison is combined with boolean variables using && / ||, including one negated with a leading !.' },
    shape: { operandRange:{min:1,max:20}, allowNegativeOperands:false },
    operators: { allowed: [...OPS.COMPARISON, ...OPS.LOGICAL] },
    extras: { unaryWrap:{enabled:true, operators:['!'], forms:['prefix'], fraction:0.5} },
    // A flat 'and'/'or' chain (no explicit grouping) can NEVER force required
    // parens -- precedence-climbing always builds the unique tree that
    // already prints without them, by construction. The original
    // buildRelationalBooleanMix's "sometimes needs parens" behavior was an
    // ACCIDENT of naive left-folding disagreeing with precedence (it could
    // build AND(OR(...),...) even though OR has lower precedence than AND),
    // not a deliberate design. Explicit grouping makes it deterministic
    // instead: '||' (from 'or') always has lower precedence than '&&' (from
    // 'and'), so wrapping the cmp+or group and following with 'and' outside
    // ALWAYS produces required parens, every generated instance -- verified
    // in test-generator.js's structural check.
    template: '(operand:lit cmp operand:lit or operand:var:bool:unary) and operand:var:bool:unary',
    scoring: { itemCount:3, pointsPerItem:3 },
  },
  {
    meta: { id:'declaration-chain', name:'Declaration Chain',
      description:'Execute dependent variable and constant declarations before evaluating the final expression.' },
    // Every expression operand is named so it must first be initialized by
    // the generated declaration sequence. The final expression still uses
    // the same generator, flat evaluator and precedence rules as all other
    // profiles.
    shape: { operandSources:{variable:3,constant:1}, operandRange:{min:4,max:12}, allowNegativeOperands:false },
    operators: { allowed: OPS.ARITH_BASIC, constraints:{requireMultipleTiers:true} },
    template: 'operand op operand op operand op operand',
    scoring: { itemCount:2, pointsPerItem:3 },
    program: {
      declarations: 'interactive',
      dependencyMode: 'previous',
      scoreAssignments: true,
    },
  },
  {
    meta:{id:'assignment-basic',name:'Assignment: Replace with =',
      description:'Initialize a variable, replace its value with =, then use the updated value.'},
    shape:{operandSources:{variable:1,literal:1},operandRange:{min:3,max:10},allowNegativeOperands:false},
    operators:{allowed:OPS.ADD_SUB}, template:'operand op operand',
    scoring:{itemCount:2,pointsPerItem:1},
    program:{declarations:'interactive',assignmentLesson:'basic-set',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-add-sub',name:'Assignment: += and -=',
      description:'Trace consecutive addition and subtraction assignments on one variable.'},
    shape:{operandSources:{variable:1,literal:1},operandRange:{min:2,max:10},allowNegativeOperands:false},
    operators:{allowed:OPS.ADD_SUB}, template:'operand op operand',
    scoring:{itemCount:3,pointsPerItem:3},
    program:{declarations:'interactive',assignmentLesson:'add-sub',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-multiply',name:'Assignment: *=',
      description:'Apply multiplication assignment and observe the variable change in memory.'},
    shape:{operandSources:{variable:1,literal:1},operandRange:{min:2,max:12},allowNegativeOperands:false},
    operators:{allowed:OPS.ADD_SUB}, template:'operand op operand',
    scoring:{itemCount:2,pointsPerItem:2},
    program:{declarations:'interactive',assignmentLesson:'multiply',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-div-mod',name:'Assignment: /= and %=',
      description:'Compare integer quotient assignment with remainder assignment.'},
    shape:{operandSources:{variable:1,literal:1},operandRange:{min:6,max:20},allowNegativeOperands:false},
    operators:{allowed:OPS.ADD_SUB}, template:'operand op operand',
    scoring:{itemCount:3,pointsPerItem:3},
    program:{declarations:'interactive',assignmentLesson:'divide-remainder',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-rhs-expression',name:'Assignment: Expression on the Right',
      description:'Resolve a multi-step right-hand expression before applying a compound assignment.'},
    shape:{operandSources:{variable:2,literal:1},operandRange:{min:2,max:12},allowNegativeOperands:false},
    operators:{allowed:OPS.ARITH_BASIC}, template:'operand op operand op operand',
    scoring:{itemCount:2,pointsPerItem:4},
    program:{declarations:'interactive',assignmentLesson:'rhs-expression',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-sequential',name:'Assignment: Sequential Updates',
      description:'Follow several compound assignments that repeatedly update the same variable.'},
    shape:{operandSources:{variable:1,literal:1},operandRange:{min:3,max:11},allowNegativeOperands:false},
    operators:{allowed:OPS.ADD_SUB}, template:'operand op operand',
    scoring:{itemCount:2,pointsPerItem:4},
    program:{declarations:'interactive',assignmentLesson:'sequential',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-dependent',name:'Assignment: Variables and Constants',
      description:'Use an updated variable and an immutable constant in a later assignment.'},
    shape:{operandSources:{variable:2,constant:1},operandRange:{min:5,max:12},allowNegativeOperands:false},
    operators:{allowed:OPS.ARITH_BASIC}, template:'operand op operand op operand',
    scoring:{itemCount:3,pointsPerItem:3},
    program:{declarations:'interactive',assignmentLesson:'dependent',scoreAssignments:true},
  },
  {
    meta:{id:'assignment-advanced-chain',name:'Assignment: Advanced Chain',
      description:'Combine precedence, multiple variables, and dependent compound assignments.'},
    shape:{operandSources:{variable:3},operandRange:{min:2,max:10},allowNegativeOperands:false},
    operators:{allowed:OPS.ARITH_BASIC}, template:'operand op operand op operand',
    scoring:{itemCount:5,pointsPerItem:3},
    program:{declarations:'interactive',assignmentLesson:'advanced',scoreAssignments:true},
  },
  {
    meta:{id:'unary-update-sequence',name:'Unary Updates: ++ and -- Statements',
      description:'Apply prefix and postfix increment/decrement as standalone statements, then reuse the changed variables.'},
    shape:{operandSources:{variable:2,literal:1},operandRange:{min:4,max:12},allowNegativeOperands:false},
    operators:{allowed:OPS.ARITH_BASIC,constraints:{requireMultipleTiers:true}},
    template:'operand op operand op operand',
    scoring:{itemCount:3,pointsPerItem:3},
    program:{declarations:'interactive',unaryUpdateLesson:'standalone-sequence',scoreAssignments:true},
    manualResponses:{enabled:true,namedValueRate:50,operatorRate:50},
  },
  {
    meta:{id:'assignment-unary-advanced-chain',name:'Assignment + Unary: Advanced Chain',
      description:'Trace dependent compound assignments and standalone prefix/postfix updates before evaluating the final expression.'},
    shape:{operandSources:{variable:3,constant:1},operandRange:{min:4,max:8},allowNegativeOperands:false},
    operators:{allowed:OPS.ARITH_BASIC,constraints:{requireMultipleTiers:true}},
    template:'operand op operand op operand op operand',
    scoring:{itemCount:3,pointsPerItem:3},
    manualResponses:{enabled:true,namedValueRate:50,operatorRate:50},
    program:{declarations:'interactive',mixedUpdateLesson:'advanced-assignment-unary',scoreAssignments:true},
  },
  {
    meta:{id:'relational-logical-student-derived',name:'Relational + Logical: Student Derived',
      description:'Evaluate one mixed relational/logical expression while supplying selected retrieved and derived values.'},
    shape:{operandRange:{min:1,max:10},allowNegativeOperands:false},
    operators:{allowed:[...OPS.COMPARISON,...OPS.LOGICAL]},
    extras:{unaryWrap:{enabled:true,operators:['!'],forms:['prefix'],fraction:0.5}},
    template:'(operand:lit cmp operand:lit) and operand:var:bool:unary or operand:var:bool:unary',
    scoring:{itemCount:3,pointsPerItem:3},
    manualResponses:{enabled:true,namedValueRate:50,operatorRate:50},
  },
];

const PROFILES = PROFILES_RAW.map(finalizeProfile);
validateProfiles(PROFILES);
