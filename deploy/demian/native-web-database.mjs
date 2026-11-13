import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const freshnessTables=['deployment_services','managed_child_catalogs','worker_runtime_capabilities'];
const digestPattern=/^[a-f0-9]{64}$/;
const micros=value=>{assert(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value));const n=BigInt(value);assert(n<=9223372036854775807n);return n;};
async function databaseFingerprint(pg,manageTransaction=true,workerFreshness=false){
 if(manageTransaction)await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
  assert.equal((await pg.query("SELECT current_setting('transaction_read_only') AS transaction_read_only")).rows[0].transaction_read_only,'on');
  const names=(await pg.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"")).rows.map(r=>r.tablename);
  assert(names.length>0&&names.length<=100);
  const tables=[],freshness=[];
  for(const table of names){
   assert.match(table,/^[a-z_][a-z0-9_]{0,62}$/);
   const row=(await pg.query(`SELECT count(*)::text AS count,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM public."${table}" t`)).rows[0];
   tables.push({table,count:row.count,sha256:row.sha256});
   if(workerFreshness&&freshnessTables.includes(table)){
    // Keep every identity, capability, authority and catalog field in the hash.
    // Only the worker publisher's checked_at clock may advance on the same row.
    const primaryKey=(await pg.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='public."${table}"'::regclass AND i.indisprimary ORDER BY a.attnum`)).rows.map(r=>r.attname);
    assert(primaryKey.length>0&&!primaryKey.includes('checked_at'));
    const rows=(await pg.query(`SELECT encode(sha256(convert_to((to_jsonb(t)-'checked_at')::text,'UTF8')),'hex') AS sha256,floor(extract(epoch FROM checked_at)*1000000)::text AS "checkedAtMicros" FROM public."${table}" t ORDER BY 1`)).rows;
    assert(rows.length<=10000&&String(rows.length)===row.count);
    freshness.push({table,column:'checked_at',rows});
   }
  }
  const columns=(await pg.query("SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,character_maximum_length FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const constraints=(await pg.query("SELECT c.relname,con.conname,pg_get_constraintdef(con.oid,true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname")).rows;
  const indexes=(await pg.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  const views=(await pg.query("SELECT viewname,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname")).rows;
  const grants=(await pg.query("SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type")).rows;
  const sequenceDefinitions=(await pg.query("SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,s.seqtypid::regtype::text AS type,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname COLLATE \"C\"")).rows;
  const sequences=[];
  for(const definition of sequenceDefinitions){
   assert.match(definition.relname,/^[a-z_][a-z0-9_]{0,62}$/);
   const value=(await pg.query(`SELECT last_value::text,is_called FROM public."${definition.relname}"`)).rows[0];
   sequences.push({definition,value});
  }
  const value={tables,schemaSha256:sha({columns,constraints,indexes,views,grants}),schemaComponents:Object.fromEntries(Object.entries({columns,constraints,indexes,views,grants}).map(([name,rows])=>[name,{count:rows.length,sha256:sha(rows)}])),dataSha256:sha(tables),sequenceSha256:sha(sequences),sequenceCount:sequences.length,readOnly:true};
  if(workerFreshness){assert.deepEqual(freshness.map(t=>t.table),freshnessTables);value.workerFreshness={version:1,observedAtMicros:(await pg.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000000)::text AS value')).rows[0].value,tables:freshness};}
  return value;
 } finally {if(manageTransaction)await pg.query('ROLLBACK');}
}

// Same-cluster before/after preservation: catalog OIDs are deliberately retained.
// Only aggregate hashes/counts leave PostgreSQL, including for role credentials.
async function databaseSecurityFingerprint(pg){
 await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
  assert.equal((await pg.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'on');
  const userNamespace="n.nspname !~ '^pg_' AND n.nspname<>'information_schema'";
  const queries={
   schemas:`SELECT n.* FROM pg_namespace n WHERE ${userNamespace}`,
   classes:`SELECT c.oid,c.relname,c.relnamespace,c.reltype,c.reloftype,c.relowner,c.relam,c.reltablespace,c.relisshared,c.relpersistence,c.relkind,c.relnatts,c.relchecks,c.relhasrules,c.relhastriggers,c.relhassubclass,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,c.relrewrite,c.relacl,c.reloptions,c.relpartbound FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   attributes:`SELECT a.* FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   defaults:`SELECT a.* FROM pg_attrdef a JOIN pg_class c ON c.oid=a.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   functions:`SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${userNamespace}`,
   triggers:`SELECT t.* FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   constraints:`SELECT x.* FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace WHERE ${userNamespace}`,
   indexes:`SELECT i.* FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   rewrites:`SELECT r.* FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   policies:`SELECT p.* FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}`,
   types:`SELECT t.* FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${userNamespace}`,
   enums:`SELECT e.* FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${userNamespace}`,
   roles:'SELECT a.* FROM pg_authid a',roleMemberships:'SELECT m.* FROM pg_auth_members m',roleDatabaseSettings:'SELECT s.* FROM pg_db_role_setting s',
   defaultAcls:'SELECT a.* FROM pg_default_acl a',extensions:'SELECT e.* FROM pg_extension e',
   database:"SELECT d.oid,d.datname,d.datdba,d.encoding,d.datlocprovider,d.datistemplate,d.datallowconn,d.datconnlimit,d.dattablespace,d.datcollate,d.datctype,d.datlocale,d.daticurules,d.datcollversion,d.datacl FROM pg_database d WHERE d.datname=current_database()",
  };
  const components={};
  for(const [name,sql] of Object.entries(queries)){
   const row=(await pg.query(`SELECT count(*)::int AS count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text COLLATE "C")::text,'[]'),'UTF8')),'hex') AS sha256 FROM (${sql}) q`)).rows[0];
   components[name]={count:row.count,sha256:row.sha256};
  }
  return {sha256:createHash('sha256').update(JSON.stringify(components)).digest('hex'),components,readOnly:true,scope:'same-cluster user schema catalogs, all roles/memberships, database and role settings; physical statistics excluded'};
 } finally {await pg.query('ROLLBACK');}
}

/** Compare data, DDL, sequences and security without exposing row or credential contents. */
export async function nativeWebDatabaseState(pg,options={}) {
  assert(options&&Object.keys(options).every(k=>k==='workerFreshness'));
  assert(options.workerFreshness===undefined||typeof options.workerFreshness==='boolean');
  return { data: await databaseFingerprint(pg,true,options.workerFreshness===true), security: await databaseSecurityFingerprint(pg) };
}

/** Full equality by default; the explicit live-worker mode permits clock advance only. */
export function assertNativeWebDatabasePreserved(before,after){
 assert.equal(after.data.schemaSha256,before.data.schemaSha256);assert.equal(after.data.sequenceSha256,before.data.sequenceSha256);assert.equal(after.security.sha256,before.security.sha256);
 const left=before.data.workerFreshness,right=after.data.workerFreshness;
 if(!left&&!right){assert.equal(after.data.dataSha256,before.data.dataSha256);return true;}
 assert(left&&right&&left.version===1&&right.version===1);
 const observeA=micros(left.observedAtMicros),observeB=micros(right.observedAtMicros);assert(observeB>=observeA);
 for(const value of [left,right]){
  assert.deepEqual(value.tables.map(t=>t.table),freshnessTables);
  for(const table of value.tables){assert.equal(table.column,'checked_at');assert(table.rows.length<=10000);assert.equal(new Set(table.rows.map(r=>r.sha256)).size,table.rows.length);for(const row of table.rows){assert(digestPattern.test(row.sha256));assert(micros(row.checkedAtMicros)<=micros(value.observedAtMicros));}}
 }
 assert.deepEqual(after.data.tables.map(t=>t.table),before.data.tables.map(t=>t.table));
 for(let i=0;i<before.data.tables.length;i++){
  const a=before.data.tables[i],b=after.data.tables[i];assert.equal(a.count,b.count);
  if(!freshnessTables.includes(a.table)){assert.deepEqual(b,a);continue;}
  const old=left.tables.find(t=>t.table===a.table),current=right.tables.find(t=>t.table===a.table);
  assert.equal(String(old.rows.length),a.count);assert.equal(String(current.rows.length),b.count);
  const rows=new Map(old.rows.map(row=>[row.sha256,micros(row.checkedAtMicros)]));
  for(const row of current.rows){assert(rows.has(row.sha256));assert(micros(row.checkedAtMicros)>=rows.get(row.sha256));}
 }
 return true;
}
