import assert from "node:assert/strict";
import test from "node:test";
import { combatComment, combatSequenceFromComment, selectCombatSequence, validCombatSequence, type CombatSequence } from "./combat-sequences";

test("Pawn circumstances and recent performances select three compatible techniques deterministically", () => {
  const recent: CombatSequence[] = [];
  for (let i = 0; i < 3; i++) {
    const context = { attacker: "p", defender: "p", from: "e4", to: "d5", enPassant: false, recent };
    const choice = selectCombatSequence(context)!;
    assert.deepEqual(choice, selectCombatSequence(context)); assert.ok(validCombatSequence(choice)); recent.push(choice);
  }
  assert.equal(new Set(recent.map(item => item.attack)).size, 3);
  assert.equal(selectCombatSequence({ attacker: "k", defender: "q", from: "d4", to: "e5", enPassant: false }), undefined);
});

test("PGN performance tokens round-trip known pairings and reject incompatible or unknown data", () => {
  const sequence = selectCombatSequence({ attacker: "p", defender: "p", from: "e5", to: "d6", enPassant: true })!;
  assert.deepEqual(combatSequenceFromComment("a note "+combatComment(sequence)), sequence);
  assert.equal(combatSequenceFromComment("[%cfcombat 2 crownfall-pawn-combat-1 attack.thrust defend.parry hit.light death.front]"), undefined);
  assert.equal(combatSequenceFromComment("[%cfcombat 1 crownfall-pawn-combat-1 attack.thrust defend.evade hit.heavy death.backward]"), undefined);
  assert.equal(combatSequenceFromComment("[%cfcombat 1 crownfall-pawn-combat-999 attack.thrust defend.parry hit.light death.front]"), undefined);
  assert.deepEqual(combatSequenceFromComment(combatComment(sequence).replaceAll(" ", "\n")), sequence);
  assert.equal(validCombatSequence({ ...sequence, attack: "execute.external.code" }), false);
});
