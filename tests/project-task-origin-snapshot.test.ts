import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../packages/storage/store.ts";
import type { SourceView } from "../packages/contracts/index.ts";

const projectId="11111111-1111-4111-8111-111111111111";
const source:SourceView={id:"projects",kind:"projects",label:"Projects",device:"native",state:"connected",lastObservedAt:null,detail:"",capabilities:[],authorizedProjectIds:[projectId],uiBaseUrl:"https://projects.example.test"};

test("authorized snapshot publishes only the registered Projects browser destination",()=>{
  const store=new Store(":memory:");try{
    const result=store.snapshot("owner",[source]);
    assert.equal(result.sources[0]?.uiBaseUrl,"https://projects.example.test/");
    assert.equal(store.snapshot("owner",[{...source,kind:"demian"}]).sources[0]?.uiBaseUrl,undefined);
    assert.equal(source.uiBaseUrl,"https://projects.example.test");
  }finally{store.close();}
});

test("withdrawn Projects scopes and credential-bearing URLs cannot publish a browser destination",()=>{
  const store=new Store(":memory:");try{
    for(const item of [{...source,state:"forbidden" as const},{...source,state:"disconnected" as const},{...source,authorizedProjectIds:[]},
      ...["https://user:secret@projects.example.test/","https://projects.example.test/?token=secret","https://projects.example.test/#secret","file:///private"].map(uiBaseUrl=>({...source,uiBaseUrl}))]){
      const result=store.snapshot("owner",[item]);assert.equal(result.sources[0]?.uiBaseUrl,undefined);assert(!JSON.stringify(result).includes('secret'));
    }
  }finally{store.close();}
});
