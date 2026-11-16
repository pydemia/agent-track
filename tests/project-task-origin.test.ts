import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceView } from "../packages/contracts/index.ts";
import { projectTaskOrigin } from "../apps/web/src/project-task-origin.ts";
import { ProjectsTaskLink } from "../apps/web/src/ProjectsTaskLink.tsx";

const projectId="11111111-1111-4111-8111-111111111111",taskId="22222222-2222-4222-8222-222222222222";
const task={sourceId:"projects",projectId,taskId};
const source:SourceView={id:"projects",kind:"projects",label:"Projects",device:"native",state:"connected",lastObservedAt:null,detail:"",capabilities:[],authorizedProjectIds:[projectId],uiBaseUrl:"https://projects.example.test/"};

test("Projects original link selects the exact native Project and Task with no mutation or credential parameters",()=>{
  const link=projectTaskOrigin([source],task);assert.equal(link.state,"ready");if(link.state!=="ready")throw Error("Missing link");
  const url=new URL(link.href);assert.equal(url.origin,"https://projects.example.test");assert.equal(url.pathname,"/");
  assert.deepEqual([...url.searchParams],[['project',projectId],['view','tasks'],['item',taskId],['kind','task']]);
  assert.equal(url.username,"");assert.equal(url.password,"");assert.equal(url.hash,"");
  assert.equal(source.uiBaseUrl,"https://projects.example.test/");
});

test("current Project withdrawal, disconnected sources and ambiguous IDs remove the original link",()=>{
  for(const sources of [[],[{...source,state:"disconnected" as const}],[{...source,state:"forbidden" as const}],[{...source,authorizedProjectIds:[]}],[{...source,kind:"demian" as const}],[source,{...source}]]){
    assert.equal(projectTaskOrigin(sources,task).state,"unavailable");
    const html=renderToStaticMarkup(createElement(ProjectsTaskLink,{sources,task}));assert(!html.includes('href='));assert(html.includes('현재 원본 업무 접근 미확인'));
  }
  for(const ref of [{...task,taskId:'../../settings'},{...task,projectId:projectId+'?actor=other'},{...task,sourceId:'other'}])assert.equal(projectTaskOrigin([source],ref).state,"unavailable");
});

test("unconfigured and unsafe UI destinations have an explicit unsupported fallback",()=>{
  for(const uiBaseUrl of [undefined,"","javascript:alert(1)","file:///tmp/private","https://user:secret@projects.example.test/","https://projects.example.test/?token=secret","https://projects.example.test/#secret"," https://projects.example.test/"]){
    const candidate={...source};delete candidate.uiBaseUrl;if(uiBaseUrl!==undefined)candidate.uiBaseUrl=uiBaseUrl;
    assert.equal(projectTaskOrigin([candidate],task).state,"unsupported");
    const html=renderToStaticMarkup(createElement(ProjectsTaskLink,{sources:[candidate],task}));assert(!html.includes('href='));assert(html.includes('원본 업무 링크 미지원'));assert(!html.includes('secret'));
  }
});

test("the existing original-app anchor is keyboard accessible and isolated from its opener",()=>{
  const html=renderToStaticMarkup(createElement(ProjectsTaskLink,{sources:[source],task}));
  assert(html.includes('원본 업무 열기'));assert(html.includes('<a '));assert(html.includes('target="_blank"'));assert(html.includes('rel="noreferrer noopener"'));
  assert(!html.includes('onclick='));assert(!html.includes('authorization'));
});
