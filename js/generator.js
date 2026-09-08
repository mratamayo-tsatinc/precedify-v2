// ============================================================================
// GENERATOR — template-driven profile configuration
// ============================================================================

// ----------------------------------------------------------------------------
// Seeded RNG — unchanged from the original generator.js.
// ----------------------------------------------------------------------------
let currentSeed = 0;
let seededRandom = Math.random;

function initializeSeededRandom(seed) {
  currentSeed = seed >>> 0;
  seededRandom = function() {
    currentSeed = (currentSeed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(currentSeed ^ (currentSeed >>> 15), 1 | currentSeed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function resetRandomGenerator() { seededRandom = Math.random; }
function randInt(min, max) { return Math.floor(seededRandom() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(seededRandom() * arr.length)]; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const VAR_NAMES = ['x','y','z','a','b','c','m','n'];
const CONST_NAMES = ['RATE','LIMIT','FACTOR','BASE','STEP','SCALE'];
const RESULT_NAMES = ['result','value','output','total','answer','tally','outcome'];
function pickResultName(usedNames){
  const avail = RESULT_NAMES.filter(n => !usedNames.includes(n));
  return pick(avail.length ? avail : RESULT_NAMES);
}

// Every operator the engine actually recognizes (prec()/evalOp() in
// engine.js) — the single source of truth for validating `allowed`/`exclude`,
// so this can never drift from what the engine actually enforces.
const ENGINE_OPERATORS = new Set(['+','-','*','/','%','<','>','<=','>=','==','!=','&&','||']);
const COMPARISON_OPS = new Set(['<','>','<=','>=','==','!=']);

function resolvedAllowedOperators(profile){
  const excl = profile.operators.exclude || [];
  return profile.operators.allowed.filter(op => !excl.includes(op));
}

// ----------------------------------------------------------------------------
// Tier keywords — derived directly from prec()'s own tier numbers, never a
// second hand-maintained grouping (the old CLASS_LOW/CLASS_HIGH arrays this
// replaces could theoretically drift from prec(); this can't).
// ----------------------------------------------------------------------------
const TIER_KEYWORDS = {
  low:  op => prec(op) === 5,   // + -
  high: op => prec(op) === 6,   // * / %
  cmp:  op => prec(op) === 4,   // < > <= >=
  eq:   op => prec(op) === 3,   // == !=
  and:  op => prec(op) === 2,   // &&
  or:   op => prec(op) === 1,   // ||
  op:   () => true,              // no filtering — draw from allowed as-is
};
function resolveTier(allowed, tierKeyword){
  const predicate = TIER_KEYWORDS[tierKeyword];
  if(!predicate) throw new Error(`Unknown tier keyword '${tierKeyword}'`);
  const filtered = allowed.filter(predicate);
  if(filtered.length === 0) throw new Error(`No operator in 'allowed' matches tier '${tierKeyword}'`);
  return filtered;
}

// ----------------------------------------------------------------------------
// Operand resolution: pinned slots (operand:lit / :var / :const) are
// generated directly per their declared kind; free (unpinned) slots draw
// from a shuffled pool sized by shape.operandSources — exactly today's
// makeOperands() mechanism, scoped to only the free slots. Naming counters
// (vi/ci) and unary-wrap rolls are shared across pinned+free, incrementing
// in final template (document) order, matching the original's behavior.
// ----------------------------------------------------------------------------
function buildFreePool(operandSources, freeSlotCount){
  const pool = [];
  for(let i=0;i<(operandSources.literal||0); i++) pool.push('literal');
  for(let i=0;i<(operandSources.variable||0); i++) pool.push('variable');
  for(let i=0;i<(operandSources.constant||0); i++) pool.push('constant');
  while(pool.length < freeSlotCount) pool.push('literal');
  shuffle(pool);
  return pool.slice(0, freeSlotCount);
}

function resolveOperandLeaves(specs, profile){
  let freeCursor = 0;
  const freeCount = specs.filter(s => !s.spec.kind).length;
  const pool = buildFreePool(profile.shape.operandSources || {}, freeCount);
  const slotKinds = specs.map(s => s.spec.kind || pool[freeCursor++]);

  const shuffledConstNames = shuffle(CONST_NAMES.slice());
  let vi = 0, ci = 0;
  const decls = [];
  const leaves = specs.map((s, idx) => {
    const kind = slotKinds[idx];
    const spec = s.spec;
    if(kind === 'literal'){
      let v = randInt(profile.shape.operandRange.min, profile.shape.operandRange.max);
      // NOTE (behavior fix vs. the original app): the sign roll here now
      // uses seededRandom(), not raw Math.random(). The shipped app calls
      // Math.random() for this specific roll (and for the unaryWrap fraction
      // roll below), which silently breaks seeded reproducibility for
      // exactly those two decisions — a real latent bug, surfaced by
      // needing to faithfully re-derive this function. Fixed here since the
      // file's own header states the RNG's whole purpose is "reproducible
      // randomization when starting a session."
      if(profile.shape.allowNegativeOperands && seededRandom() < 0.3) v = -v;
      return makeLiteral(v);
    }
    if(kind === 'variable'){
      const name = VAR_NAMES[vi++ % VAR_NAMES.length];
      const v = spec.bool ? (seededRandom() < 0.5) : randInt(profile.shape.operandRange.min, profile.shape.operandRange.max);
      decls.push({kind:'variable', name, value:v, isBoolean: !!spec.bool});
      let node = makeNamed('variable', name, v);
      // Unlike the original (which applied unaryWrap's fraction roll to
      // EVERY variable-kind operand, blanket, regardless of position), this
      // makes the ':unary' tag load-bearing: a variable slot is only
      // unary-eligible if its template token explicitly says so. This is a
      // deliberate, documented refinement — see the implementation notes —
      // and is behavior-identical for all 18 current profiles, since
      // unary-only/unary-mix already tag every one of their slots ':unary'.
      if(spec.unary && profile.extras.unaryWrap.enabled && seededRandom() < profile.extras.unaryWrap.fraction){
        const op = pick(profile.extras.unaryWrap.operators);
        const form = op === '!' ? 'prefix' : pick(profile.extras.unaryWrap.forms);
        node = makeUnary(op, form, node);
      }
      return node;
    }
    // constant
    const name = shuffledConstNames[ci++ % shuffledConstNames.length];
    const v = randInt(profile.shape.operandRange.min, profile.shape.operandRange.max);
    decls.push({kind:'constant', name, value:v});
    return makeNamed('constant', name, v);
  });
  return {leaves, decls};
}

// ----------------------------------------------------------------------------
// Tree builder: ONE generic precedence-climbing interpreter, replacing
// foldLeft / precedenceParse / buildParenOverride* / buildRelationalBooleanMix.
// An explicit parenthesized group in the template parses to its own chain
// node (template-engine.js), which is built FIRST as a complete, opaque
// subtree, and only then handed to the surrounding level's climb as a single
// term — this is what lets '(' in a template override what free
// precedence-climbing on a flat run would otherwise produce, exactly
// reproducing every hand-written *_override builder (verified by hand
// against buildParenOverride/-Multi/-Dual's actual output — see the
// implementation notes / test-generator.js).
// ----------------------------------------------------------------------------
function buildTreeFromAst(ast, ctx){
  if(ast.type === 'operand') return ctx.leaves[ctx.cursor.i++];
  return buildChain(ast, ctx);
}
function buildChain(ast, ctx){
  const terms = ast.terms.map(t => buildTreeFromAst(t, ctx)); // nested groups built first, recursively
  const ops = ast.tiers.map(tier => pick(resolveTier(ctx.effectiveAllowed, tier)));
  let ti = 0, oi = 0;
  function parse(minPrec){
    let left = terms[ti++];
    while(oi < ops.length && prec(ops[oi]) >= minPrec){
      const op = ops[oi++];
      const right = parse(prec(op) + 1);
      left = makeBinOp(op, left, right);
    }
    return left;
  }
  return parse(0);
}

// ----------------------------------------------------------------------------
// Type inference — a generation-time postcondition, not an interaction-time
// gate (see profile-config-proposal.md section 8 for why no interaction
// change is needed: comparisons always outrank logic operators in prec(),
// so a type-crossing click is already caught by the existing generic
// precedence-scoring machinery). This is what makes maxComparisons safe to
// raise above 1 — it rejects whatever SPECIFIC combination would actually be
// invalid Java/C, rather than capping a count that can't express the real
// rule (== / != accept matching-type operands, either two numerics or two
// booleans; < > <= >= only ever accept two numerics).
// ----------------------------------------------------------------------------
class TypeCheckFail extends Error {}
function inferType(node){
  if(node.kind === 'literal') return 'num'; // at GENERATION time, literals are always numeric (see note below)
  if(node.kind === 'variable' || node.kind === 'constant'){
    // declaredValue is already a genuine JS boolean when boolean-valued
    // (set directly in resolveOperandLeaves via seededRandom()<0.5) — no
    // separate flag needs stamping onto the node; typeof is reliable.
    return typeof node.declaredValue === 'boolean' ? 'bool' : 'num';
  }
  if(node.kind === 'unary') return node.op === '!' ? 'bool' : 'num';

  const lt = inferType(node.left), rt = inferType(node.right), op = node.op;
  if(['<','>','<=','>='].includes(op)){
    if(lt !== 'num' || rt !== 'num') throw new TypeCheckFail(`${op} needs numeric operands, got ${lt}/${rt}`);
    return 'bool';
  }
  if(op === '==' || op === '!='){
    if(lt !== rt) throw new TypeCheckFail(`${op} needs matching types, got ${lt}/${rt}`);
    return 'bool';
  }
  if(op === '&&' || op === '||'){
    if(lt !== 'bool' || rt !== 'bool') throw new TypeCheckFail(`${op} needs boolean operands, got ${lt}/${rt}`);
    return 'bool';
  }
  if(lt !== 'num' || rt !== 'num') throw new TypeCheckFail(`${op} needs numeric operands, got ${lt}/${rt}`);
  return 'num';
}
// NOTE on the 'literal' branch always returning 'num': inferType only ever
// runs once, on the freshly-built tree straight out of buildTreeFromAst,
// before any EVALUATE step has occurred — at that point every literal leaf
// came from resolveOperandLeaves' numeric-only makeLiteral(v) calls. A
// literal CAN become boolean-valued later, mid-derivation (evaluateFlatAt /
// buildCanonicalTrace both call makeLiteral(result) for comparison/logical
// EVALUATE steps) — but that's the student's interactive derivation, a
// different tree entirely from the one this generation-time check inspects.

// treeUsesTwoClasses / countComparisonOps — generic tree-walking
// postconditions, unchanged in spirit from the original generator.js.
function treeUsesTwoClasses(node, seen){
  seen = seen || new Set();
  if(node.kind === 'binop'){ seen.add(prec(node.op)); treeUsesTwoClasses(node.left, seen); treeUsesTwoClasses(node.right, seen); }
  return seen.size >= 2;
}
function countComparisonOps(node){
  if(node.kind !== 'binop') return 0;
  const self = COMPARISON_OPS.has(node.op) ? 1 : 0;
  return self + countComparisonOps(node.left) + countComparisonOps(node.right);
}

// ----------------------------------------------------------------------------
// Validation — runs once at load, fails loud with a profile-specific message
// instead of surfacing as a mysterious GENERATION_FAILED deep in a retry loop.
// ----------------------------------------------------------------------------
function validateProfiles(profiles){
  for(const p of profiles){
    let ast;
    try{ ast = parseTemplate(p.template); }
    catch(e){ throw new Error(`Profile "${p.meta.id}": template parse error: ${e.message}`); }
    p._ast = ast;

    const specs = collectOperandSpecs(ast, []);
    const freeCount = specs.filter(s => !s.spec.kind).length;
    const poolTotal = Object.values(p.shape.operandSources || {}).reduce((a,b)=>a+b, 0);
    if(poolTotal !== freeCount){
      throw new Error(`Profile "${p.meta.id}": operandSources sums to ${poolTotal}, but the template needs ${freeCount} free operand slot(s)`);
    }

    for(const op of p.operators.allowed){
      if(!ENGINE_OPERATORS.has(op)) throw new Error(`Profile "${p.meta.id}": "${op}" isn't a recognized operator`);
    }
    const excl = p.operators.exclude || [];
    for(const op of excl){
      if(!p.operators.allowed.includes(op)) throw new Error(`Profile "${p.meta.id}": exclude contains "${op}", which isn't in allowed`);
    }
    const effectiveAllowed = resolvedAllowedOperators(p);
    if(effectiveAllowed.length === 0) throw new Error(`Profile "${p.meta.id}": allowed minus exclude leaves no usable operators`);

    const usedTiers = collectTierKeywords(ast, []);
    for(const tier of usedTiers){
      const filtered = effectiveAllowed.filter(TIER_KEYWORDS[tier]);
      if(filtered.length === 0) throw new Error(`Profile "${p.meta.id}": tier '${tier}' matches no operator in allowed`);
      if(tier !== 'op' && filtered.length === effectiveAllowed.length){
        console.warn(`Profile "${p.meta.id}": template uses '${tier}', but operators.allowed is already exactly that tier — consider 'op' instead.`);
      }
    }

    const c = p.operators.constraints || {};
    const cmpEqCount = usedTiers.filter(t => t === 'cmp' || t === 'eq').length;
    if(cmpEqCount >= 2 && (!c.maxComparisons || c.maxComparisons <= 1)){
      console.warn(`Profile "${p.meta.id}": template uses 'cmp'/'eq' ${cmpEqCount} times but maxComparisons is ${c.maxComparisons||1} — a nesting choice that can never actually arise.`);
    }
  }
}

// ----------------------------------------------------------------------------
// Points derivation — explicit scoring.pointsPerItem always wins; omitting
// it falls back to a complexity-derived tier. Every profile below specifies
// it explicitly (conservative migration — preserves today's hand-tuned
// values exactly), so derivation isn't exercised by default, but is
// available for new profiles.
// ----------------------------------------------------------------------------
function complexityScore(profile){
  let score = collectTierKeywords(profile._ast, []).length;
  if(profileUsesParens(profile.template)) score += 1;
  if(profile.extras.unaryWrap.enabled) score += 1;
  const kindsUsed = new Set(
    collectOperandSpecs(profile._ast, []).map(s => s.spec.kind).filter(Boolean)
  );
  Object.entries(profile.shape.operandSources || {}).forEach(([k,v]) => { if(v > 0) kindsUsed.add(k); });
  if(kindsUsed.size >= 3) score += 1;
  return score;
}
function derivedPointsPerItem(profile){
  const s = complexityScore(profile);
  if(s <= 3) return 1;
  if(s <= 5) return 2;
  return 3;
}
function resolvedPointsPerItem(profile){
  return profile.scoring.pointsPerItem != null ? profile.scoring.pointsPerItem : derivedPointsPerItem(profile);
}

// ----------------------------------------------------------------------------
// finalizeProfile — normalizes extras with defaults, parses+caches the
// template AST, and adds flat top-level aliases (id/name/description/
// itemCount/pointsPerItem) so existing consumer code (state.js, login.js,
// render-setup.js, score-summary.js) keeps working against
// PROFILES.find(p=>p.id===...), profile.pointsPerItem, etc. with zero
// changes to those files.
// ----------------------------------------------------------------------------
const DEFAULT_EXTRAS = { unaryWrap: {enabled:false, operators:[], forms:[], fraction:0} };
function finalizeProfile(raw){
  const p = {
    meta: raw.meta,
    shape: Object.assign({operandSources:{}}, raw.shape),
    operators: Object.assign({}, raw.operators),
    extras: Object.assign({}, DEFAULT_EXTRAS, raw.extras, {
      unaryWrap: Object.assign({}, DEFAULT_EXTRAS.unaryWrap, (raw.extras && raw.extras.unaryWrap) || {})
    }),
    scoring: Object.assign({}, raw.scoring),
    // Program behavior is opt-in. Existing profiles omit this field and are
    // adapted to the unchanged single-expression activity by state.js.
    program: raw.program ? Object.assign({}, raw.program) : null,
    template: raw.template,
  };
  p._ast = parseTemplate(p.template);
  p.id = p.meta.id;
  p.name = p.meta.name;
  p.description = p.meta.description;
  p.itemCount = p.scoring.itemCount;
  p.pointsPerItem = resolvedPointsPerItem(p);
  return p;
}


// ----------------------------------------------------------------------------
// generateInstance — replaces makeOperands+buildTree with the template
// interpreter, but keeps the exact same outer retry loop and return shape
// generateItemsForProfile() (state.js) already expects: {tree, decls,
// correctFinalValue, canonicalTrace, profile, resultName}.
// ----------------------------------------------------------------------------
const MAX_ABS_VALUE = 100000;

function generateInstance(profile){
  const effectiveAllowed = resolvedAllowedOperators(profile);
  const specTemplate = collectOperandSpecs(profile._ast, []);
  for(let attempt = 0; attempt < 300; attempt++){
    const {leaves, decls} = resolveOperandLeaves(specTemplate, profile);
    const ctx = {leaves, cursor:{i:0}, effectiveAllowed};
    let tree;
    try{ tree = buildTreeFromAst(profile._ast, ctx); } catch(e){ continue; }

    let finalValue;
    try{ finalValue = evalTree(tree); } catch(e){ continue; }
    if(Math.abs(finalValue) > MAX_ABS_VALUE) continue;

    const c = profile.operators.constraints || {};
    if(c.requireMultipleTiers && !treeUsesTwoClasses(tree)) continue;
    if(c.maxComparisons != null && countComparisonOps(tree) > c.maxComparisons) continue;

    try{ inferType(tree); } catch(e){ if(e instanceof TypeCheckFail) continue; throw e; }

    let canonical;
    try{ canonical = buildCanonicalTrace(tree); } catch(e){ continue; }
    if(canonical.finalValue !== finalValue) continue;

    const resultName = pickResultName(decls.map(d => d.name));
    return {tree, decls, correctFinalValue: finalValue, canonicalTrace: canonical, profile, resultName};
  }
  throw new EngineError('GENERATION_FAILED');
}
