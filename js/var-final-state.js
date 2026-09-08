// ============================================================================
// VARIABLE FINAL STATE
// ----------------------------------------------------------------------------
// Purely additive, read-only display section appended at the end of the
// Evaluation panel — kept isolated from the trace/scoring/engine modules,
// like connector-lines.js. Depends only on:
//   - item.originalFlat, item.trace, item.workingFlat  (never mutated in a
//     way that breaks this — trace/workingFlat change as the student plays,
//     originalFlat never does)
//   - itemFullyResolved()  (state.js)
//   - formatValue(), renderValueCard(), stepColor(), h()
//
// ----------------------------------------------------------------------------
// BINDING MODEL
// ----------------------------------------------------------------------------
// Every named storage slot the statement touches — every declared variable
// AND the statement's own assignment target (item.resultName, a randomly
// (seeded) chosen name per item — see generator.js's RESULT_NAMES/
// pickResultName) — is represented as one BINDING, built once per item and
// cached on item._bindings. Treating the assignment target as just another
// binding (rather than a hardcoded special case) is what keeps this
// agnostic to future changes: a later version that evaluates several
// statements in sequence would only need to append one more target-kind
// binding per statement, using the exact same three trigger types below —
// nothing about resolution/render/flash logic needs to know how many
// statements exist.
//
// binding = {
//   name,            // 'x', 'y', or this item's own resultName (e.g. 'total')
//   kind,             // 'declared' (a variable from the source) | 'target' (an assignment LHS)
//   trigger,          // when this binding's stored value actually changes:
//                      //   'static'             — never changes (plain var, or `!`-negated var)
//                      //   'per-step'            — changes the instant ONE specific trace step
//                      //                           fires (prefix ++/--)
//                      //   'statement-complete'  — changes only once the whole statement has
//                      //                           been fully derived (postfix ++/--, and every
//                      //                           assignment target)
//   declaredValue,    // the value at the top of the source, or undefined for a target (no
//                      // initializer exists in the source for the assignment target)
//   finalValue,       // the value this binding settles to once its trigger fires
//   unaryNodeId,      // for 'per-step' bindings: the unary node's id, matched against
//                      // trace step.resultNodeId to find exactly when it fired
//   op, form,         // '++' | '--' , 'prefix' | 'postfix' — for the tag text only
//   _flashed          // one-time "already pulsed" flag, mutated in place (see render below)
// }
//
// WHY prefix vs. postfix get different triggers: this app's unary model
// deliberately shows a POSTFIX operator (x--) using x's ORIGINAL value
// inside the expression — matching real Java/C semantics, where the
// expression's value is the value BEFORE the decrement, and the decrement
// itself is a side effect that only matters for whoever reads x afterward.
// So a postfix variable's on-paper state must stay at its declared value
// for the entire derivation and only flip once the statement is done —
// exactly the same moment the assignment target itself first gets a value.
// A prefix operator, by contrast, already needs the updated value DURING
// the expression, so its state flips live, the instant that specific step
// fires.
//
// SCOPE: only leaves whose underlying declaration is `variable` produce a
// binding (never `constant` — constants are immutable, nothing to report).
// `!` is excluded from the mutating (`per-step`/`statement-complete`)
// treatment even though it wraps a variable, since logical NOT never
// touches the variable's own stored value.
// ============================================================================

function buildBindingsForItem(item){
  if(itemHasInteractiveProgram(item)){
    const bindings = item.program.statements
      .filter(statement=>statement.kind==='declaration')
      .map(statement=>({
        name:statement.binding.name,
        kind:statement.binding.kind==='constant' ? 'program-constant' : 'program-variable',
        trigger:'program-assignment',
        statementId:statement.id,
        declaredValue:undefined,
        finalValue:statement.runtime.expectedValue,
        unaryNodeId:null, op:null, form:null, _flashed:false
      }));
    // A declaration chain still ends in the same assignment expression as a
    // legacy item. Keep its target in the same memory model for consistent
    // pending, commit, pulse and fly-in behavior across every profile.
    bindings.push({
      name:item.resultName || 'result', kind:'target', trigger:'statement-complete',
      declaredValue:undefined, finalValue:undefined,
      unaryNodeId:null, op:null, form:null, _flashed:false
    });
    return bindings;
  }
  const bindings = [];
  for(const op of item.originalFlat.operands){
    if(op.kind==='variable'){
      bindings.push({
        name: op.name, kind:'declared', trigger:'static',
        declaredValue: op.declaredValue, finalValue: op.declaredValue,
        unaryNodeId:null, op:null, form:null, _flashed:false
      });
    } else if(op.kind==='unary' && op.inner.kind==='variable'){
      const base = op.inner.declaredValue;
      if(op.op==='!'){
        bindings.push({
          name: op.inner.name, kind:'declared', trigger:'static',
          declaredValue: base, finalValue: base,
          unaryNodeId:null, op:null, form:null, _flashed:false
        });
      } else {
        const delta = op.op==='++' ? 1 : -1;
        bindings.push({
          name: op.inner.name, kind:'declared',
          trigger: op.form==='prefix' ? 'per-step' : 'statement-complete',
          declaredValue: base, finalValue: base+delta,
          unaryNodeId: op.id, op: op.op, form: op.form, _flashed:false
        });
      }
    }
    // literal / constant: no binding — nothing named/mutable to report.
  }
  // The statement's own assignment target. No initializer exists for it in
  // the source, so unlike every declared binding above it has no
  // declaredValue at all — that's the ONE case that renders "—" prior to
  // commit (see resolveBindingLive/renderBindingCard below).
  // name comes from this item's own randomly (seeded) chosen assignment
  // target (see generator.js's RESULT_NAMES/pickResultName, threaded onto
  // item.resultName in state.js) rather than a hardcoded literal — falls
  // back to 'result' only if somehow absent, so this section never renders
  // a blank/undefined binding name.
  bindings.push({
    name: item.resultName || 'result', kind:'target', trigger:'statement-complete',
    declaredValue: undefined, finalValue: undefined,
    unaryNodeId:null, op:null, form:null, _flashed:false
  });
  return bindings;
}

// Lazily builds + caches the binding list on the item itself. Callers that
// need a fresh set of bindings (a genuine restart of the item, where flash
// pulses should be allowed to replay) must clear item._bindings first —
// see handleReset/handleRetrySameItem in state.js.
function ensureBindings(item){
  if(!item._bindings) item._bindings = buildBindingsForItem(item);
  return item._bindings;
}

// Mirrors buildColorMap()'s (dom-helpers.js) and originColorForStep()'s
// (connector-lines.js) "first-touch wins" rule: a unary token's SUBSTITUTE
// step and its later UNARY step share the same resultNodeId, and a value
// always keeps the color of whichever step ORIGINATED it — the reveal, not
// the operator that's applied to it afterward. Every color shown for a
// binding in this section must match that same rule, or a card here would
// visibly disagree with the identically-colored value already shown in the
// Evaluation timeline above it.
function originColorForNode(trace, nodeId){
  for(let i=0;i<trace.length;i++){
    if(trace[i].resultNodeId===nodeId) return stepColor(i);
  }
  return null;
}

// Resolves ONE binding's current on-screen state purely from live
// progress (item.trace so far, and whether the item is fully resolved) —
// recomputed fresh every render, never cached, so it always reflects
// exactly how far the student has actually gotten.
//
// Returns {hasValue, displayValue, committed, flashColor}
//   hasValue     — false only for an un-committed target (nothing to show but "—")
//   displayValue — the value to render (ignored when hasValue is false)
//   committed    — true once this binding's trigger has actually fired
//   flashColor   — the origin color of the value currently shown (see
//                  originColorForNode above), or null if nothing has fired
//                  yet. Applied to the card permanently once committed (not
//                  just during the pulse), matching how every other
//                  per-step color in this app works.
function resolveBindingLive(binding, item){
  if(binding.trigger==='program-assignment'){
    const memory = item.program && item.program.memory && item.program.memory[binding.name];
    if(!memory || !memory.initialized){
      return {hasValue:false, displayValue:null, committed:false, flashColor:null};
    }
    const statement = item.program.statements.find(s=>s.id===binding.statementId);
    const originStatementId=memory.lastStatementId||binding.statementId;
    const originStatement = item.program.statements.find(s=>s.id===originStatementId) || statement;
    const trace = originStatement && originStatement.runtime ? originStatement.runtime.trace : [];
    const lastIdx = trace.length-1;
    return {hasValue:true, displayValue:memory.value, committed:true,originStatementId,
      flashColor:lastIdx>=0 ? stepColor(lastIdx) : stepColor(0)};
  }
  if(binding.trigger==='static'){
    return {hasValue:true, displayValue: binding.declaredValue, committed:true, flashColor:null};
  }
  if(binding.trigger==='per-step'){
    const firedIdx = item.trace.findIndex(t=>t.action==='UNARY' && t.resultNodeId===binding.unaryNodeId);
    if(firedIdx===-1){
      // Not fired yet — an operand variable always shows its declared value
      // up to that point, never "—" (its value IS already known from the
      // source; only a to-be-assigned target starts blank).
      return {hasValue:true, displayValue: binding.declaredValue, committed:false, flashColor:null};
    }
    return {hasValue:true, displayValue: binding.finalValue, committed:true, flashColor: originColorForNode(item.trace, binding.unaryNodeId)};
  }
  // 'statement-complete' — postfix-mutated variable, or the assignment target.
  if(!itemFullyResolved(item)){
    if(binding.kind==='target') return {hasValue:false, displayValue:null, committed:false, flashColor:null};
    return {hasValue:true, displayValue: binding.declaredValue, committed:false, flashColor:null};
  }
  let color;
  if(binding.kind==='target'){
    // The assignment target's value comes from the single, final EVALUATE
    // step that collapses the whole expression to one value — that step's
    // resultNodeId is a freshly-minted literal id never touched by any
    // earlier step, so its own index IS already the origin (first-touch of
    // one is itself).
    const lastIdx = item.trace.length-1;
    color = lastIdx>=0 ? stepColor(lastIdx) : null;
  } else {
    // Postfix-mutated variable: its mutating UNARY step shares a
    // resultNodeId with the earlier SUBSTITUTE step that revealed it, so
    // this must go through the same origin lookup as the 'per-step' branch
    // above, not the UNARY step's own raw index.
    color = originColorForNode(item.trace, binding.unaryNodeId);
  }
  const displayValue = binding.kind==='target'
    ? flatOperandValue(item.workingFlat.operands[0]) // the student's own current derived value
    : binding.finalValue;
  return {hasValue:true, displayValue, committed:true, flashColor:color};
}

function bindingTagText(binding, live){
  if(binding.kind==='program-constant'){
    return live.committed ? 'constant assigned — immutable' : 'constant — not yet assigned';
  }
  if(binding.kind==='program-variable'){
    return live.committed ? 'variable assigned' : 'variable — not yet assigned';
  }
  if(binding.trigger==='static') return 'unchanged';
  if(binding.kind==='target') return live.committed ? 'assigned' : 'not yet assigned';
  if(binding.trigger==='per-step'){
    return live.committed ? `${binding.op}${binding.name} applied` : `${binding.op}${binding.name} — not yet applied`;
  }
  // statement-complete, postfix variable
  return live.committed
    ? `${binding.name}${binding.op} applied — used ${formatValue(binding.declaredValue)} in the expression`
    : `${binding.name}${binding.op} — updates once the statement completes`;
}
// Compact on-screen label — the full sentence above (bindingTagText) still
// exists in full, but only as a hover/focus tooltip (title/aria-label), the
// same "detail lives in the tooltip, only a short badge shows inline"
// convention already used for step correctness (see stepTooltip in
// render-session.js). Keeps this row from wrapping across two lines per
// card, which is what was eating horizontal/vertical space on mobile.
function bindingTagShort(binding, live){
  if(binding.kind==='program-constant') return live.committed ? 'constant · set' : 'constant · pending';
  if(binding.kind==='program-variable') return live.committed ? 'assigned' : 'pending';
  if(binding.trigger==='static') return 'unchanged';
  if(binding.kind==='target') return live.committed ? 'assigned' : 'pending';
  return live.committed ? 'applied' : 'pending';
}

// Builds the section DOM, or returns null when there's nothing to show at
// all (no declared variables AND, in principle, no target — in practice
// the assignment target always exists, so this only skips the whole
// section for pure-literal profiles with zero variables... actually the
// target binding still exists then too, so we always render; kept for
// symmetry/safety).
function renderVariableFinalState(item){
  const bindings = ensureBindings(item);
  if(bindings.length===0) return null;

  const wrap = h('div',{class:'var-final-panel'});
  wrap.appendChild(h('div',{class:'var-final-title'},
    itemHasInteractiveProgram(item) ? 'Program variables and constants' : 'Variable final state'));

  const list = h('div',{class:'var-final-list'});
  bindings.forEach(b=>{
    const live = resolveBindingLive(b, item);
    if(live.hasValue) b._lastDisplayValue=live.displayValue;
    // A binding's card pulses exactly once, the first render where it's
    // found committed. `_flashed` lives on the cached binding object (not
    // the DOM), so it survives the many unrelated re-renders this app does
    // (e.g. once/sec while answer-key playback auto-advances) without
    // replaying — same convention as trace steps' own `_flashed` flag.
    const isFlash = live.committed && !b._flashed;
    if(isFlash) b._flashed = true;

    const row = h('div',{class:'var-final-row'+(b.trigger!=='static' && live.committed ? ' var-final-changed':'')});
    row.appendChild(renderValueCard({
      id: 'vf-'+b.name,
      name: b.name,
      value: live.hasValue ? live.displayValue : '—',
      kind: b.kind==='program-constant' ? 'constant' : 'variable',
      color: live.flashColor,
      isFlash
    }));
    const fullTag = bindingTagText(b, live);
    row.appendChild(h('span',{class:'vf-tag'+(b.trigger==='static'?' vf-unchanged':''), tabindex:'0', title:fullTag, 'aria-label':fullTag},
      bindingTagShort(b, live),
      h('i',{class:'fa-solid fa-circle-info vf-hint-icon', 'aria-hidden':'true'})
    ));
    list.appendChild(row);
  });

  wrap.appendChild(list);
  return wrap;
}
