import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNativeWebDatabasePreserved,type NativeWebDatabaseState} from '../deploy/demian/native-web-database.mjs';

const names=['deployment_services','managed_child_catalogs','worker_runtime_capabilities'];
function fixture():NativeWebDatabaseState{
 return {data:{schemaSha256:'schema',sequenceSha256:'sequence',dataSha256:'raw-before',tables:[...names.map((table,i)=>({table,count:'1',sha256:'raw-'+i})),{table:'runs',count:'1',sha256:'business'}],workerFreshness:{version:1,observedAtMicros:'1000',tables:names.map((table,i)=>({table,column:'checked_at',rows:[{sha256:String(i+1).repeat(64),checkedAtMicros:'900'}]}))}},security:{sha256:'security',readOnly:true,components:{}}};
}
test('running worker clock advance preserves all other rows and settings',()=>{
 const before=fixture(),after=structuredClone(before);after.data.dataSha256='raw-after';after.data.workerFreshness!.observedAtMicros='1200';
 for(const table of after.data.workerFreshness!.tables)table.rows[0]!.checkedAtMicros='1100';
 for(const table of after.data.tables.filter(t=>names.includes(t.table)))table.sha256='new-clock';
 assert.equal(assertNativeWebDatabasePreserved(before,after),true);
});
const rejects:Record<string,(value:NativeWebDatabaseState)=>void>={
 'registry capability, authority, identity or settings digest changed':v=>{v.data.workerFreshness!.tables[0]!.rows[0]!.sha256='a'.repeat(64);},
 'clock regressed':v=>{v.data.workerFreshness!.tables[0]!.rows[0]!.checkedAtMicros='899';},
 'future clock':v=>{v.data.workerFreshness!.tables[0]!.rows[0]!.checkedAtMicros='1001';},
 'noncanonical clock':v=>{v.data.workerFreshness!.tables[0]!.rows[0]!.checkedAtMicros='0900';},
 'lost registry row':v=>{v.data.workerFreshness!.tables[0]!.rows=[];},
 'registry count changed':v=>{v.data.tables[0]!.count='2';},
 'duplicate registry hash':v=>{v.data.workerFreshness!.tables[0]!.rows.push({...v.data.workerFreshness!.tables[0]!.rows[0]!});},
 'different ignored column':v=>{(v.data.workerFreshness!.tables[0]! as {column:string}).column='features';},
 'unknown registry table':v=>{v.data.workerFreshness!.tables[0]!.table='runs';},
 'freshness evidence missing':v=>{delete v.data.workerFreshness;},
 'business row changed':v=>{v.data.tables[3]!.sha256='changed';},
 'table removed':v=>{v.data.tables.pop();},
 'schema changed':v=>{v.data.schemaSha256='changed';},
 'sequence changed':v=>{v.data.sequenceSha256='changed';},
 'security changed':v=>{v.security.sha256='changed';},
};
for(const [name,mutate]of Object.entries(rejects))test('live-worker preservation refuses '+name,()=>{const before=fixture(),after=structuredClone(before);mutate(after);assert.throws(()=>assertNativeWebDatabasePreserved(before,after));});
test('legacy baselines require exact whole-data equality',()=>{
 const before=fixture();delete before.data.workerFreshness;const after=structuredClone(before);assert.equal(assertNativeWebDatabasePreserved(before,after),true);after.data.dataSha256='changed';assert.throws(()=>assertNativeWebDatabasePreserved(before,after));assert.throws(()=>assertNativeWebDatabasePreserved(before,fixture()));
});
