import assert from "node:assert/strict";
import { test } from "node:test";
import { ARMY_SKINS } from "../../web/src/assets/generated";
import { ARMY_KINGDOMS, matchArmies, matchOptions, sideName, type MatchConfig } from "./match";
import { MATCH_ARMY_CHOICES, MATCH_RIVAL_CHOICES } from "./setup";

test("Classic uses the computer; Local Duel permits both human sides", () => {
  const config: MatchConfig = { mode: "classic", setting: "scene-02", difficulty: "hard", playerColor: "b", clockMinutes: 5 };
  assert.deepEqual(matchOptions(config), { mode: "ai", difficulty: "hard", playerColor: "b", clockMinutes: 5 });
  assert.equal(matchOptions({ ...config, mode: "local-duel" }).mode, "hotseat");
});

test("Classic: you always lead Aethelgard, on whichever side you chose; the computer fields the rival", () => {
  const base: MatchConfig = { mode: "classic", setting: "scene-01", difficulty: "medium", playerColor: "w", clockMinutes: null };
  assert.deepEqual(matchArmies(base), { w: "ivory", b: "sun" }, "older configs: Aethelgard against Solforiz");
  assert.deepEqual(matchArmies({ ...base, armies: { w: "ivory", b: "empire" } }), { w: "ivory", b: "empire" });
  assert.deepEqual(matchArmies({ ...base, playerColor: "b", armies: { w: "empire", b: "ivory" } }), { w: "empire", b: "ivory" });
  assert.deepEqual(matchArmies({ ...base, armies: { w: "sun", b: "ivory" } }), { w: "ivory", b: "sun" }, "the player cannot be anyone but Aethelgard");
  assert.equal(sideName({ ...base, playerColor: "b", armies: { w: "empire", b: "ivory" } }, "w"), "Korvenia");
});

test("a duel fields two different kingdoms; a mirror or a missing pick falls back to Aethelgard against Solforiz", () => {
  const duel: MatchConfig = { mode: "local-duel", setting: "scene-02", difficulty: "medium", playerColor: "w", clockMinutes: 5 };
  assert.deepEqual(matchArmies({ ...duel, armies: { w: "empire", b: "sun" } }), { w: "empire", b: "sun" });
  assert.deepEqual(matchArmies({ ...duel, armies: { w: "sun", b: "sun" } }), { w: "ivory", b: "sun" });
  assert.deepEqual(matchArmies(duel), { w: "ivory", b: "sun" });
  assert.equal(sideName({ ...duel, armies: { w: "empire", b: "ivory" } }, "b"), "Aethelgard");
});

test("each army is named after its kingdom, everywhere it is offered", () => {
  for (const [id, name] of Object.entries(ARMY_KINGDOMS)) assert.equal(ARMY_SKINS[id as keyof typeof ARMY_SKINS].label, name);
  assert.deepEqual(MATCH_ARMY_CHOICES.map((c) => c.label), ["Aethelgard", "Solforiz", "Korvenia", "Kwind-09"]);
  assert.deepEqual(MATCH_RIVAL_CHOICES.map((c) => c.label), ["Solforiz", "Korvenia", "Kwind-09"]);
});

test("Kwind-09 is a whole army served with the game: six rigged figures, their clips, stills and arms", () => {
  const skin = ARMY_SKINS.kwind;
  assert.equal(skin.arsenal, "kwind");
  for (const kind of ["k", "q", "b", "n", "r", "p"] as const) {
    const set = skin.animated[kind]!;
    for (const clip of [set.rigged, set.idle, set.attack, set.death, set.walk]) assert.match(clip!, new RegExp(`^/models/kwind09/${kind}-`));
    assert.equal(skin.still[kind], `/models/kwind09/${kind}-still.glb`);
  }
  assert.equal(skin.animated.n!.run, "/models/kwind09/n-run.glb", "the courier alone carries a run, for the leap");
  const base: MatchConfig = { mode: "classic", setting: "scene-01", difficulty: "medium", playerColor: "w", clockMinutes: null };
  assert.deepEqual(matchArmies({ ...base, armies: { w: "ivory", b: "kwind" } }), { w: "ivory", b: "kwind" });
  assert.equal(sideName({ ...base, mode: "local-duel", armies: { w: "kwind", b: "empire" } }, "w"), "Kwind-09");
});
