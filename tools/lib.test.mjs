import { test } from "node:test";
import assert from "node:assert/strict";
import { matcher, parseSince, stripHtml } from "./lib.mjs";

const config = {
  watch: {
    names: ["Acme", "acme.dev"],
    phrases: ["quick capture"],
    all_of: [["sync", "offline"], ["notes", "notebook"]],
  },
};
const m = matcher(config);

test("names and phrases match anywhere, case-insensitively, at word boundaries", () => {
  assert.deepEqual(m("Switched to ACME last week"), ["Acme"]);
  assert.deepEqual(m("see acme.dev/pricing"), ["Acme", "acme.dev"]);
  assert.deepEqual(m("Acmeville is a town"), []);
  assert.deepEqual(m("the subacme thing"), []);
});

test("whitespace in a term matches any whitespace", () => {
  assert.deepEqual(m("I love Quick\n  Capture"), ["quick capture"]);
  assert.deepEqual(m("quickcapture"), []);
});

test("all_of needs every group", () => {
  assert.deepEqual(m("offline sync is broken"), []);
  assert.deepEqual(m("my notes"), []);
  assert.deepEqual(m("Offline notes app?"), ["offline", "notes"]);
  assert.deepEqual(m("sync my offline notebook"), ["sync", "offline", "notebook"]);
});

test("terms are regex-escaped", () => {
  const mm = matcher({ watch: { names: ["c++", "a.b"] } });
  assert.deepEqual(mm("I write c++ daily"), ["c++"]);
  assert.deepEqual(mm("axb"), []);
});

test("empty config matches nothing", () => {
  assert.deepEqual(matcher({})("anything at all"), []);
});

test("parseSince: relative windows", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  assert.equal(parseSince("24h", now).toISOString(), "2026-10-04T12:00:00.000Z");
  assert.equal(parseSince("7d", now).toISOString(), "2026-09-28T12:00:00.000Z");
  assert.equal(parseSince("30m", now).toISOString(), "2026-10-05T11:30:00.000Z");
});

test("parseSince: ISO times, offset-less read as UTC", () => {
  assert.equal(parseSince("2026-10-01T08:15:00Z").toISOString(), "2026-10-01T08:15:00.000Z");
  assert.equal(parseSince("2026-10-01T08:15:00-07:00").toISOString(), "2026-10-01T15:15:00.000Z");
  assert.equal(parseSince("2026-10-01T08:15:00").toISOString(), "2026-10-01T08:15:00.000Z");
  assert.equal(parseSince("2026-10-01").toISOString(), "2026-10-01T00:00:00.000Z");
});

test("parseSince: rejects junk", () => {
  for (const bad of ["", "yesterday", "24", "5y", "2026-13-45T00:00:00Z"]) assert.throws(() => parseSince(bad));
});

test("stripHtml decodes HN markup", () => {
  assert.equal(stripHtml("a &#x2F; b<p>c &amp; <i>d</i>"), "a / b\n\nc & d");
});
