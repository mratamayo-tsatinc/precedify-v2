// ---------------------------------------------------------------------------
// Flat-model DOM renderers (the interactive session's live expression and its
// past-step rows). colorMap/activeColor/flashId work as in the tree-based
// renderers above. unresolvedAny globally disables every operator until all
// variable/constant tokens anywhere in the expression are resolved (§8 of the
// brief); once true, EVERY currently-ready adjacent operator — including one
// that reaches across where a parenthesis was in the source — previews the
// same activeColor and is clickable, since the student picks freely.
//
// Every operand/operator DOM node below also carries a data-token-id (for
// leaf operands) or data-op-left/data-op-right (for operators) attribute.
// These are inert for rendering/interaction purposes — they exist solely so
// connector-lines.js can find the exact source/destination element for each
// step and draw a line between them. Nothing here reads or depends on those
// attributes.
// ---------------------------------------------------------------------------
function renderInteractiveFlatOperand(op, colorMap, activeColor, flashId){
  if(op.kind==='literal'){
    const col = colorMap.get(op.id);
    const isFlash = flashId!=null && op.id===flashId;
    const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': op.id};
    if(col) attrs.style = `color:${col};`;
    return h('span',attrs, formatValue(op.value));
  }
  if(op.kind==='unary'){
    if(op.resolved){
      const col = colorMap.get(op.id);
      const isFlash = flashId!=null && op.id===flashId;
      const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': op.id};
      if(col) attrs.style = `color:${col};`;
      return h('span',attrs, formatValue(op.resultValue));
    }
    if(op.substituted){
      // Stage 2: the variable's value has been revealed, but rather than
      // collapsing it into flat text like "++13", it keeps using the same
      // "memory card" visual as an ordinary substituted variable/constant
      // (name above, value below) — per the brief's "same visual language
      // for substitution" principle, this is still a named value pulled
      // from memory, not a plain literal, until the operator actually fires.
      // The still-pending operator symbol shares the CARD'S color (its own
      // operand), not a preview of some future step's color — visually the
      // operator belongs to the card it's attached to, not to whatever gets
      // produced once it eventually fires.
      const cardColor = colorMap.get(op.id);
      const isFlash = flashId!=null && op.id===flashId;
      const card = renderValueCard({id:op.id, name:op.inner.name, value:unaryBaseValue(op), kind:op.inner.kind, color:cardColor, isFlash});
      const opAttrs = {class:'tok tok-op-active'+(cardColor?' tok-colored':'')};
      if(cardColor) opAttrs.style = `color:${cardColor};`;
      const opSpan = h('span',opAttrs, op.op);
      const parts = (op.op==='!' || op.form==='prefix') ? [opSpan, card] : [card, opSpan];
      return h('span',{class:'unary-token-group tok-unary-pending', tabindex:'0', role:'button', 'aria-label':`apply ${op.op} to ${op.inner.name}`,
        onclick:()=>handleTokenClick({type:'apply-unary', id:op.id}),
        onkeydown:(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleTokenClick({type:'apply-unary', id:op.id}); } }
      }, ...parts);
    }
    // Stage 1: still just the variable name (with its unary decoration) —
    // clicking substitutes its value, same as a plain variable token.
    const nm = op.inner.kind==='literal' ? String(op.inner.value) : op.inner.name;
    const label = op.op==='!' ? ('!'+nm) : (op.form==='prefix' ? op.op+nm : nm+op.op);
    const namedKind = op.inner.kind==='constant' ? 'constant' : (op.inner.kind==='variable' ? 'variable' : null);
    const strictSequence=typeof strictSequenceEnabled==='function'&&strictSequenceEnabled();
    if(strictSequence){
      const valueAttrs={class:'tok tok-var tok-colored'+(namedKind?' binding-identity':''),
        style:namedKind?bindingIdentityStyle(nm,namedKind,activeColor):`color:${activeColor};`,
        tabindex:'0',role:'button','aria-label':`substitute ${nm}`,'data-token-id':op.id,
        'data-binding-name':namedKind?nm:null,
        onclick:()=>handleTokenClick({type:'substitute',id:op.id}),
        onkeydown:(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handleTokenClick({type:'substitute',id:op.id});}}};
      const operatorAttrs={class:'tok tok-op-active tok-colored strict-sequence-candidate',
        style:`color:${activeColor};`,tabindex:'0',role:'button',
        'aria-label':`attempt to apply ${op.op}`,
        onclick:()=>handleTokenClick({type:'apply-unary',id:op.id}),
        onkeydown:(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handleTokenClick({type:'apply-unary',id:op.id});}}};
      const valueNode=h('span',valueAttrs,nm);
      const operatorNode=h('span',operatorAttrs,op.op);
      const strictParts=(op.op==='!'||op.form==='prefix')?[operatorNode,valueNode]:[valueNode,operatorNode];
      return h('span',{class:'unary-token-group'},...strictParts);
    }
    return h('span',{class:'tok tok-var tok-colored'+(namedKind?' binding-identity':''),
      style:namedKind ? bindingIdentityStyle(nm,namedKind,activeColor) : `color:${activeColor};`,
      tabindex:'0', role:'button', 'aria-label':`substitute ${nm}`, 'data-token-id':op.id,
      'data-binding-name':namedKind ? nm : null,
      onclick:()=>handleTokenClick({type:'substitute', id:op.id}),
      onkeydown:(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleTokenClick({type:'substitute', id:op.id}); } }
    }, label);
  }
  // variable or constant
  if(op.resolved){
    const col = colorMap.get(op.id);
    const isFlash = flashId!=null && op.id===flashId;
    return renderValueCard({id:op.id, name:op.name, value:op.declaredValue, kind:op.kind, color:col, isFlash});
  }
  const cls = (op.kind==='variable' ? 'tok tok-var' : 'tok tok-const') + ' tok-colored binding-identity';
  return h('span',{class:cls, style:bindingIdentityStyle(op.name,op.kind,activeColor),
    tabindex:'0', role:'button', 'aria-label':`substitute ${op.name}`, 'data-token-id':op.id,
    'data-binding-name':op.name,
    onclick:()=>handleTokenClick({type:'substitute', id:op.id}),
    onkeydown:(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleTokenClick({type:'substitute', id:op.id}); } }
  }, op.name);
}
// Every ready adjacent pair is clickable here — including one whose left or
// right side still belongs to an unresolved parenGroup, i.e. an operator
// that reaches across where a parenthesis was. Parens are drawn (via
// computeParenRuns) purely as a visual echo of the source; they never gate
// which operator lights up as `ready`.
function renderInteractiveFlatExpr(flat, colorMap, activeColor, flashId, unresolvedAny){
  const runs = computeParenRuns(flat);
  const openAt = new Set(runs.map(r=>r.start)), closeAt = new Set(runs.map(r=>r.end));
  const parts = [];
  for(let i=0;i<flat.operands.length;i++){
    if(openAt.has(i)) parts.push(h('span',{class:'tok tok-op-muted'}, '('));
    parts.push(renderInteractiveFlatOperand(flat.operands[i], colorMap, activeColor, flashId));
    if(closeAt.has(i)) parts.push(h('span',{class:'tok tok-op-muted'}, ')'));
    if(i<flat.operators.length){
      const L = flat.operands[i], R = flat.operands[i+1], opStr = flat.operators[i];
      const strictSequence=typeof strictSequenceEnabled==='function'&&strictSequenceEnabled();
      const ready = !unresolvedAny && pairReady(L,R,opStr);
      const selectable=ready||strictSequence;
      const opCls = 'tok '+(selectable ? 'tok-op-active tok-colored'+(strictSequence?' strict-sequence-candidate':'') : 'tok-op-muted');
      const opAttrs = {class:opCls, tabindex: selectable ? '0' : '-1', role:'button', 'aria-label':`evaluate ${opStr}`,
        'data-op-left': L.id, 'data-op-right': R.id,
        onclick: selectable ? ()=>handleTokenClick({type:'evaluate', leftId:L.id, rightId:R.id}) : null,
        onkeydown: selectable ? (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleTokenClick({type:'evaluate', leftId:L.id, rightId:R.id}); } } : null
      };
      if(selectable) opAttrs.style = `color:${activeColor};`;
      parts.push(' ', h('span',opAttrs, opStr), ' ');
    }
  }
  return h('span',{}, ...parts);
}
// pending = {type:'substitute', id, color} | {type:'evaluate', leftId, rightId, color} | null.
// READ_TARGET belongs to the assignment prefix rather than the RHS flat tree,
// so its pending highlight is rendered by renderCompoundAssignmentPrefix.
function pendingFlatWithColor(step, color){
  if(!step) return null;
  if(step.action==='SUBSTITUTE' || step.action==='UNARY') return {type:'substitute', id:step.resultNodeId, color};
  if(step.action==='READ_TARGET') return null;
  return {type:'evaluate', leftId:step.leftId, rightId:step.rightId, color};
}
function renderStaticFlatOperand(op, colorMap, flashId, pending){
  if(op.kind==='literal'){
    const col = colorMap.get(op.id);
    const isFlash = flashId!=null && op.id===flashId;
    const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': op.id};
    if(col) attrs.style = `color:${col};`;
    return h('span',attrs, formatValue(op.value));
  }
  if(op.kind==='unary'){
    if(op.resolved){
      const col = colorMap.get(op.id);
      const isFlash = flashId!=null && op.id===flashId;
      const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': op.id};
      if(col) attrs.style = `color:${col};`;
      return h('span',attrs, formatValue(op.resultValue));
    }
    if(op.substituted){
      const cardColor = colorMap.get(op.id);
      const isFlash = flashId!=null && op.id===flashId;
      const card = renderValueCard({id:op.id, name:op.inner.name, value:unaryBaseValue(op), kind:op.inner.kind, color:cardColor, isFlash});
      const opAttrs = {class:'tok tok-op-muted'+(cardColor?' tok-colored':'')};
      if(cardColor) opAttrs.style = `color:${cardColor};`;
      const opSpan = h('span',opAttrs, op.op);
      const parts = (op.op==='!' || op.form==='prefix') ? [opSpan, card] : [card, opSpan];
      return h('span',{class:'unary-token-group'}, ...parts);
    }
    const nm = op.inner.kind==='literal' ? String(op.inner.value) : op.inner.name;
    const label = op.op==='!' ? ('!'+nm) : (op.form==='prefix' ? op.op+nm : nm+op.op);
    const isPending = pending && pending.type==='substitute' && pending.id===op.id;
    const namedKind = op.inner.kind==='constant' ? 'constant' : (op.inner.kind==='variable' ? 'variable' : null);
    const attrs = {class:'tok tok-var tok-static'+(isPending?' tok-colored':'')+(namedKind?' binding-identity':''),
      'data-token-id':op.id,'data-binding-name':namedKind ? nm : null};
    if(namedKind) attrs.style=bindingIdentityStyle(nm,namedKind,isPending?pending.color:null);
    else if(isPending) attrs.style = `color:${pending.color};`;
    return h('span',attrs, label);
  }
  if(op.resolved){
    const col = colorMap.get(op.id);
    const isFlash = flashId!=null && op.id===flashId;
    return renderValueCard({id:op.id, name:op.name, value:op.declaredValue, kind:op.kind, color:col, isFlash});
  }
  const base = (op.kind==='variable' ? 'tok tok-var tok-static' : 'tok tok-const tok-static')+' binding-identity';
  const isPending = pending && pending.type==='substitute' && pending.id===op.id;
  const attrs = {class:base+(isPending?' tok-colored':''), 'data-token-id':op.id,
    'data-binding-name':op.name,
    style:bindingIdentityStyle(op.name,op.kind,isPending?pending.color:null)};
  return h('span',attrs, op.name);
}
function renderStaticFlatExpr(flat, colorMap, flashId, pending){
  const runs = computeParenRuns(flat);
  const openAt = new Set(runs.map(r=>r.start)), closeAt = new Set(runs.map(r=>r.end));
  const parts = [];
  for(let i=0;i<flat.operands.length;i++){
    if(openAt.has(i)) parts.push(h('span',{class:'tok tok-op-muted'}, '('));
    parts.push(renderStaticFlatOperand(flat.operands[i], colorMap, flashId, pending));
    if(closeAt.has(i)) parts.push(h('span',{class:'tok tok-op-muted'}, ')'));
    if(i<flat.operators.length){
      const L = flat.operands[i], R = flat.operands[i+1];
      const isPending = pending && pending.type==='evaluate' && pending.leftId===L.id && pending.rightId===R.id;
      const opAttrs = {class:'tok tok-op-muted'+(isPending?' tok-colored':''), 'data-op-left': L.id, 'data-op-right': R.id};
      if(isPending) opAttrs.style = `color:${pending.color};`;
      parts.push(' ', h('span',opAttrs, flat.operators[i]), ' ');
    }
  }
  return h('span',{}, ...parts);
}
