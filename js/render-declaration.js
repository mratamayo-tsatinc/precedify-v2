// ============================================================================
// DECLARATION STATEMENT ADAPTER
// ----------------------------------------------------------------------------
// Declaration semantics and program sequencing remain statement-specific.
// All expression-like presentation is delegated to the exact renderer used
// by legacy profiles (renderExpressionEvaluationPanel in render-session.js).
// ============================================================================

function declarationKeyword(statement){
  const type = statement.binding.dataType || 'int';
  return statement.binding.mutable ? type : `final ${type}`;
}

function renderDeclarationEquals(statement,ready){
  if(!ready) return '=';
  return h('button',{class:'declaration-equals tok tok-op-active tok-colored ready',
    title:`Assign the resolved value to ${statement.binding.name}`,
    'aria-label':`assign value to ${statement.binding.name}`,
    onclick:()=>handleTokenClick({type:'commit-assignment'})},'=');
}

function renderDeclarationStatement(ctx){
  const {container,item,program,statement,statementIndex,isActive} = ctx;
  const runtime = statement.runtime;
  const declarations = program.statements.filter(s=>s.kind==='declaration');
  const ordinal = declarations.indexOf(statement)+1;

  if(statementIndex===0){
    container.appendChild(h('div',{class:'session-bar'},h('div',{class:'session-meta'},
      h('b',{},`Item ${state.itemIndex+1}`),` / ${state.items.length}  ·  ${currentProfile().name}`)));
    container.appendChild(h('div',{class:'program-progress'},
      `Program statement ${Math.min(program.cursor+1,program.statements.length)} of ${program.statements.length}`));
  }

  const card = h('section',{class:`program-statement declaration-statement ${statement.status}`,
    'data-statement-id':statement.id});
  card.appendChild(h('div',{class:'program-statement-heading'},
    h('span',{},`Declaration ${ordinal} of ${declarations.length}`),
    h('span',{class:'program-statement-status'},
      statement.status==='complete'?'Assigned':(isActive?'Current':'Locked'))));

  if(statement.status==='locked'){
    card.appendChild(h('div',{class:'declaration-locked-line'},
      h('i',{class:'fa-solid fa-lock','aria-hidden':'true'}),' ',
      `${declarationKeyword(statement)} ${statement.binding.name} = ${renderString(runtime.originalTree)};`));
    container.appendChild(card);
    return;
  }

  const labelText = `${declarationKeyword(statement)} ${statement.binding.name}`;
  card.appendChild(renderExpressionSourcePanel('Original statement',[
    `${labelText} = ${renderString(runtime.originalTree)};`
  ],'program-source-panel'));
  card.appendChild(renderExpressionEvaluationPanel({
    runtime,
    labelText,
    labelCh:labelText.length+1,
    title:'Initializer evaluation',
    panelClass:'declaration-eval-panel program-expression-panel',
    statementId:statement.id,
    interactive:isActive && !runtime.checked,
    revealCorrectness:runtime.checked,
    isFullyResolved:()=>declarationInitializerResolved(statement),
    renderEquals:ready=>renderDeclarationEquals(statement,ready),
    renderTrailingActions:()=>isActive
      ? renderInlineEvaluationActions({canUndo:canUndoProgram(item)}) : null
  }));

  if(isActive){
    const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
    const ready = declarationInitializerResolved(statement);
    card.appendChild(h('p',{class:'helper-text'},unresolved
      ? 'Substitute the initialized value from program memory before evaluating this initializer.'
      : (ready ? `The initializer is resolved. Click = to assign it to ${statement.binding.name}.`
        : 'Evaluate the highlighted operator.')));
    const canReset = state.mode==='practice' && (program.cursor>0 || runtime.trace.length>0);
    const resetControl=renderItemResetControl(canReset);
    if(resetControl) card.appendChild(resetControl);
  }
  container.appendChild(card);
}

registerStatementRenderer('declaration',renderDeclarationStatement);
