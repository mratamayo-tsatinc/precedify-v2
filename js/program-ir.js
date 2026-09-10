// ============================================================================
// PROGRAM IR — language-neutral authoring helpers
// ----------------------------------------------------------------------------
// Parsers, generators and imported exercises converge on these plain-data
// shapes. They deliberately contain no DOM, animation, persistence or scoring
// behavior. Additional statement kinds may be introduced by plugins without
// changing this file.
// ============================================================================

const ASSIGNMENT_OPERATORS = Object.freeze(['=','+=','-=','*=','/=','%=']);

function literalExpression(value, opts){
  return Object.assign({kind:'literal', value}, opts||{});
}

function identifierExpression(name, opts){
  if(typeof name !== 'string' || !name) throw new Error('Identifier expression requires a name');
  return Object.assign({kind:'identifier', name}, opts||{});
}

function unaryExpression(operator, operand, opts){
  return Object.assign({kind:'unary', operator, operand}, opts||{});
}

function binaryExpression(operator, left, right, opts){
  return Object.assign({kind:'binary', operator, left, right}, opts||{});
}

function declarationStatement(spec){
  spec = spec || {};
  if(!spec.name) throw new Error('Declaration statement requires a name');
  if(!spec.initializer) throw new Error(`Declaration '${spec.name}' requires an initializer`);
  return {
    id: spec.id || null,
    kind: 'declaration',
    binding: {
      name: spec.name,
      dataType: spec.dataType || 'int',
      mutable: spec.mutable !== false
    },
    initializer: spec.initializer,
    sourceSpan: spec.sourceSpan || null
  };
}

function assignmentStatement(spec){
  spec = spec || {};
  if(!spec.target) throw new Error('Assignment statement requires a target');
  if(!ASSIGNMENT_OPERATORS.includes(spec.operator || '=')) throw new Error(`Unsupported assignment operator '${spec.operator}'`);
  if(!spec.value) throw new Error(`Assignment to '${spec.target}' requires a value expression`);
  return {
    id: spec.id || null,
    kind: 'assignment',
    target: spec.target,
    operator: spec.operator || '=',
    value: spec.value,
    sourceSpan: spec.sourceSpan || null
  };
}

function unaryUpdateStatement(spec){
  spec = spec || {};
  if(!spec.target) throw new Error('Unary update statement requires a target');
  if(spec.operator!=='++'&&spec.operator!=='--'){
    throw new Error(`Unsupported unary update operator '${spec.operator}'`);
  }
  const form=spec.form==='prefix'?'prefix':'postfix';
  return {
    id:spec.id||null,
    kind:'unary-update',
    target:spec.target,
    operator:spec.operator,
    form,
    sourceSpan:spec.sourceSpan||null
  };
}

function expressionStatement(expression, opts){
  opts = opts || {};
  if(!expression) throw new Error('Expression statement requires an expression');
  return {id:opts.id||null, kind:'expression', expression, sourceSpan:opts.sourceSpan||null};
}

function collectExpressionDependencies(expression, out){
  out = out || new Set();
  if(!expression || typeof expression !== 'object') return out;
  if(expression.kind === 'identifier') out.add(expression.name);
  if(expression.operand) collectExpressionDependencies(expression.operand, out);
  if(expression.left) collectExpressionDependencies(expression.left, out);
  if(expression.right) collectExpressionDependencies(expression.right, out);
  return out;
}
