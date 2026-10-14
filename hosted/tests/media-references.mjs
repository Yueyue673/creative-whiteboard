import assert from 'node:assert/strict';
import {checkedReferences} from '../core/portal_assets/board-media.js';
const scope={workspace:'00000000-0000-0000-0000-000000000001',account:1},id='00000000-0000-0000-0000-000000000002';
const value={...scope,assetId:id,checkedAt:1,coverage:'visibleSavedRecords',scannedRecords:1,counts:{board:1,trash:0,catalog:0,history:0,catalogHistory:0,draft:0},items:[{category:'board',kind:'board',key:'one',id:'1',name:'Own <img> title',revision:1,savedAt:1,match:'direct'}],hiddenResults:0,privateSubmissionsExcluded:true,browserInputExcluded:true,deletionSafe:false};
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('Exact frozen account workspace asset and rows',()=>{const result=checkedReferences(value,scope,id);assert.equal(result.items[0].name,'Own <img> title');assert.ok(Object.isFrozen(result.items[0]));});
check('Reject changed scope or asset',()=>{for(const patch of [{workspace:id},{account:2},{assetId:scope.workspace}])assert.throws(()=>checkedReferences({...value,...patch},scope,id));});
check('No result can certify deletion or include others private drafts',()=>{for(const patch of [{deletionSafe:true},{privateSubmissionsExcluded:false},{browserInputExcluded:false}])assert.throws(()=>checkedReferences({...value,...patch},scope,id));});
check('Reject unbounded or inconsistent counts',()=>{for(const patch of [{scannedRecords:501},{hiddenResults:1},{counts:{...value.counts,board:2}},{coverage:'allUnusedFiles'}])assert.throws(()=>checkedReferences({...value,...patch},scope,id));});
check('Reject forged path, categories or unsafe identity',()=>{for(const patch of [{key:'../escape'},{category:'othersDrafts'},{kind:'library'},{id:'nan'},{revision:null},{savedAt:NaN}])assert.throws(()=>checkedReferences({...value,items:[{...value.items[0],...patch}]},scope,id));});
check('Partial or empty inspection stays explicitly non-destructive',()=>{for(const coverage of ['limited','visibleSavedRecords'])assert.equal(checkedReferences({...value,coverage,scannedRecords:0,counts:{...value.counts,board:0},items:[]},scope,id).deletionSafe,false);});
console.log(JSON.stringify({checks}));
