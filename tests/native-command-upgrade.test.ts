import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNativeCommandAccess, assertNativeCommandCatalog, assertNativeCommandData, nativeCommandMigration, nativeApiRecovery, type NativeCommandCatalog} from '../deploy/demian/native-command-upgrade.mjs';
import type {NativeWebDatabaseState} from '../deploy/demian/native-web-database.mjs';

const empty='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const kinds=['columns','constraints','indexes','functions','triggers']as const;
const golden:NativeCommandCatalog={
 columns:Array.from({length:21},(_,i)=>({table_name:'run_commands',column_name:'field'+i})),
 constraints:[...Array.from({length:17},(_,i)=>({table_name:'run_commands',name:'constraint'+i,definition:'copy constraint'+i})),{table_name:'runs',name:'runs_command_scope_unique',definition:'UNIQUE (organization_id, session_id, id)'}],
 indexes:['run_commands_accepted_head_idx','run_commands_pkey','run_commands_successor_idx','runs_command_scope_unique'].map(name=>({name,definition:'copy index '+name})),
 functions:['guard_run_command_scope','immutable_run_command'].map(name=>({name,definition:'copy function '+name})),
 triggers:['run_commands_immutable','run_commands_scope'].map(name=>({name,definition:'copy trigger '+name})),
};
const family=(name:string)=>[{name:'old-'+name,definition:'original'}];
const old:NativeCommandCatalog={columns:family('columns'),constraints:family('constraints'),indexes:family('indexes'),functions:family('functions'),triggers:family('triggers')};
const catalog=():NativeCommandCatalog=>{const result=structuredClone(old);for(const key of kinds)result[key].push(...structuredClone(golden[key]));return result;};
test('declared migration requires complete exact copy catalog delta and preserves every old definition',()=>{
 assert.equal(assertNativeCommandCatalog(old,catalog(),golden,nativeCommandMigration.sha256),true);
 for(const family of kinds){
  const changed=catalog();changed[family][0]!.definition='changed';assert.throws(()=>assertNativeCommandCatalog(old,changed,golden,nativeCommandMigration.sha256));
  const extra=catalog();extra[family].push({name:'unexpected',definition:'unexpected'});assert.throws(()=>assertNativeCommandCatalog(old,extra,golden,nativeCommandMigration.sha256));
  const weak=catalog();weak[family].at(-1)!.definition='weakened';assert.throws(()=>assertNativeCommandCatalog(old,weak,golden,nativeCommandMigration.sha256));
 }
 assert.throws(()=>assertNativeCommandCatalog(old,catalog(),golden,'0'.repeat(64)));
});
test('existing views and grants cannot be weakened; new table is owned only by the existing database role',()=>{
 const before={views:[{name:'prepared_codex_private_sessions',definition:'privacy filter'}],grants:[{table_name:'runs',grantee:'demian',privilege_type:'SELECT',is_grantable:'YES'}]};
 const after=()=>({...structuredClone(before),grants:[...structuredClone(before.grants),...['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'].map(privilege_type=>({table_name:'run_commands',grantee:'demian',privilege_type,is_grantable:'YES'}))]});
 assert.equal(assertNativeCommandAccess(before,after()),true);
 const view=after();view.views[0]!.definition='all users';assert.throws(()=>assertNativeCommandAccess(before,view));
 const lost=after();lost.grants.shift();assert.throws(()=>assertNativeCommandAccess(before,lost));
 const publicGrant=after();publicGrant.grants[1]!.grantee='PUBLIC';assert.throws(()=>assertNativeCommandAccess(before,publicGrant));
 const wrongTable=after();wrongTable.grants[1]!.table_name='users';assert.throws(()=>assertNativeCommandAccess(before,wrongTable));
});
function data(){
 const workers=['deployment_services','managed_child_catalogs','worker_runtime_capabilities'];
 const before:NativeWebDatabaseState={data:{schemaSha256:'before-schema',sequenceSha256:'sequence',dataSha256:'before-data',tables:[...workers.map(table=>({table,count:'1',sha256:'old-clock'})),{table:'runs',count:'1',sha256:'business'},{table:'schema_migrations',count:'26',sha256:'old-markers'},{table:'work_runtime_delegation_nonces',count:'0',sha256:empty}],workerFreshness:{version:1,observedAtMicros:'100000',tables:workers.map((table,i)=>({table,column:'checked_at',rows:[{sha256:String(i+1).repeat(64),checkedAtMicros:'90000'}]}))},delegationNonces:{version:1,observedAtMicros:'100000',snapshot:'10:20:',rows:[]}},security:{sha256:'before-security',readOnly:true,components:Object.fromEntries(['roles','roleMemberships','roleDatabaseSettings','defaultAcls','extensions','database','schemas','policies'].map(key=>[key,{count:1,sha256:key}]))}};
 const after=structuredClone(before);after.data.schemaSha256='after-schema';after.data.dataSha256='after-data';after.security.sha256='after-security';after.data.tables.push({table:'run_commands',count:'0',sha256:empty});after.data.tables.find(t=>t.table==='schema_migrations')!.count='27';after.data.tables.find(t=>t.table==='schema_migrations')!.sha256='new-marker';
 after.data.workerFreshness!.observedAtMicros='200000';for(const table of after.data.workerFreshness!.tables)table.rows[0]!.checkedAtMicros='150000';for(const table of after.data.tables.filter(t=>workers.includes(t.table)))table.sha256='new-clock';
 after.data.delegationNonces!.observedAtMicros='200000';after.data.delegationNonces!.snapshot='20:40:';after.data.delegationNonces!.rows.push({keySha256:'a'.repeat(64),rowSha256:'b'.repeat(64),acceptedAtMicros:'150000',expiresAtMicros:'1000000',retainUntilMicros:'121000000',transactionId:'30'});after.data.tables.find(t=>t.table==='work_runtime_delegation_nonces')!.count='1';
 return{before,after,oldMarkers:structuredClone(before.data.tables.find(t=>t.table==='schema_migrations')!)};
}
test('data projection admits only one migration marker, an empty ledger, normal nonce append and worker clocks',()=>{
 const{before,after,oldMarkers}=data();assert.equal(assertNativeCommandData(before,after,oldMarkers,1),true);
});
for(const[kind,mutate]of Object.entries<Record<string,(v:NativeWebDatabaseState)=>void>[string]>({
 'business mutation':v=>{v.data.tables.find(t=>t.table==='runs')!.sha256='changed';},
 'unexpected table':v=>{v.data.tables.push({table:'unexpected',count:'0',sha256:empty});},
 'populated command ledger':v=>{v.data.tables.find(t=>t.table==='run_commands')!.count='1';},
 'sequence mutation':v=>{v.data.sequenceSha256='changed';},
 'new role grant':v=>{v.security.components.roles!.sha256='changed';},
 'worker capability mutation':v=>{v.data.workerFreshness!.tables[0]!.rows[0]!.sha256='f'.repeat(64);},
 'absent nonce evidence':v=>{delete v.data.delegationNonces;},
 'second migration marker':v=>{v.data.tables.find(t=>t.table==='schema_migrations')!.count='28';},
})){test('upgrade refuses '+kind,()=>{const{before,after,oldMarkers}=data();mutate(after);assert.throws(()=>assertNativeCommandData(before,after,oldMarkers,1));});}
test('previous migration markers must remain exact and exactly one new marker must exist',()=>{
 const{before,after,oldMarkers}=data();assert.throws(()=>assertNativeCommandData(before,after,{...oldMarkers,sha256:'changed'},1));assert.throws(()=>assertNativeCommandData(before,after,oldMarkers,0));assert.throws(()=>assertNativeCommandData(before,after,oldMarkers,2));
});
test('failed journal after pointer switch cannot block recovery of the stopped API',async()=>{
 const state=nativeApiRecovery();let apiLive=true,pointer='old',recoveryCalls=0;
 await state.stop(async()=>{apiLive=false;});pointer='candidate';
 const result=await state.recover({journal:async()=>{throw Error('disk full');},recover:async()=>{recoveryCalls++;pointer='old';apiLive=true;}});
 assert.equal(recoveryCalls,1);assert.equal(apiLive,true);assert.equal(pointer,'old');assert.equal(result.recovered,true);assert.equal(result.journalUnverified,true);
});
test('terminate then inspection failure still attempts ownership-aware recovery',async()=>{
 const state=nativeApiRecovery();let apiLive=true,recoveryCalls=0;
 await assert.rejects(state.stop(async()=>{apiLive=false;throw Error('inspection unavailable after terminate');}));
 const result=await state.recover({journal:async()=>{},recover:async()=>{recoveryCalls++;apiLive=true;}});
 assert.equal(recoveryCalls,1);assert.equal(apiLive,true);assert.equal(result.recovered,true);
});
test('indeterminate ownership is explicitly unverified and no process is terminated by the recovery controller',async()=>{
 const state=nativeApiRecovery();let inspectionCalls=0;
 await assert.rejects(state.stop(async()=>{throw Error('stop observation unavailable');}));
 const result=await state.recover({journal:async()=>{throw Error('journal unavailable');},recover:async()=>{inspectionCalls++;throw Error('identity and port unavailable');}});
 assert.equal(inspectionCalls,1);assert.equal(result.recovered,false);assert.equal(result.recoveryUnverified,true);assert.equal(result.journalUnverified,true);
});
