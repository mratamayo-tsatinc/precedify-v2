// ============================================================================
// PROGRAM CORE — statement-agnostic orchestration
// ----------------------------------------------------------------------------
// An activity item is now allowed to represent a whole program. The core only
// knows that a program has ordered statements; statement meaning is supplied
// by registered plugins. Existing profiles are wrapped as one
// `legacy-expression` statement so their behavior and persisted item fields
// remain unchanged.
// ============================================================================

const PROGRAM_SCHEMA_VERSION = 1;
const statementPluginRegistry = new Map();
const statementRendererRegistry = new Map();

function assertStatementKind(kind){
  if(typeof kind !== 'string' || !kind.trim()) throw new Error('A statement plugin requires a non-empty kind');
}

function registerStatementPlugin(plugin){
  if(!plugin || typeof plugin !== 'object') throw new Error('Statement plugin must be an object');
  assertStatementKind(plugin.kind);
  if(statementPluginRegistry.has(plugin.kind)) throw new Error(`Statement plugin '${plugin.kind}' is already registered`);
  statementPluginRegistry.set(plugin.kind, Object.freeze(Object.assign({}, plugin)));
  return plugin;
}

function registerStatementRenderer(kind, renderer){
  assertStatementKind(kind);
  if(typeof renderer !== 'function') throw new Error(`Renderer for '${kind}' must be a function`);
  statementRendererRegistry.set(kind, renderer);
  return renderer;
}

function createProgram(statements, opts){
  opts = opts || {};
  if(!Array.isArray(statements) || statements.length===0) throw new Error('A program requires at least one statement');
  const normalized = statements.map((statement, index)=>{
    if(!statement || typeof statement !== 'object') throw new Error(`Statement ${index} must be an object`);
    assertStatementKind(statement.kind);
    const normalizedStatement = Object.assign({}, statement);
    if(!normalizedStatement.id) normalizedStatement.id = `stmt-${index+1}`;
    if(!normalizedStatement.status) normalizedStatement.status = index===0?'active':'locked';
    return normalizedStatement;
  });
  return {
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    id: opts.id || null,
    language: opts.language || 'java',
    statements: normalized,
    cursor: Math.max(0, Math.min(normalized.length-1, opts.cursor || 0)),
    status: opts.status || 'running',
    memory: opts.memory || {},
    events: opts.events || []
  };
}

// Compatibility adapter. Runtime expression data deliberately stays on the
// item in its original shape: every existing renderer, persistence record and
// feedback calculation therefore reads the same fields it did before.
function ensureProgramEnvelope(item){
  if(!item || typeof item !== 'object') return null;
  if(!item.program || !Array.isArray(item.program.statements) || item.program.statements.length===0){
    item.program = createProgram([
      {id:'expression', kind:'legacy-expression', status:'active'}
    ], {
      id: item.profileId ? `${item.profileId}-item` : null,
      language: (typeof state === 'object' && state && state.language) || 'java'
    });
  }
  if(item.program.schemaVersion == null) item.program.schemaVersion = PROGRAM_SCHEMA_VERSION;
  if(!item.program.memory) item.program.memory = {};
  if(!Array.isArray(item.program.events)) item.program.events = [];
  return item.program;
}

function itemHasInteractiveProgram(item){
  return !!(item && item.program && item.program.mode);
}

function currentProgramStatement(item){
  const program = ensureProgramEnvelope(item);
  if(!program) return null;
  return program.statements[program.cursor] || null;
}

function statementPluginFor(statement){
  return statement ? statementPluginRegistry.get(statement.kind) || null : null;
}

function advanceProgram(program){
  const current = program.statements[program.cursor];
  if(current) current.status = 'complete';
  if(program.cursor < program.statements.length-1){
    program.cursor++;
    program.statements[program.cursor].status = 'active';
  } else {
    program.status = 'complete';
  }
}

// Commands are semantic objects such as SUBSTITUTE, EVALUATE or, in future,
// COMMIT_ASSIGNMENT. The core never interprets them itself.
function dispatchProgramAction(item, action, services){
  const program = ensureProgramEnvelope(item);
  const statement = currentProgramStatement(item);
  const plugin = statementPluginFor(statement);
  if(!plugin || typeof plugin.applyAction !== 'function') return {applied:false, reason:'unsupported-statement'};
  const result = plugin.applyAction({program, statement, item, action, services:services||{}}) || {applied:false};
  if(result.event) program.events.push(result.event);
  if(Array.isArray(result.events)) program.events.push(...result.events);
  if(result.completed) advanceProgram(program);
  return result;
}

function checkProgramItem(item, services){
  const program = ensureProgramEnvelope(item);
  const statement = currentProgramStatement(item);
  const plugin = statementPluginFor(statement);
  if(!plugin || typeof plugin.check !== 'function') return {applied:false, reason:'unsupported-statement'};
  const result = plugin.check({program, statement, item, services:services||{}}) || {applied:false};
  if(result.event) program.events.push(result.event);
  if(Array.isArray(result.events)) program.events.push(...result.events);
  if(result.completed) advanceProgram(program);
  return result;
}

function canUndoProgram(item){
  const program = ensureProgramEnvelope(item);
  const statement = currentProgramStatement(item);
  const plugin = statementPluginFor(statement);
  if(plugin && typeof plugin.canUndo === 'function' && plugin.canUndo({program, statement, item})) return true;
  return !!(program && program.cursor > 0);
}

function undoProgramAction(item, services){
  const program = ensureProgramEnvelope(item);
  const statement = currentProgramStatement(item);
  const plugin = statementPluginFor(statement);
  if(plugin && typeof plugin.undo === 'function'){
    const local = plugin.undo({program, statement, item, services:services||{}}) || {applied:false};
    if(local.applied) return local;
  }
  if(!program || program.cursor <= 0) return {applied:false};

  const current = program.statements[program.cursor];
  const previous = program.statements[program.cursor-1];
  const previousPlugin = statementPluginFor(previous);
  if(!previousPlugin || typeof previousPlugin.rollbackCompletion !== 'function') return {applied:false};
  const result = previousPlugin.rollbackCompletion({program, statement:previous, item, services:services||{}}) || {applied:false};
  if(!result.applied) return result;
  if(current) current.status = 'locked';
  previous.status = 'active';
  program.cursor--;
  program.status = 'running';
  return result;
}

function resetProgramAction(item, services){
  const program = ensureProgramEnvelope(item);
  if(!program) return {applied:false};
  let changed = program.cursor>0 || program.events.length>0;
  program.statements.forEach((statement, index)=>{
    const plugin = statementPluginFor(statement);
    if(plugin && typeof plugin.reset === 'function'){
      const result = plugin.reset({program, statement, item, services:services||{}}) || {applied:false};
      changed = changed || !!result.applied;
    }
    statement.status = index===0 ? 'active' : 'locked';
  });
  program.cursor = 0;
  program.status = 'running';
  program.memory = {};
  program.events = [];
  return {applied:changed};
}

function renderProgramItem(container, item, services){
  const program = ensureProgramEnvelope(item);
  if(!program) return;
  program.statements.forEach((statement, index)=>{
    const renderer = statementRendererRegistry.get(statement.kind);
    if(typeof renderer !== 'function') throw new Error(`No renderer registered for statement kind '${statement.kind}'`);
    renderer({
      container, item, program, statement, statementIndex:index,
      isActive:index===program.cursor && program.status!=='complete',
      services:services||{}
    });
  });
}

function buildCanonicalProgramTrace(item, services){
  const program = ensureProgramEnvelope(item);
  const events = [];
  program.statements.forEach(statement=>{
    const plugin = statementPluginFor(statement);
    if(!plugin || typeof plugin.buildCanonicalTrace !== 'function') return;
    const produced = plugin.buildCanonicalTrace({program, statement, item, services:services||{}});
    if(Array.isArray(produced)) events.push(...produced);
  });
  return events;
}
