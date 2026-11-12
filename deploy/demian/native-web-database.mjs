import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function databaseFingerprint(pg,manageTransaction=true){
 if(manageTransaction)await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
  assert.equal((await pg.query("SELECT current_setting('transaction_read_only') AS transaction_read_only")).rows[0].transaction_read_only,'on');
  const names=(await pg.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"")).rows.map(r=>r.tablename);
  assert(names.length>0&&names.length<=100);
  const tables=[];
  for(const table of names){
   assert.match(table,/^[a-z_][a-z0-9_]{0,62}$/);
   const row=(await pg.query(`SELECT count(*)::text AS count,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM public."${table}" t`)).rows[0];
   tables.push({table,count:row.count,sha256:row.sha256});
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
  return {tables,schemaSha256:sha({columns,constraints,indexes,views,grants}),schemaComponents:Object.fromEntries(Object.entries({columns,constraints,indexes,views,grants}).map(([name,rows])=>[name,{count:rows.length,sha256:sha(rows)}])),dataSha256:sha(tables),sequenceSha256:sha(sequences),sequenceCount:sequences.length,readOnly:true};
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
export async function nativeWebDatabaseState(pg) {
  return { data: await databaseFingerprint(pg), security: await databaseSecurityFingerprint(pg) };
}
