import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../packages/storage/store.ts";
import type { SourceView } from "../packages/contracts/index.ts";

const projectId="11111111-1111-4111-8111-111111111111";
const source:SourceView={id:"projects",kind:"projects",label:"Projects",device:"native",state:"connected",lastObservedAt:null,detail:"",capabilities:[],authorizedProjectIds:[projectId],uiBaseUrl:"https://projects.example.test"};

test("authorized snapshot publishes registered browser destinations for Projects, Assistant and Demian",()=>{
  const store=new Store(":memory:");try{
    const result=store.snapshot("owner",[source]);
    assert.equal(result.sources[0]?.uiBaseUrl,"https://projects.example.test/");
    for(const kind of ["demian","assistant"] as const)assert.equal(store.snapshot("owner",[{...source,kind}]).sources[0]?.uiBaseUrl,"https://projects.example.test/");
    for(const kind of ["codex","desktop"] as const)assert.equal(store.snapshot("owner",[{...source,kind}]).sources[0]?.uiBaseUrl,undefined);
    assert.equal(source.uiBaseUrl,"https://projects.example.test");
  }finally{store.close();}
});

test("Assistant and Demian destinations stay absent after withdrawal or for credential URLs",()=>{
  const store=new Store(":memory:");try{
    for(const kind of ["assistant","demian"] as const){
      for(const item of [{...source,kind,state:"forbidden" as const},{...source,kind,state:"disconnected" as const},
        ...["https://user:secret@example.test/","https://example.test/?token=secret","https://example.test/#secret"].map(uiBaseUrl=>({...source,kind,uiBaseUrl}))]){
        const result=store.snapshot("owner",[item]);assert.equal(result.sources[0]?.uiBaseUrl,undefined);assert(!JSON.stringify(result).includes("secret"));
      }
    }
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
