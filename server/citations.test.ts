import assert from "node:assert/strict";
import test from "node:test";
import { formatCitations, formatResponse } from "./citations.js";

const firstMarker = "\u30107:0\u2020source\u3011";
const secondMarker = "\u30107:2\u2020source\u3011";

test("converts adjacent raw citations into named web links", () => {
  const answer = "The Treasurer manages the state's cash.";
  const text = answer + firstMarker + secondMarker;
  assert.equal(formatCitations(text, [
    { type: "url_citation", start_index: answer.length, end_index: answer.length + firstMarker.length, title: "Treasurer's Office", url: "https://www.treasurer.ca.gov/" },
    { type: "url_citation", start_index: answer.length + firstMarker.length, end_index: text.length, title: "About", url: "https://www.treasurer.ca.gov/about.asp" },
  ]), `${answer} [Treasurer's Office](<https://www.treasurer.ca.gov/>) [About](<https://www.treasurer.ca.gov/about.asp>)`);
});

test("maps file citations by source index, not annotation order", () => {
  assert.equal(formatCitations(`Answer.${secondMarker}${firstMarker}`, [
    { type: "file_citation", file_id: "file-first", filename: "Overview.pdf", index: 0 },
    { type: "file_citation", file_id: "file-second", filename: "Bonds.pdf", index: 2 },
  ]), "Answer. [Bonds.pdf](</api/files/file-second/content>) [Overview.pdf](</api/files/file-first/content>)");
});

test("preserves cited prose when a URL annotation spans words", () => {
  assert.equal(formatCitations("Cash management.", [
    { type: "url_citation", start_index: 0, end_index: 15, title: "Source", url: "https://example.com" },
  ]), "Cash management [Source](<https://example.com/>).");
});

test("does not invent URLs for missing or unsafe sources", () => {
  assert.equal(formatCitations(`Answer.${firstMarker}`, [
    { type: "url_citation", start_index: 7, end_index: 7 + firstMarker.length, title: "Unsafe", url: "javascript:alert(1)" },
  ]), "Answer. [Source unavailable]");
});

test("escapes Markdown in source titles", () => {
  assert.equal(formatCitations("Answer.", [
    { type: "url_citation", title: "A [source]", url: "https://example.com/a(b)" },
  ]), "Answer. [A \\[source\\]](<https://example.com/a(b)>)");
});

test("formats each output text part with its own annotations", () => {
  assert.equal(formatResponse([
    { type: "reasoning" },
    { type: "message", content: [{ type: "output_text", text: "First." }, { type: "output_text", text: `Second.${secondMarker}`, annotations: [{ type: "file_citation", file_id: "file-second", filename: "Bonds.pdf", index: 2 }] }] },
  ], "fallback"), "First.\n\nSecond. [Bonds.pdf](</api/files/file-second/content>)");
  assert.equal(formatResponse([], `Fallback.${firstMarker}`), "Fallback. [Source unavailable]");
});