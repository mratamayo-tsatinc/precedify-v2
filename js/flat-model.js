// ============================================================================
// INTERACTIVE (FLAT) EVALUATION MODEL
// ----------------------------------------------------------------------------
// The generator/canonical-trace code above builds a precedence-shaped binary
// tree, which is exactly right for independently deriving the correct answer
// and the correct step order. But that tree structure is the WRONG model for
// student interaction: in a binary tree, an operator can only be evaluated
// once its two immediate tree-children are values, which silently forces
// evaluation order onto the student (e.g. in "2 + 3 * 10" the "+" node's
// right child is the "*" subtree, so "+" is structurally unclickable until
// "*" fires — the student never actually has a choice). That defeats the
// brief's explicit requirement that a student be able to pick ANY operator —
// wrong precedence order, and even an operator that reaches across a
// parenthesized region — and see the (possibly wrong) result play out, with
// correctness judged only at the end/per-step, never enforced by disabling
// "wrong" tokens. Parentheses are real code the student must learn to read,
// not a hint the interface should force-resolve for them.
//
// So interaction always uses ONE fully flat run of leaf operands and
// operators, built straight from the original tree's left-to-right leaf
// order — no nesting, no opaque "must resolve first" region, ever. EVERY
// adjacent pair with two ready operands is clickable, including a pair that
// straddles where a parenthesis originally was.
//
// Parentheses are preserved as a non-gating tag only: each leaf that was
// originally inside a required-parens region carries a `parenGroup` id.
// This id is used for exactly two things, neither of which blocks a click:
//   1. Rendering — while 2+ members of a group are still adjacent and
//      unmerged, they're drawn wrapped in "(" ")" so the expression still
//      looks like the original source.
//   2. Scoring — a step that merges two operands from DIFFERENT groups (or
//      one grouped + one free) reaches across a boundary that programming-
//      language semantics require to be resolved first, so it's never
//      counted as "correct order," even though it's fully clickable and
//      fully computed. A step that merges two members of the SAME
//      still-open group, or two ungrouped operands, is judged by ordinary
//      precedence among its own partition.
// Once a group collapses down to a single surviving value (whether by
// resolving it properly or by being whittled down via crossing merges),
// that value becomes ordinary/ungrouped (parenGroup = null) and rejoins
// normal precedence scoring like any other operand.
//
// A FlatExpr is {operands:[...], operators:[...]} with operands.length ===
// operators.length + 1. Every operand is a literal/variable/constant leaf
// (same node objects/ids as the original tree, for id continuity), each
// carrying a `parenGroup` (id or null).
// ============================================================================
function tagParenGroups(node, ctxMinPrec, groupId){
  ctxMinPrec = ctxMinPrec || 0;
  groupId = groupId==null ? null : groupId;
  if(node.kind !== 'binop'){
    node.parenGroup = groupId;
    return;
  }
  const p = prec(node.op);
  if(p < ctxMinPrec){
    // This subtree would be printed with explicit parentheses (renderString
    // would wrap it) — a real required-parens region. Tag every leaf beneath
    // it with a shared group id (reusing an enclosing group id if this is
    // itself nested inside one, so nested parens still collapse to one tag).
    const gid = groupId==null ? nextId() : groupId;
    tagParenGroups(node.left, 0, gid);
    tagParenGroups(node.right, 0, gid);
    return;
  }
  tagParenGroups(node.left, p, groupId);
  tagParenGroups(node.right, p+1, groupId);
}
function flattenFull(node){
  if(node.kind !== 'binop') return {operands:[node], operators:[]};
  const l = flattenFull(node.left);
  const r = flattenFull(node.right);
  return {operands: l.operands.concat(r.operands), operators: l.operators.concat([node.op], r.operators)};
}
// Tags parenGroup on every leaf, then produces the fully flat interaction
// structure. Call this once per generated instance instead of flattenTree.
function flattenInstance(tree){
  tagParenGroups(tree, 0, null);
  return flattenFull(tree);
}
function deepCloneFlat(flat){
  return {
    operands: flat.operands.map(op=> op.kind==='unary' ? Object.assign({}, op, {inner:Object.assign({}, op.inner)}) : Object.assign({}, op)),
    operators: flat.operators.slice()
  };
}
function isFlatOperandReady(op){
  if(op.kind==='literal') return true;
  if(op.kind==='variable'||op.kind==='constant') return op.resolved;
  if(op.kind==='unary') return op.resolved;
  return false;
}
function flatOperandValue(op){
  if(op.kind==='literal') return op.value;
  if(op.kind==='unary') return op.resultValue;
  return op.declaredValue;
}
// A pair is only actually clickable if both neighbors are resolved values,
// AND (for / and %) the right-hand value isn't zero — a genuine arithmetic
// error, not an evaluation-order choice, so it's never offered as a target.
// Deliberately NOT gated by parenGroup — crossing a paren boundary is a
// scoring concern (see getMaxPrecCandidatesFlat), never a click-blocking one.
function pairReady(L,R,op){
  if(!isFlatOperandReady(L) || !isFlatOperandReady(R)) return false;
  if((op==='/'||op==='%') && flatOperandValue(R)===0) return false;
  return true;
}
function collectUnresolvedFlat(flat, out){
  out = out || [];
  for(const op of flat.operands){
    if((op.kind==='variable'||op.kind==='constant'||op.kind==='unary') && !op.resolved) out.push(op);
  }
  return out;
}
function findFlatOperandById(flat, id){
  return flat.operands.find(op=>op.id===id) || null;
}
function resolveFlatById(flat, targetId){
  return {
    operands: flat.operands.map(op=>{
      if(op.id!==targetId) return op;
      if(op.kind==='variable'||op.kind==='constant') return Object.assign({}, op, {resolved:true});
      if(op.kind==='unary') return Object.assign({}, op, {resolved:true, resultValue: unaryComputedValue(op)});
      return op;
    }),
    operators: flat.operators
  };
}
// First half of a unary token's two-step resolution: reveals the wrapped
// variable's value (e.g. "++x" -> "++7") but leaves the operator unapplied
// (resolved stays false), so the operand is still not usable by EVALUATE
// until a subsequent 'apply-unary' click.
function substituteFlatById(flat, targetId){
  return {
    operands: flat.operands.map(op=>{
      if(op.id!==targetId || op.kind!=='unary') return op;
      return Object.assign({}, op, {substituted:true});
    }),
    operators: flat.operators
  };
}
// Every ready (clickable) operator position, left to right. Each entry also
// carries the parenGroup of each side, purely so the scoring function below
// can tell a same-group / free / crossing merge apart — this never affects
// whether the pair appears here (i.e. never affects clickability).
function collectReadyOperatorsFlat(flat, out){
  out = out || [];
  for(let i=0;i<flat.operators.length;i++){
    const L = flat.operands[i], R = flat.operands[i+1], opStr = flat.operators[i];
    if(pairReady(L,R,opStr)) out.push({op:opStr, leftId:L.id, rightId:R.id, leftGroup:L.parenGroup==null?null:L.parenGroup, rightGroup:R.parenGroup==null?null:R.parenGroup});
  }
  return out;
}
// Used for the (approximate, non-gating) correctness badge: among all
// currently ready positions, the highest-precedence one(s) are "correct" —
// but a step is only ever eligible to be "correct" if it does NOT reach
// across a parenthesis boundary. A required-parens region is scored as its
// own independent partition (its own local max-precedence), completely
// separate from the free/outer partition, and a pair spanning two different
// partitions is excluded from "correct" entirely — it's still fully
// clickable via collectReadyOperatorsFlat, just never marked as the right
// move, since real precedence/parens rules never allow it either.
function getMaxPrecCandidatesFlat(flat){
  const ready = collectReadyOperatorsFlat(flat, []);
  const nonCrossing = ready.filter(r => r.leftGroup === r.rightGroup);
  if(nonCrossing.length===0) return [];
  const byPartition = new Map();
  for(const r of nonCrossing){
    const key = r.leftGroup==null ? '__free__' : r.leftGroup;
    if(!byPartition.has(key)) byPartition.set(key, []);
    byPartition.get(key).push(r);
  }
  let result = [];
  for(const arr of byPartition.values()){
    const maxP = Math.max.apply(null, arr.map(r=>prec(r.op)));
    result = result.concat(arr.filter(r=>prec(r.op)===maxP));
  }
  return result;
}
function countGroupMembers(flat, groupId){
  if(groupId==null) return 0;
  let n = 0;
  for(const op of flat.operands) if(op.parenGroup===groupId) n++;
  return n;
}
// Locates the specific adjacent (leftId,rightId) pair and, if found, returns
// a NEW flat structure with that pair collapsed into a single new literal.
// The new literal's parenGroup: if both merged operands belonged to the SAME
// still-open group, it stays in that group unless this merge was the group's
// last remaining pair (then the group is fully resolved and it becomes
// free); any other combination (different groups, or one/both free) is a
// crossing merge and the result is always free.
function evaluateFlatAt(flat, leftId, rightId, resultOverride){
  for(let i=0;i<flat.operators.length;i++){
    const L = flat.operands[i], R = flat.operands[i+1];
    if(L.id===leftId && R.id===rightId){
      const op = flat.operators[i];
      const a = flatOperandValue(L), b = flatOperandValue(R);
      let result;
      try{ result = evalOp(op,a,b); } catch(e){ return {applied:false}; }
      const computedResult=result;
      if(arguments.length>=4) result=resultOverride;
      const newLiteral = makeLiteral(result);
      if(L.parenGroup!=null && L.parenGroup===R.parenGroup){
        const remainingBefore = countGroupMembers(flat, L.parenGroup);
        newLiteral.parenGroup = (remainingBefore - 1) <= 1 ? null : L.parenGroup;
      } else {
        newLiteral.parenGroup = null;
      }
      const newOperands = flat.operands.slice(0,i).concat([newLiteral], flat.operands.slice(i+2));
      const newOperators = flat.operators.slice(0,i).concat(flat.operators.slice(i+1));
      return {newFlat:{operands:newOperands, operators:newOperators}, applied:true, op, a, b, result, computedResult, resultId:newLiteral.id};
    }
  }
  return {applied:false};
}
function flatLeafToString(op){
  if(op.kind==='literal') return formatValue(op.value);
  if(op.kind==='unary'){
    if(op.resolved) return formatValue(op.resultValue);
    const nm = op.substituted ? String(unaryBaseValue(op)) : (op.inner.kind==='literal' ? String(op.inner.value) : op.inner.name);
    if(op.op==='!') return '!'+nm;
    return op.form==='prefix' ? op.op+nm : nm+op.op;
  }
  return op.resolved ? formatValue(op.declaredValue) : op.name;
}
// Maximal contiguous runs (length >= 2) of operands sharing the same
// non-null parenGroup — these are the spans still shown wrapped in "( )".
// A group that's been whittled down to one surviving operand (properly
// resolved, or via a crossing merge) is no longer tagged, so it naturally
// stops being bracketed, exactly like an ordinary value.
function computeParenRuns(flat){
  const runs = [];
  let i = 0;
  while(i < flat.operands.length){
    const g = flat.operands[i].parenGroup;
    if(g==null){ i++; continue; }
    let j = i;
    while(j < flat.operands.length && flat.operands[j].parenGroup===g) j++;
    if(j - i >= 2) runs.push({start:i, end:j-1});
    i = j;
  }
  return runs;
}
function flatToString(flat){
  const runs = computeParenRuns(flat);
  const openAt = new Set(runs.map(r=>r.start)), closeAt = new Set(runs.map(r=>r.end));
  let s = '';
  for(let i=0;i<flat.operands.length;i++){
    if(openAt.has(i)) s += '(';
    s += flatLeafToString(flat.operands[i]);
    if(closeAt.has(i)) s += ')';
    if(i<flat.operators.length) s += ' '+flat.operators[i]+' ';
  }
  return s;
}

