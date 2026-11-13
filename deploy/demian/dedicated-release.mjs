import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';

const digest=/^[a-f0-9]{64}$/;
const revision=/^[a-f0-9]{40}$/;
const required=['apps/api/dist/dedicated-work-main.mjs','apps/worker/dist/main.mjs','nodejs/dist/index.mjs'];
const same=(a,b)=>path.relative(path.resolve(a),path.resolve(b))==='';
const safe=name=>typeof name==='string'&&name.length<512&&!/[\\:\x00-\x1f]/.test(name)
 &&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part));
export async function dedicatedReleaseHash(file){
 const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');
}

/** Durable operating closure; independent of the unchanged expiring QA manifest. */
export async function verifyDedicatedRelease(directory,expectedManifestSha256,{executable=process.execPath,nodeVersion=process.version}={}){
 try{
  assert(path.isAbsolute(directory));assert(digest.test(expectedManifestSha256));
  const root=path.resolve(directory);
  for(let parent=root;;parent=path.dirname(parent)){
   const stat=await lstat(parent);assert(stat.isDirectory()&&!stat.isSymbolicLink());
   if(parent===path.dirname(parent))break;
  }
  assert(same(await realpath(root),root));
  const manifestFile=path.join(root,'service-release.json'),stat=await lstat(manifestFile);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=8*1024*1024);
  const bytes=await readFile(manifestFile);assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedManifestSha256);
  const value=JSON.parse(bytes.toString('utf8'));
  assert.equal(value.version,1);assert.equal(value.kind,'demian-dedicated-work-release');
  assert(revision.test(value.nativeRevision)&&revision.test(value.trackRevision));
  assert.equal(value.node.version,nodeVersion);assert(digest.test(value.node.sha256));
  assert.equal(await dedicatedReleaseHash(executable),value.node.sha256);
  assert(Array.isArray(value.files)&&value.files.length>0&&value.files.length<=40000);
  assert(Array.isArray(value.links)&&value.links.length<=1000);
  const files=new Map(),links=new Map();
  for(const item of value.files){
   assert(safe(item.path)&&item.path!=='service-release.json'&&digest.test(item.sha256));
   assert(Number.isSafeInteger(item.bytes)&&item.bytes>=0&&!files.has(item.path));files.set(item.path,item);
  }
  for(const item of value.links){
   assert(safe(item.path)&&safe(item.target)&&item.path!==item.target&&!links.has(item.path)&&!files.has(item.path));links.set(item.path,item.target);
  }
  assert(required.every(name=>files.has(name)));
  for(const name of [...files.keys(),...links.keys()]){
   const parts=name.split('/');parts.pop();
   while(parts.length){const parent=parts.join('/');assert(!files.has(parent)&&!links.has(parent));parts.pop();}
  }
  let count=0;const seenFiles=new Set(),seenLinks=new Set();
  async function walk(directory,prefix=''){
   for(const entry of await readdir(directory,{withFileTypes:true})){
    assert(++count<=80000);const name=prefix+entry.name,file=path.join(directory,entry.name),current=await lstat(file);
    if(current.isSymbolicLink()){
     assert(links.has(name));assert(same(await realpath(file),path.join(root,links.get(name))));seenLinks.add(name);
    }else if(current.isDirectory()){
     assert(safe(name));assert(same(await realpath(file),file));await walk(file,name+'/');
    }else{
     assert(current.isFile()&&current.nlink===1);
     if(name==='service-release.json')continue;
     const expected=files.get(name);assert(expected&&current.size===expected.bytes);
     assert.equal(await dedicatedReleaseHash(file),expected.sha256);seenFiles.add(name);
    }
   }
  }
  await walk(root);assert.equal(seenFiles.size,files.size);assert.equal(seenLinks.size,links.size);
  assert.equal(await dedicatedReleaseHash(manifestFile),expectedManifestSha256);
  return {root,manifestSha256:expectedManifestSha256,manifest:value,
   apiEntry:path.join(root,required[0]),workerEntry:path.join(root,required[1]),runtimeEntry:path.join(root,required[2])};
 }catch{throw new Error('Dedicated work release could not be verified');}
}
