import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeferredDetails } from "../apps/web/src/DeferredDetails.tsx";

test("closed details render their summary without mounting private readers", () => {
  const PrivateReader = () => { throw new Error("Private reader mounted before opening the panel"); };
  const html = renderToStaticMarkup(createElement(DeferredDetails, {
    summary: "원본 상세", children: createElement(PrivateReader),
  }));
  assert.match(html, /<summary>원본 상세<\/summary>/);
  assert.doesNotMatch(html, /open=/);
});
