import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNativeWebDatabasePreserved, nativeWebDatabaseState, type NativeWebDatabaseState} from '../deploy/demian/native-web-database.mjs';

const name='work_runtime_delegation_nonces';
const second=1_000_000n;
const row=(id:number,accepted:bigint)=>({keySha256:String(id).repeat(64),rowSha256:String(id+1).repeat(64),acceptedAtMicros:String(accepted*second),expiresAtMicros:String((accepted+60n)*second),retainUntilMicros:String((accepted+180n)*second),transactionId:id===1?'11':'30'});
function fixture():NativeWebDatabaseState{
 return {data:{schemaSha256:'schema',sequenceSha256:'sequences',dataSha256:'raw-before',tables:[{table:'runs',count:'1',sha256:'business'},{table:name,count:'1',sha256:'nonce-before'}],delegationNonces:{version:1,snapshot:'10:20:',observedAtMicros:String(1000n*second),rows:[row(1,900n)]}},security:{sha256:'security',readOnly:true,components:{}}};
}
function appended(){
 const before=fixture(),after=structuredClone(before);
 after.data.delegationNonces!.observedAtMicros=String(1100n*second);
 after.data.delegationNonces!.snapshot='20:40:';
 after.data.delegationNonces!.rows.push(row(3,1050n));
 after.data.tables[1]={table:name,count:'2',sha256:'nonce-after'};after.data.dataSha256='raw-after';
 return {before,after};
}
test('live signed metadata reads may append valid nonces without rewriting any old nonce',()=>{
 const {before,after}=appended();assert.equal(assertNativeWebDatabasePreserved(before,after),true);
});
test('nonce mode also accepts byte-identical unchanged snapshots',()=>{const before=fixture();assert.equal(assertNativeWebDatabasePreserved(before,structuredClone(before)),true);});
test('concurrent accepted nonce can commit after the first snapshot clock',()=>{
 const {before,after}=appended();before.data.delegationNonces!.snapshot='10:20:15';
 after.data.delegationNonces!.rows[1]={...row(3,999n),transactionId:'15'};
 assert.equal(assertNativeWebDatabasePreserved(before,after),true);
});
test('nonce appends and live worker clock advances compose without permitting registry changes',()=>{
 const {before,after}=appended(),names=['deployment_services','managed_child_catalogs','worker_runtime_capabilities'];
 for(const value of [before,after]){
  value.data.tables.unshift(...names.map(table=>({table,count:'1',sha256:'old-clock'})));
  value.data.workerFreshness={version:1,observedAtMicros:String(1000n*second),tables:names.map((table,i)=>({table,column:'checked_at',rows:[{sha256:String(i+1).repeat(64),checkedAtMicros:String(900n*second)}]}))};
 }
 after.data.workerFreshness!.observedAtMicros=String(1100n*second);
 for(const table of after.data.workerFreshness!.tables)table.rows[0]!.checkedAtMicros=String(1050n*second);
 for(const table of after.data.tables.filter(t=>names.includes(t.table)))table.sha256='new-clock';
 assert.equal(assertNativeWebDatabasePreserved(before,after),true);
 after.data.workerFreshness!.tables[0]!.rows[0]!.sha256='f'.repeat(64);
 assert.throws(()=>assertNativeWebDatabasePreserved(before,after));
});
const rejects:Record<string,(v:NativeWebDatabaseState)=>void>={
 'missing old nonce even after retention expired':v=>{v.data.delegationNonces!.rows.shift();v.data.tables[1]!.count='1';},
 'old nonce payload changed':v=>{v.data.delegationNonces!.rows[0]!.rowSha256='f'.repeat(64);},
 'old nonce accepted time changed':v=>{v.data.delegationNonces!.rows[0]!.acceptedAtMicros=String(901n*second);},
 'old nonce expiry extended':v=>{v.data.delegationNonces!.rows[0]!.expiresAtMicros=String(961n*second);v.data.delegationNonces!.rows[0]!.retainUntilMicros=String(1081n*second);},
 'new nonce from transaction already visible at baseline':v=>{v.data.delegationNonces!.rows[1]!.transactionId='15';},
 'nonce still uncommitted in current snapshot':v=>{v.data.delegationNonces!.snapshot='20:40:30';},
 'nonce from current future transaction':v=>{v.data.delegationNonces!.rows[1]!.transactionId='40';},
 'malformed snapshot':v=>{v.data.delegationNonces!.snapshot='20:40:030';},
 'duplicate in-progress transaction':v=>{v.data.delegationNonces!.snapshot='20:40:25,25';},
 'invalid snapshot bounds':v=>{v.data.delegationNonces!.snapshot='40:20:';},
 'new nonce accepted in future':v=>{v.data.delegationNonces!.rows[1]=row(3,1101n);},
 'invalid expiry':v=>{v.data.delegationNonces!.rows[1]!.expiresAtMicros=String(1050n*second);},
 'lifetime above signed 60-second maximum':v=>{v.data.delegationNonces!.rows[1]!.expiresAtMicros=String(1111n*second);v.data.delegationNonces!.rows[1]!.retainUntilMicros=String(1231n*second);},
 'shortened replay retention':v=>{v.data.delegationNonces!.rows[1]!.retainUntilMicros=String(1229n*second);},
 'unknown projection version':v=>{(v.data.delegationNonces! as {version:number}).version=2;},
 'duplicate nonce identity':v=>{v.data.delegationNonces!.rows[1]!.keySha256=v.data.delegationNonces!.rows[0]!.keySha256;},
 'malformed digest':v=>{v.data.delegationNonces!.rows[1]!.rowSha256='x';},
 'noncanonical timestamp':v=>{v.data.delegationNonces!.rows[1]!.acceptedAtMicros='01050000000';},
 'clock regression':v=>{v.data.delegationNonces!.observedAtMicros=String(999n*second);},
 'projection count mismatch':v=>{v.data.tables[1]!.count='3';},
 'missing projection':v=>{delete v.data.delegationNonces;},
 'missing nonce table':v=>{v.data.tables.pop();},
 'business row changed':v=>{v.data.tables[0]!.sha256='changed';},
 'schema changed':v=>{v.data.schemaSha256='changed';},
 'sequence changed':v=>{v.data.sequenceSha256='changed';},
 'security changed':v=>{v.security.sha256='changed';},
};
for(const [name,mutate]of Object.entries(rejects))test('nonce preservation refuses '+name,()=>{
 const {before,after}=appended();mutate(after);assert.throws(()=>assertNativeWebDatabasePreserved(before,after));
});
test('legacy snapshots do not silently opt in to append exceptions',()=>{
 const {before,after}=appended();delete before.data.delegationNonces;delete after.data.delegationNonces;
 assert.throws(()=>assertNativeWebDatabasePreserved(before,after));
});

// Exercise collection as well as comparison: PostgreSQL's frozen tuple xmin is
// special, while a normal tuple created before wrap keeps its original epoch.
function database(snapshot:string,low:string){
 return {async query(sql:string){
  if(sql.includes("current_setting('transaction_read_only')"))return {rows:[{transaction_read_only:'on',value:'on'}]};
  if(sql.includes('pg_current_snapshot()'))return {rows:[{value:snapshot}]};
  if(sql.includes('FROM pg_catalog.pg_tables'))return {rows:[{tablename:name}]};
  if(sql.includes('AS "keySha256"'))return {rows:[{...row(1,900n),transactionId:low}]};
  if(sql.includes('SELECT count(*)::text AS count'))return {rows:[{count:'1',sha256:'raw'}]};
  if(sql.includes('SELECT count(*)::int AS count'))return {rows:[{count:0,sha256:'empty'}]};
  if(sql.includes('clock_timestamp()'))return {rows:[{value:String(1000n*second)}]};
  return {rows:[]};
 }};
}
for(const [label,low,expected]of [['frozen','2','2'],['normal pre-wrap','4294967293','4294967293']]as const){
 test('collected '+label+' nonce tuple identity stays stable over xid wrap',async()=>{
  const before=await nativeWebDatabaseState(database('4294967294:4294967295:',low),{delegationNonces:true});
  const after=await nativeWebDatabaseState(database('4294967299:4294967300:',low),{delegationNonces:true});
  assert.equal(before.data.delegationNonces!.rows[0]!.transactionId,expected);
  assert.equal(after.data.delegationNonces!.rows[0]!.transactionId,expected);
  assert.equal(assertNativeWebDatabasePreserved(before,after),true);
 });
}
