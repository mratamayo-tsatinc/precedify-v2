// ============================================================================
// GENERATED PROGRAM ADAPTER
// ----------------------------------------------------------------------------
// Converts a generated expression item into either the unchanged one-statement
// compatibility program or an opt-in declaration chain followed by that same
// expression item. Generation remains independent of rendering/evaluation.
// ============================================================================

function engineNodeToProgramIr(node){
  if(node.kind === 'literal') return literalExpression(node.value, {id:node.id});
  if(node.kind === 'variable' || node.kind === 'constant'){
    return identifierExpression(node.name, {id:node.id});
  }
  if(node.kind === 'unary'){
    return unaryExpression(node.op, engineNodeToProgramIr(node.inner), {id:node.id, form:node.form});
  }
  return binaryExpression(node.op, engineNodeToProgramIr(node.left), engineNodeToProgramIr(node.right), {id:node.id});
}

function declarationInitializerTree(declarations, index){
  const target = declarations[index];
  if(index === 0) return makeLiteral(target.value);

  // The profile currently selects `previous`: each declaration truly depends
  // on the statement immediately before it. The adapter preserves the seeded
  // target value by expressing its difference as + or -, so the later final
  // expression receives exactly the values the existing generator selected.
  const previous = declarations[index-1];
  const previousRef = makeNamed(previous.kind, previous.name, previous.value);
  const difference = Math.abs(target.value - previous.value);
  const operator = target.value >= previous.value ? '+' : '-';
  return makeBinOp(operator, previousRef, makeLiteral(difference));
}

function buildDeclarationRuntime(tree, expectedValue){
  const originalFlat = flattenInstance(tree);
  return {
    originalTree: tree,
    originalFlat,
    workingFlat: deepCloneFlat(originalFlat),
    history: [deepCloneFlat(originalFlat)],
    trace: [],
    canonicalTrace: buildCanonicalTrace(tree),
    expectedValue,
    checked: false,
    correctSteps: 0,
    totalOpSteps: 0,
    wasCorrectAssignment: null,
    assignedValue: null
  };
}

function namedValueTree(declaration,memory){
  return makeNamed(declaration.kind,declaration.name,memory[declaration.name]);
}

function buildAssignmentStatementRuntime(target,operator,rhsTree,memory,index){
  const expectedBefore=memory[target];
  const expectedRhs=evalTree(rhsTree);
  const expectedAfter=applyAssignmentOperator(operator,expectedBefore,expectedRhs);
  const statement=assignmentStatement({id:`assignment-${index+1}`,target,operator,value:engineNodeToProgramIr(rhsTree)});
  statement.runtime=buildDeclarationRuntime(rhsTree,expectedRhs);
  statement.runtime.expectedBefore=expectedBefore;
  statement.runtime.expectedRhs=expectedRhs;
  statement.runtime.expectedAfter=expectedAfter;
  statement.runtime.beforeValue=null;
  statement.runtime.rhsValue=null;
  statement.runtime.targetRevealed=false;
  statement.runtime.targetReadValue=null;
  statement.runtime.assignmentActionOrder=[];
  statement.runtime.assignmentResultNodeId=null;
  statement.runtime.assignmentMergePending=false;
  statement.dependencies=[...collectExpressionDependencies(statement.value)];
  memory[target]=expectedAfter;
  return statement;
}

function buildAssignmentLessonStatements(item,lesson,memory){
  const variables=item.decls.filter(d=>d.kind==='variable');
  const constants=item.decls.filter(d=>d.kind==='constant');
  const a=variables[0], b=variables[1]||variables[0], c=variables[2]||variables[0];
  const k=constants[0];
  const specs=[];
  const add=(target,operator,tree)=>specs.push({target,operator,tree});

  if(lesson==='basic-set') add(a.name,'=',makeLiteral(memory[a.name]+2));
  else if(lesson==='add-sub'){
    add(a.name,'+=',makeLiteral(5)); add(a.name,'-=',makeLiteral(3));
  } else if(lesson==='multiply') add(a.name,'*=',makeLiteral(4));
  else if(lesson==='divide-remainder'){
    add(a.name,'/=',makeLiteral(2)); add(a.name,'%=',makeLiteral(5));
  } else if(lesson==='rhs-expression'){
    add(a.name,'+=',makeBinOp('*',namedValueTree(b,memory),makeLiteral(4)));
  } else if(lesson==='sequential'){
    add(a.name,'+=',makeLiteral(8)); add(a.name,'*=',makeLiteral(2)); add(a.name,'-=',makeLiteral(5));
  } else if(lesson==='dependent'){
    add(a.name,'+=',namedValueTree(b,memory));
    const constantNode=k?namedValueTree(k,memory):makeLiteral(3);
    // This tree is created after the first spec is applied below, so its
    // target reference must use the then-current memory value.
    specs.push({target:b.name,operator:'*=',treeFactory:()=>makeBinOp('-',namedValueTree(a,memory),constantNode)});
  } else if(lesson==='advanced'){
    add(a.name,'+=',makeBinOp('*',namedValueTree(b,memory),namedValueTree(c,memory)));
    specs.push({target:b.name,operator:'*=',treeFactory:()=>makeBinOp('-',namedValueTree(a,memory),makeLiteral(10))});
    specs.push({target:a.name,operator:'%=',treeFactory:()=>makeBinOp('+',namedValueTree(c,memory),makeLiteral(5))});
  }

  return specs.map((spec,index)=>{
    const tree=spec.treeFactory?spec.treeFactory():spec.tree;
    return buildAssignmentStatementRuntime(spec.target,spec.operator,tree,memory,index);
  });
}

function buildUnaryUpdateStatementRuntime(target,operator,form,memory,index){
  const expectedBefore=memory[target];
  const expectedAfter=expectedBefore+(operator==='++'?1:-1);
  const tree=makeUnary(operator,form,makeNamed('variable',target,expectedBefore));
  const statement=unaryUpdateStatement({
    id:`unary-update-${index+1}`,target,operator,form
  });
  statement.runtime=buildDeclarationRuntime(tree,expectedAfter);
  statement.runtime.expectedBefore=expectedBefore;
  statement.runtime.expectedAfter=expectedAfter;
  statement.runtime.beforeMemory=null;
  statement.runtime.beforeValue=null;
  statement.runtime.assignedValue=null;

  // The generic unary engine correctly models postfix expression values as
  // the original value. In a standalone statement that value is discarded;
  // the observable result is the updated memory value, so canonical playback
  // normalizes only this statement-local final state to that stored value.
  const canonical=statement.runtime.canonicalTrace;
  const finalTree=canonical&&canonical.treeStates&&canonical.treeStates[canonical.treeStates.length-1];
  const finalStep=canonical&&canonical.steps&&canonical.steps[canonical.steps.length-1];
  if(finalTree&&finalTree.kind==='unary') finalTree.resultValue=expectedAfter;
  if(finalStep&&finalStep.action==='UNARY'){
    finalStep.result=expectedAfter;
    finalStep.expressionAfter=renderString(finalTree);
  }
  statement.dependencies=[target];
  memory[target]=expectedAfter;
  return statement;
}

function buildUnaryUpdateLessonStatements(item,lesson,memory){
  const variables=item.decls.filter(declaration=>declaration.kind==='variable');
  const first=variables[0],second=variables[1]||variables[0];
  if(!first) return [];
  const specs=lesson==='standalone-sequence'
    ? [
        {target:first.name,operator:'++',form:'postfix'},
        {target:second.name,operator:'--',form:'prefix'},
        {target:first.name,operator:'++',form:'prefix'},
        {target:second.name,operator:'--',form:'postfix'}
      ]
    : [];
  return specs.map((spec,index)=>buildUnaryUpdateStatementRuntime(
    spec.target,spec.operator,spec.form,memory,index));
}

function applyProgramMemoryToTree(node,memory){
  if(!node) return;
  if(node.kind==='variable'||node.kind==='constant'){
    if(Object.prototype.hasOwnProperty.call(memory,node.name)) node.declaredValue=memory[node.name];
    return;
  }
  if(node.kind==='unary') return applyProgramMemoryToTree(node.inner,memory);
  if(node.kind==='binop'){
    applyProgramMemoryToTree(node.left,memory);
    applyProgramMemoryToTree(node.right,memory);
  }
}

function rebuildFinalExpressionForMemory(item,memory){
  applyProgramMemoryToTree(item.originalTree,memory);
  item.originalFlat=flattenInstance(item.originalTree);
  item.workingFlat=deepCloneFlat(item.originalFlat);
  item.history=[deepCloneFlat(item.originalFlat)];
  item.trace=[];
  item.correctFinalValue=evalTree(item.originalTree);
  item.canonicalTrace=buildCanonicalTrace(item.originalTree);
}

function buildGeneratedProgram(item, profile){
  const cfg = profile && profile.program;
  if(!cfg || cfg.declarations !== 'interactive'){
    ensureProgramEnvelope(item);
    return item.program;
  }

  const isAssignmentLesson=!!cfg.assignmentLesson;
  const isUnaryUpdateLesson=!!cfg.unaryUpdateLesson;
  const isProgramLesson=isAssignmentLesson||isUnaryUpdateLesson;
  const statements = item.decls.map((decl, index)=>{
    const initializerTree = isProgramLesson ? makeLiteral(decl.value) : declarationInitializerTree(item.decls, index);
    const statement = declarationStatement({
      id:`declaration-${index+1}`,
      name:decl.name,
      dataType:decl.isBoolean ? 'boolean' : 'int',
      mutable:decl.kind !== 'constant',
      initializer:engineNodeToProgramIr(initializerTree)
    });
    statement.binding.kind = decl.kind;
    statement.runtime = buildDeclarationRuntime(initializerTree, decl.value);
    statement.dependencies = [...collectExpressionDependencies(statement.initializer)];
    return statement;
  });

  if(isAssignmentLesson){
    const expectedMemory={};
    item.decls.forEach(decl=>{expectedMemory[decl.name]=decl.value;});
    statements.push(...buildAssignmentLessonStatements(item,cfg.assignmentLesson,expectedMemory));
    rebuildFinalExpressionForMemory(item,expectedMemory);
  }

  if(isUnaryUpdateLesson){
    const expectedMemory={};
    item.decls.forEach(decl=>{expectedMemory[decl.name]=decl.value;});
    statements.push(...buildUnaryUpdateLessonStatements(item,cfg.unaryUpdateLesson,expectedMemory));
    rebuildFinalExpressionForMemory(item,expectedMemory);
  }

  statements.push({
    id:'final-expression',
    kind:'legacy-expression',
    status:'locked'
  });

  item.program = createProgram(statements, {
    id:`${profile.id}-program`,
    language:(typeof state === 'object' && state && state.language) || 'java'
  });
  item.program.mode = isProgramLesson ? 'interactive-program' : 'interactive-declarations';
  item.program.scoreAssignments = cfg.scoreAssignments !== false;
  return item.program;
}
