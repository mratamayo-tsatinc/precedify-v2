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

function renderDeclarationEquals(statement,ready,context,item){
  const strictCandidate=typeof strictSequenceEnabled==='function'&&strictSequenceEnabled()
    &&context&&context.isCurrent&&!item.checked&&!item.practiceInvalidExecution;
  if(!ready&&!strictCandidate) return '=';
  return h('button',{class:'declaration-equals tok tok-op-active tok-colored ready'+(strictCandidate?' strict-sequence-candidate':''),
    title:`Assign the current value to ${statement.binding.name}`,
    'aria-label':`assign value to ${statement.binding.name}`,
    onclick:()=>handleTokenClick({type:'commit-assignment'})},'=');
}

function renderDeclarationStatement(ctx){
  const {container,item,program,statement,statementIndex,isActive} = ctx;
  const runtime = statement.runtime;
  const expanded=statement.status==='complete'&&!!(statement._uiExpanded||statement._uiJustCompleted);

  const card = h('section',{class:`program-statement declaration-statement ${statement.status}${item.practiceInvalidExecution?' practice-paused':''}`,
    'data-statement-id':statement.id});
  if(!isActive&&!expanded){
    card.appendChild(renderProgramStatementSummary(statement,statementIndex,
      programStatementSource(statement,item)));
    container.appendChild(card);
    return;
  }
  card.classList.add('expanded');

  const labelText = `${declarationKeyword(statement)} ${statement.binding.name}`;
  card.appendChild(renderExpressionEvaluationPanel({
    runtime,
    labelText,
    labelCh:labelText.length+1,
    title:null,
    panelClass:'declaration-eval-panel program-expression-panel',
    statementId:statement.id,
    statementNumber:statementIndex+1,
    continuationStyle:true,
    interactive:isActive && !runtime.checked && !item.checked && !item.practiceInvalidExecution,
    revealCorrectness:runtime.checked&&state.mode!=='exam',
    isFullyResolved:()=>declarationInitializerResolved(statement),
    renderEquals:(ready,context)=>renderDeclarationEquals(statement,ready,context,item),
    renderTrailingActions:()=>isActive
      ? renderInlineEvaluationActions({canUndo:canUndoForCurrentMode(item)})
      : renderCollapseStatementAction(statement,statementIndex)
  }));

  if(isActive&&!item.checked){
    const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
    const ready = declarationInitializerResolved(statement);
    if(state.mode==='practice'&&item.practiceInvalidExecution){
      card.appendChild(renderContextHelp(strictPracticeInvalidMessage(item)));
    } else if(state.mode!=='exam'||activeExamPolicy().showNeutralGuidance){
      card.appendChild(renderContextHelp(unresolved
        ? 'Substitute the initialized value from program memory before evaluating this initializer.'
        : (ready ? `The initializer is resolved. Click = to assign it to ${statement.binding.name}.`
          : 'Evaluate the highlighted operator.')));
    }
    const canReset = state.mode==='practice' && (program.cursor>0 || runtime.trace.length>0);
    const resetControl=renderItemResetControl(canReset);
    if(resetControl) card.appendChild(resetControl);
  }
  container.appendChild(card);
}

registerStatementRenderer('declaration',renderDeclarationStatement);
