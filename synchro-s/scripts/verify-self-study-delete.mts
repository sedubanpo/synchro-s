import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createSyncDraftUndoSnapshot, restoreSyncDraftUndoSnapshot } from '../lib/syncDraftUndo';
const source=readFileSync(new URL('../app/synchro-s/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler='';
function visit(node:ts.Node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleDeleteSingleSchedule'&&node.initializer&&ts.isCallExpression(node.initializer)) handler=node.initializer.arguments[0]!.getText(ast);
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler);
const js=ts.transpileModule(`(${handler})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const id of ['self-study:s1:1','sync-draft:1']){
 let state={syncDraftItems:[{id:'sync-draft:1'}],stagedEventUpdates:{[id]:{id}},stagedDeletedEventIds:[] as string[]};
 const before=JSON.stringify(state);let undo:any;
 const context={
  isSyncDraftEventId:(key:string)=>key.startsWith('sync-draft:'),currentTargetId:'s1',roleView:'student',studentScheduleInputTab:'sync',
  captureSyncDraftUndo:(label:string)=>{undo=createSyncDraftUndoSnapshot('scope',label,state);},
  setSyncDraftItems:(fn:any)=>{state.syncDraftItems=fn(state.syncDraftItems);},
  setStagedDeletedEventIds:(fn:any)=>{state.stagedDeletedEventIds=fn(state.stagedDeletedEventIds);},
  setStagedEventUpdates:(fn:any)=>{state.stagedEventUpdates=fn(state.stagedEventUpdates);},
  setNotice:()=>{},setLessonAutosave:()=>{},fetch:()=>{throw Error('Staged deletion must not write immediately');}
 };
 await vm.runInNewContext(js,context)({id,subjectName:'자기주도학습',startTime:'19:00',endTime:'20:00'});
 if(id.startsWith('self-study:')) assert.equal(state.stagedDeletedEventIds[0],id);
 else assert.equal(state.syncDraftItems.length,0);
 assert.equal(JSON.stringify(restoreSyncDraftUndoSnapshot(undo,'scope')),before);
}
console.log('PASS: actual delete handler stages saved self-study, removes draft self-study, and undo restores both without an immediate server write.');
