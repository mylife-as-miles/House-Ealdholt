import assert from "node:assert/strict";
import test from "node:test";
import { applyVoiceLine, liveCaptions, stepCaptions, visibleCaptions, MAX_CAPTIONS } from "./match-subtitles";

const plea = { type: "line" as const, token: 1, clip: "sun_p1_a", text: "What, no! I don't want to die!", delay: 0, duration: 2.28, side: "b" as const };

test("a line shows with its speaker for as long as it is spoken, plus a moment to finish reading", () => {
  const [caption] = applyVoiceLine([], plea, 10);
  assert.equal(caption.speaker, "Solforiz Pawn");
  assert.equal(caption.side, "b");
  assert.equal(caption.text, plea.text);
  assert.equal(caption.showAt, 10);
  assert.ok(Math.abs(caption.hideAt - (10 + 2.28 + 0.6)) < 1e-9);
  assert.deepEqual(visibleCaptions([caption], 11).map((c) => c.token), [1]);
  assert.deepEqual(visibleCaptions([caption], 13), []);
  assert.deepEqual(liveCaptions([caption], 13), []);
  // A side speaks in the voices of the kingdom it fields, so the clip names the speaker; the mixer names the side.
  const korvenia = { ...plea, clip: "empire_n_moved_1", text: "Who threw me? Unhand me!" };
  const [named] = applyVoiceLine([], korvenia, 10, (side) => (side === "b" ? "Korvenia" : "Aethelgard"));
  assert.deepEqual([named.speaker, named.side], ["Korvenia Knight", "b"]);
  // A line that does not say its side is placed by the kingdom each side fields.
  const [placed] = applyVoiceLine([], { ...korvenia, side: undefined }, 10, (side) => (side === "w" ? "Korvenia" : "Kwind-09"));
  assert.deepEqual([placed.speaker, placed.side], ["Korvenia Knight", "w"]);
});

test("a delayed line waits for its voice, and a short one stays up long enough to read", () => {
  const [whisper] = applyVoiceLine([], { type: "line", token: 2, clip: "start_a", text: "It begins again.", delay: 2.2, duration: 1.1 }, 0);
  assert.equal(whisper.speaker, "The Fallen");
  assert.equal(whisper.side, null);
  assert.deepEqual(visibleCaptions([whisper], 1), []);
  assert.deepEqual(visibleCaptions([whisper], 2.3).length, 1);
  assert.ok(whisper.hideAt - whisper.showAt >= 1.7);
});

test("a blow that cuts a plea short takes its subtitle down soon after, but not before it can be read", () => {
  let captions = applyVoiceLine([], plea, 0);
  captions = applyVoiceLine(captions, { type: "cut", token: 1 }, 0.4);
  assert.equal(captions[0].hideAt, 1.6);
  captions = applyVoiceLine(applyVoiceLine([], plea, 0), { type: "cut", token: 1 }, 2);
  assert.equal(captions[0].hideAt, 2.5);
  assert.equal(applyVoiceLine(captions, { type: "cut", token: 99 }, 2)[0].hideAt, 2.5, "another line's cut changes nothing");
});

test("at most two lines at once, the newest last; silencing the voices clears them", () => {
  let captions = applyVoiceLine([], plea, 0);
  captions = applyVoiceLine(captions, { ...plea, token: 2, clip: "ivory_k_check_a", text: "They're coming for me.", side: "w" }, 0.1);
  captions = applyVoiceLine(captions, { ...plea, token: 3, clip: "ghost_b", text: "Who moves us?" }, 0.2);
  const shown = visibleCaptions(captions, 0.5);
  assert.equal(shown.length, MAX_CAPTIONS);
  assert.deepEqual(shown.map((c) => c.speaker), ["Aethelgard King", "The Fallen"]);
  assert.deepEqual(applyVoiceLine(captions, { type: "clear" }, 0.6), []);
});

test("a line spoken while the page was frozen still goes up, late, for its reading time, and only once", () => {
  const whisper = { type: "line" as const, token: 5, clip: "start_a", text: "It begins again.", delay: 2.2, duration: 1.1 };
  // On time: drawn while it is spoken, then gone for good.
  let step = stepCaptions(applyVoiceLine([], whisper, 0), 2.5);
  assert.deepEqual(step.visible.map((c) => c.token), [5]);
  assert.equal(step.visible[0], step.live[0], "what is drawn is what is kept, so the screen does not redraw every poll");
  assert.equal(stepCaptions(step.live, 2.6).visible[0], step.visible[0]);
  assert.deepEqual(stepCaptions(step.live, 9).live, [], "a line already shown is not shown again");
  // The page froze from 0.1 s until 7 s: the whole line went by unseen.
  step = stepCaptions(applyVoiceLine([], whisper, 0), 7);
  assert.deepEqual(step.visible.map((c) => c.text), ["It begins again."]);
  assert.equal(step.visible[0].showAt, 7);
  assert.ok(step.visible[0].hideAt - 7 >= 1.6 - 1e-9, "it stays up long enough to read");
  assert.deepEqual(stepCaptions(step.live, 8).visible.map((c) => c.token), [5]);
  assert.deepEqual(stepCaptions(step.live, 9).live, [], "and then it goes, once");
  // Too late to mean anything (the tab was hidden for a minute): dropped.
  assert.deepEqual(stepCaptions(applyVoiceLine([], whisper, 0), 60).live, []);
});
