import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ARENA_SIMPLIFY, simplifiable, simplifyArenaMeshes } from "./arena-simplify";

/** A dense grid in the XZ plane, `bump` metres of relief, at `x` metres from the board's centre. */
function grid(name: string, x: number, bump: number) {
  const geometry = new THREE.PlaneGeometry(10, 10, 120, 120).rotateX(-Math.PI / 2);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, bump * Math.sin(p.getX(i) * 1.7) * Math.cos(p.getZ(i) * 1.3));
  const mesh = new THREE.Mesh(geometry);
  mesh.name = name; mesh.position.set(x, 0, 0);
  return mesh;
}

test("lava, skinned, morphing and light meshes are left alone", () => {
  const lava = grid("CFCL_Terrain_AbyssLava_Mesh_2", 30, 0);
  assert.equal(simplifiable(lava, ARENA_SIMPLIFY.medium), false);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 10, 10));
  assert.equal(simplifiable(light, ARENA_SIMPLIFY.medium), false);
  const skinned = new THREE.SkinnedMesh(grid("Rig", 0, 0).geometry);
  assert.equal(simplifiable(skinned, ARENA_SIMPLIFY.medium), false);
  assert.equal(simplifiable(grid("CFCL_Hero_Hand", 30, 0.2), ARENA_SIMPLIFY.medium), true);
});

test("a far, flat mesh is cut to the tier's share; its open edge stays", async () => {
  const root = new THREE.Group(), mesh = grid("CFCL_Far_Flat", 80, 0);
  root.add(mesh);
  const before = mesh.geometry.index!.count / 3;
  const result = await simplifyArenaMeshes(root, [mesh], ARENA_SIMPLIFY.medium);
  assert.equal(result.before, before);
  assert.ok(result.after <= before * 0.31, `kept ${result.after} of ${before}`);
  assert.ok(result.after > 0);
});

test("a near, bumpy mesh keeps more of its triangles than a far one: the error budget is in pixels", async () => {
  const root = new THREE.Group(), near = grid("CFCL_Near", 6, 0.4), far = grid("CFCL_Far", 120, 0.4);
  root.add(near, far);
  const n = await simplifyArenaMeshes(root, [near], ARENA_SIMPLIFY.medium);
  const f = await simplifyArenaMeshes(root, [far], ARENA_SIMPLIFY.medium);
  assert.ok(n.after > f.after, `near kept ${n.after}, far kept ${f.after}`);
});
