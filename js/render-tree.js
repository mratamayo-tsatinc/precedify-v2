// Non-interactive tree-based renderer, used ONLY by the answer-key/canonical
// playback below (which is intentionally still precedence-tree-shaped, since
// it plays back the one true correct order). Live student interaction uses
// the flat-model renderers (renderInteractiveFlatExpr etc.) defined further
// down, since the tree structurally under-constrains what should be
// clickable — see the big comment above the INTERACTIVE (FLAT) EVALUATION
// MODEL section.
// playback. colorMap/flashId work as in the interactive renderer. pendingId/
// pendingColor preview a step's color on the ONE specific operator or var/
// const token known (from the recorded trace) to fire next in this exact
// snapshot — unlike the live row, historical/canonical rows already know
// which single token that is, so only it (not every candidate) gets colored.
function renderStaticExpr(node, ctxPrec, colorMap, flashId, pendingId, pendingColor){
  ctxPrec = ctxPrec || 0;
  if(node.kind==='literal'){
    const col = colorMap.get(node.id);
    const isFlash = flashId!=null && node.id===flashId;
    const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': node.id};
    if(col) attrs.style = `color:${col};`;
    return h('span',attrs, formatValue(node.value));
  }
  if((node.kind==='variable'||node.kind==='constant') && node.resolved){
    const col = colorMap.get(node.id);
    const isFlash = flashId!=null && node.id===flashId;
    return renderValueCard({id:node.id, name:node.name, value:node.declaredValue, kind:node.kind, color:col, isFlash});
  }
  if(node.kind==='variable' || node.kind==='constant'){
    const base = node.kind==='variable' ? 'tok tok-var tok-static' : 'tok tok-const tok-static';
    const isPending = pendingId!=null && node.id===pendingId;
    const attrs = {class:base+(isPending?' tok-colored':'')+' binding-identity',
      'data-token-id':node.id,'data-binding-name':node.name,
      style:bindingIdentityStyle(node.name,node.kind,isPending?pendingColor:null)};
    return h('span',attrs, node.name);
  }
  if(node.kind==='unary'){
    if(node.resolved){
      const col = colorMap.get(node.id);
      const isFlash = flashId!=null && node.id===flashId;
      const mutationCard=renderResolvedUnaryMutationCard(node,col,isFlash);
      if(mutationCard) return mutationCard;
      const attrs = {class:'tok tok-lit'+(col?(isFlash?' tok-colored-flash':' tok-colored'):''), 'data-token-id': node.id};
      if(col) attrs.style = `color:${col};`;
      return h('span',attrs, formatValue(node.resultValue));
    }
    if(node.substituted){
      const cardColor = colorMap.get(node.id);
      const isFlash = flashId!=null && node.id===flashId;
      const card = renderValueCard({id:node.id, name:node.inner.name, value:unaryBaseValue(node), kind:node.inner.kind, color:cardColor, isFlash});
      const opAttrs = {class:'tok tok-op-muted'+(cardColor?' tok-colored':'')};
      if(cardColor) opAttrs.style = `color:${cardColor};`;
      const opSpan = h('span',opAttrs, node.op);
      const parts = (node.op==='!' || node.form==='prefix') ? [opSpan, card] : [card, opSpan];
      return h('span',{class:'unary-token-group'}, ...parts);
    }
    const nm = node.inner.kind==='literal' ? String(node.inner.value) : node.inner.name;
    const label = node.op==='!' ? ('!'+nm) : (node.form==='prefix' ? node.op+nm : nm+node.op);
    const isPending = pendingId!=null && node.id===pendingId;
    const namedKind = node.inner.kind==='constant' ? 'constant' : (node.inner.kind==='variable' ? 'variable' : null);
    const attrs = {class:'tok tok-var tok-static'+(isPending?' tok-colored':'')+(namedKind?' binding-identity':''),
      'data-token-id':node.id,'data-binding-name':namedKind ? nm : null};
    if(namedKind) attrs.style=bindingIdentityStyle(nm,namedKind,isPending?pendingColor:null);
    else if(isPending && pendingColor) attrs.style = `color:${pendingColor};`;
    return h('span',attrs, label);
  }
  const p = prec(node.op);
  const left = renderStaticExpr(node.left, p, colorMap, flashId, pendingId, pendingColor);
  const right = renderStaticExpr(node.right, p+1, colorMap, flashId, pendingId, pendingColor);
  const isPending = pendingId!=null && node.id===pendingId;
  const opAttrs = {class:'tok tok-op-muted'+(isPending?' tok-colored':''), 'data-op-left': node.left.id, 'data-op-right': node.right.id};
  if(isPending && pendingColor) opAttrs.style = `color:${pendingColor};`;
  const opSpan = h('span',opAttrs, node.op);
  const wrap = h('span',{}, left, ' ', opSpan, ' ', right);
  return p < ctxPrec ? h('span',{}, '(', wrap, ')') : wrap;
}
