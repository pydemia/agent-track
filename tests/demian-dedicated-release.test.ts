import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {dedicatedReleaseHash,verifyDedicatedRelease} from '../deploy/demian/dedicated-release.mjs';

const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(root:string,manifest:any,publish:()=>Promise<string>)=>Promise<void>){
 const root=await mkdtemp(path.join(tmpdir(),'demian-dedicated-release-'));
 try{
  const files=[];
  for(const file of ['apps/api/dist/dedicated-work-main.mjs','apps/worker/dist/main.mjs','nodejs/dist/index.mjs']){
   await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'export {};\n');
   files.push({path:file,bytes:11,sha256:hash('export {};\n')});
  }
  const manifest={version:1,kind:'demian-dedicated-work-release',nativeRevision:'a'.repeat(40),trackRevision:'b'.repeat(40),node:{version:process.version,sha256:await dedicatedReleaseHash(process.execPath)},files,links:[] as {path:string;target:string}[]};
  const publish=async()=>{const bytes=JSON.stringify(manifest);await writeFile(path.join(root,'service-release.json'),bytes);return hash(bytes);};
  await run(root,manifest,publish);
 }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true});}
}

test('operating manifest verifies closure independently of QA expiry and rejects changed bytes',async()=>fixture(async(root,_manifest,publish)=>{
 const pinned=await publish();const verified=await verifyDedicatedRelease(root,pinned);
 assert.equal(verified.apiEntry,path.join(root,'apps/api/dist/dedicated-work-main.mjs'));
 await writeFile(verified.workerEntry,'export 1;\n');await assert.rejects(()=>verifyDedicatedRelease(root,pinned));
}));
test('undeclared files and mismatched manifest/executable are rejected',async()=>fixture(async(root,manifest,publish)=>{
 const pinned=await publish();await assert.rejects(()=>verifyDedicatedRelease(root,'0'.repeat(64)));
 await assert.rejects(()=>verifyDedicatedRelease(root,pinned,{nodeVersion:'v0'}));
 await writeFile(path.join(root,'unexpected.mjs'),'');await assert.rejects(()=>verifyDedicatedRelease(root,pinned));
 await rm(path.join(root,'unexpected.mjs'));manifest.kind='qa-frozen';
 await assert.rejects(async()=>verifyDedicatedRelease(root,await publish()));
}));
test('only declared links to exact in-release targets are accepted',async()=>fixture(async(root,manifest,publish)=>{
 await mkdir(path.join(root,'node_modules'));await symlink(path.join(root,'nodejs'),path.join(root,'node_modules','core'),process.platform==='win32'?'junction':'dir');
 manifest.links.push({path:'node_modules/core',target:'nodejs'});const pinned=await publish();
 await verifyDedicatedRelease(root,pinned);
 await rm(path.join(root,'node_modules','core'));await symlink(path.join(root,'apps'),path.join(root,'node_modules','core'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>verifyDedicatedRelease(root,pinned));
}));
test('path traversal and duplicate entries never become launch inputs',async()=>fixture(async(root,manifest,publish)=>{
 manifest.files.push({...manifest.files[0],path:'../outside'});await assert.rejects(async()=>verifyDedicatedRelease(root,await publish()));
 manifest.files.pop();manifest.files.push(manifest.files[0]);await assert.rejects(async()=>verifyDedicatedRelease(root,await publish()));
}));
