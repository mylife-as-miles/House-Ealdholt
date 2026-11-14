import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtVillageSite, resolveVillageSiteEndpoint, resolveVillageSitePath, validateVillageSiteWorkplaceAnchors, validateVillageSiteRigidClearance, applyVillageSiteRigidClearance, type VillageSiteOptions } from './village-site';

const HASH = 'a'.repeat(64);
function fixture(): VillageSiteOptions {
  // Deliberately bent test paths: a resolver must preserve the measured corner.
  const anchors: any = {}, routes: any = {}, proofs: any[] = [];
  for (const [id, point] of Object.entries({ home: [0, 1, 0], well: [2, 1, 2], rest: [-2, 1, 0], other: [20, 1, 20], otherEnd: [22, 1, 20] })) {
    anchors[id] = { sourceActor: `source-${id}`, sourceGroundPoint: point, capsuleBottomPoint: [point[0], 1.02, point[2]], standingOnly: true };
  }
  for (const [id, from, to, points] of [['home-well', 'home', 'well', [[0, 1, 0], [0, 1, 2], [2, 1, 2]]], ['home-rest', 'home', 'rest', [[0, 1, 0], [-2, 1, 0]]],
    ['other-lane', 'other', 'otherEnd', [[20, 1, 20], [22, 1, 20]]]] as const) {
    const body = points.map(p => [p[0], 1.02, p[2]]), length = to === 'well' ? 4 : 2;
    routes[id] = { from, to, reversible: true, sourceGroundPolyline: points, capsuleBottomPolyline: body, lengthMetres: length, corridorRefs: [1, 2] };
    proofs.push({ from, to, sourceGroundPolyline: points, capsuleBottomPolyline: body, lengthMetres: length, corridor: [1, 2],
      partialPathAccepted: false, findPathStatus: 1073741824, allSourceSolidEnvelopesClear: true, groundWholeFootprintSupported: true,
      waterAndInteriorsExcluded: true, groundEdgeClearanceLowerBound: 2, slopeLipschitzUpperBound: .1, capsuleBottomLiftMetres: .02 });
  }
  return { profile: 'desktop', modelSha256: HASH,
    binding: { schema: 1, profile: 'desktop', sourceSha256: HASH, frame: 'source-root-local-metres', capsule: { height: 2.1, radius: 1.4 }, anchors, routes },
    certificate: { schema: 1, profile: 'desktop', sourceSha256: HASH, frame: 'source-root-local-metres', capsule: { height: 2.1, radius: 1.4 },
      qualified: true, sourceOriginalBuffersUnchanged: true, capsuleClearanceMargin: .005, groundBoundaryRoundingMaxMetres: 1e-8, routes: proofs },
    placeBindings: [{ placeId: 'house', anchorId: 'home', status: 'mapped-exterior' }, { placeId: 'water', anchorId: 'well', status: 'mapped-exterior' },
      { placeId: 'bench', anchorId: 'rest', status: 'mapped-exterior' }, { placeId: 'disconnected', anchorId: 'other', status: 'mapped-exterior' },
      { placeId: 'forge-inside', anchorId: null, status: 'unmapped' }],
    residentPlaceBindings: [{ residentId: 'resident-b', placeId: 'water', anchorId: 'rest', status: 'mapped-exterior' },
      { residentId: 'resident-c', placeId: 'water', anchorId: null, status: 'unmapped' }] };
}
test('source profile/hash/capsule and complete source certificate gate physical site binding', () => {
  assert.equal(createEaldholtVillageSite(fixture()).anchors.length, 5);
  for (const edit of [(o: any) => o.modelSha256 = 'b'.repeat(64), (o: any) => o.certificate.profile = 'quest',
    (o: any) => o.certificate.qualified = false, (o: any) => o.certificate.capsule.radius = .6,
    (o: any) => o.certificate.routes[0].partialPathAccepted = true, (o: any) => o.certificate.routes[0].waterAndInteriorsExcluded = false]) {
    const input = structuredClone(fixture()); edit(input); assert.throws(() => createEaldholtVillageSite(input));
  }
});
test('a measured 3.5 metre envelope requires matching certificate and rigid-source height, with a hard upper bound',()=>{
 const input=fixture() as any;input.binding.capsule.height=3.5;input.certificate.capsule.height=3.5;
 const site=createEaldholtVillageSite(input);assert.equal(site.capsule.height,3.5);
 const proof={schema:1,profile:site.profile,sourceSha256:site.sourceSha256,frame:site.frame,sourceOriginalBuffersUnchanged:true,originalTriangleFrameMaximumErrorMetres:0,
  proxy:{radiusMetres:site.capsule.radius,bottomAboveGroundMetres:.005,topAboveGroundMetres:3.5,rigidSourceMarginMetres:.005,terrainContactToleranceMetres:.02},
  anchors:site.anchors.map(a=>({anchorId:a.id,qualified:true})),routes:site.routes.map(r=>({routeId:r.id,qualified:true}))};
 assert.equal(applyVillageSiteRigidClearance(site,validateVillageSiteRigidClearance(site,proof)).routes.length,3);
 assert.throws(()=>validateVillageSiteRigidClearance(site,{...proof,proxy:{...proof.proxy,topAboveGroundMetres:2.1}}),/cylinder/);
 assert.throws(()=>validateVillageSiteRigidClearance(site,{...proof,sourceSha256:'b'.repeat(64)}),/identity/);
 const mismatch=structuredClone(input);mismatch.certificate.capsule.height=2.1;
 assert.throws(()=>createEaldholtVillageSite(mismatch),/clearance envelope/);
 for(const height of [3.500000001,Infinity,NaN,1.799999999]){const bad=structuredClone(input);bad.binding.capsule.height=height;bad.certificate.capsule.height=height;assert.throws(()=>createEaldholtVillageSite(bad),Number.isFinite(height)?/clearance envelope/:/finite plain data/);}
 assert.equal(createEaldholtVillageSite(fixture()).capsule.height,2.1,'new support must not rewrite old source profiles');
});
test('route lookup preserves measured corners and exact reversed graph legs', () => {
  const site = createEaldholtVillageSite(fixture()), path = resolveVillageSitePath(site, 'water', 'bench')!;
  assert.deepEqual(path.sourceGroundPolyline, [[2, 1, 2], [0, 1, 2], [0, 1, 0], [-2, 1, 0]]);
  assert.deepEqual(path.legs, [{ id: 'home-well', reverse: true }, { id: 'home-rest', reverse: false }]);
  assert.equal(path.lengthMetres, 6);
  assert.equal(resolveVillageSitePath(site, 'house', 'disconnected'), null);
  assert.equal(resolveVillageSitePath(site, 'house', 'forge-inside'), null);
  assert.equal(resolveVillageSitePath(site, 'unknown', 'water'), null);
});
test('fixed per-resident stands and explicit unmapped overrides never become invented offsets', () => {
  const site = createEaldholtVillageSite(fixture());
  assert.equal(resolveVillageSiteEndpoint(site, 'water', 'resident-a')!.id, 'well');
  assert.equal(resolveVillageSiteEndpoint(site, 'water', 'resident-b')!.id, 'rest');
  assert.equal(resolveVillageSiteEndpoint(site, 'water', 'resident-c'), null);
  assert.equal(resolveVillageSitePath(site, 'house', 'water', 'resident-b')!.lengthMetres, 2);
  assert.equal(resolveVillageSitePath(site, 'water', 'water', 'resident-b')!.lengthMetres, 0);
});
test('binding copies and freezes private evidence without invoking getters', () => {
  const input = fixture(), site = createEaldholtVillageSite(input);
  (input.binding as any).anchors.home.sourceGroundPoint[0] = 100;
  assert.equal(site.anchors[0].sourceGroundPoint[0], 0);
  assert.ok(Object.isFrozen(site)); assert.ok(Object.isFrozen(site.anchors[0].sourceGroundPoint));
  let calls = 0; const evil = fixture();
  Object.defineProperty((evil.binding as any).anchors.home, 'sourceGroundPoint', { get() { calls++; return [1, 1, 1]; }, enumerable: true });
  assert.throws(() => createEaldholtVillageSite(evil)); assert.equal(calls, 0);
});
test('tampered path, mismatched endpoints and duplicate place claims fail', () => {
  for (const edit of [(o: any) => o.binding.routes['home-well'].sourceGroundPolyline = [[0, 1, 0], [2, 1, 2]],
    (o: any) => o.binding.anchors.home.capsuleBottomPoint = [0, 2, 0],
    (o: any) => o.placeBindings.push(o.placeBindings[0]), (o: any) => o.placeBindings[0].anchorId = 'invented',
    (o: any) => o.residentPlaceBindings.push(o.residentPlaceBindings[0]),
    (o: any) => o.binding.anchors.extra = { ...o.binding.anchors.home, sourceActor: 'unverified-source' }]) {
    const input = structuredClone(fixture()); edit(input); assert.throws(() => createEaldholtVillageSite(input));
  }
});
test('source seam closure is explicit, measured and limited to twenty micrometres', () => {
  const input = fixture() as any;
  input.certificate.groundSeamPairClosureToleranceMetres = .00002;
  assert.throws(() => createEaldholtVillageSite(input), /source topology/);
  input.certificate.groundSeamTopology = { sourceBufferMutation: false, sourceCoordinateRoundingMetres: 1e-8,
    seamPairClosureToleranceMetres: .00002, maximumMeasuredEndpointDeltaMetres: .000011,
    originalUnmatchedEdgeCount: 10, pairedEdgeCount: 8, trueBoundaryEdgeCount: 2 };
  assert.equal(createEaldholtVillageSite(input).sourceProof!.maximumMeasuredSeamGapMetres, .000011);
  input.certificate.groundSeamTopology.maximumMeasuredEndpointDeltaMetres = .000021;
  assert.throws(() => createEaldholtVillageSite(input), /source topology/);
});
test('workplace orientation must match the exact certified arrival tangent', () => {
  const site = createEaldholtVillageSite(fixture());
  const row = { residentId: 'resident-a', placeId: 'house', anchorId: 'home', sourceGroundPoint: [0, 1, 0],
    yawRadians: Math.PI / 2, sourceRouteId: 'home-rest', reverse: true };
  const result = validateVillageSiteWorkplaceAnchors(site, [row]);
  assert.equal(result[0].yawRadians, Math.PI / 2); assert.ok(Object.isFrozen(result[0]));
  assert.throws(() => validateVillageSiteWorkplaceAnchors(site, [{ ...row, yawRadians: 0 }]), /arrival tangent/);
  assert.throws(() => validateVillageSiteWorkplaceAnchors(site, [{ ...row, reverse: false }]), /matching measured/);
  assert.throws(() => validateVillageSiteWorkplaceAnchors(site, [row, row]), /Duplicate/);
});
test('rigid-source floor-band proof covers exact loaded source IDs and retains failed clearances', () => {
  const site = createEaldholtVillageSite(fixture()), proof = { schema: 1, profile: site.profile, sourceSha256: site.sourceSha256,
    frame: site.frame, sourceOriginalBuffersUnchanged: true, originalTriangleFrameMaximumErrorMetres: 1e-12,
    proxy: { radiusMetres: 1.4, bottomAboveGroundMetres: .005, topAboveGroundMetres: 2.1, rigidSourceMarginMetres: .005, terrainContactToleranceMetres: .02 },
    anchors: site.anchors.map(a => ({ anchorId: a.id, qualified: a.id !== 'well' })), routes: site.routes.map(r => ({ routeId: r.id, qualified: false })) };
  assert.equal(validateVillageSiteRigidClearance(site, proof).anchors.find(a => a.anchorId === 'well')!.qualified, false);
  assert.throws(() => validateVillageSiteRigidClearance(site, { ...proof, anchors: proof.anchors.slice(1) }), /every site/);
  assert.throws(() => validateVillageSiteRigidClearance(site, { ...proof, sourceSha256: 'b'.repeat(64) }), /identity/);
  assert.throws(() => validateVillageSiteRigidClearance(site, { ...proof, proxy: { ...proof.proxy, bottomAboveGroundMetres: .16 } }), /cylinder/);
});
test('failed source legs and standing anchors cannot reappear through route lookup or fallback', () => {
  const site = createEaldholtVillageSite(fixture()), raw = { schema: 1, profile: site.profile, sourceSha256: site.sourceSha256,
    frame: site.frame, sourceOriginalBuffersUnchanged: true, originalTriangleFrameMaximumErrorMetres: 1e-12,
    proxy: { radiusMetres: 1.4, bottomAboveGroundMetres: .005, topAboveGroundMetres: 2.1, rigidSourceMarginMetres: .005, terrainContactToleranceMetres: .02 },
    anchors: site.anchors.map(a => ({ anchorId: a.id, qualified: a.id !== 'rest' })),
    routes: site.routes.map(r => ({ routeId: r.id, qualified: r.id !== 'home-well' })) };
  const proof = validateVillageSiteRigidClearance(site, raw), filtered = applyVillageSiteRigidClearance(site, proof);
  assert.equal(resolveVillageSitePath(filtered, 'house', 'water'), null, 'a failed route cannot become a straight shortcut');
  assert.equal(resolveVillageSiteEndpoint(filtered, 'bench'), null);
  assert.equal(resolveVillageSiteEndpoint(filtered, 'water', 'resident-b'), null, 'failed personal anchor cannot use primary fallback');
  assert.equal(filtered.placeBindings.find(row => row.placeId === 'bench')!.status, 'unmapped');
  assert.equal(filtered.residentPlaceBindings.find(row => row.residentId === 'resident-b')!.anchorId, null);
  assert.ok(Object.isFrozen(filtered)); assert.equal(site.routes.length, 3, 'original site remains unchanged');
  assert.throws(() => applyVillageSiteRigidClearance(site, { ...proof }), /validated against this exact site/);
  assert.throws(() => applyVillageSiteRigidClearance(createEaldholtVillageSite(fixture()), proof), /validated against this exact site/);
});

test('indexed lookup preserves explicit overrides and isolates each filtered source layout',()=>{
  const site=createEaldholtVillageSite(fixture());
  assert.equal(resolveVillageSiteEndpoint(site,'water','resident-b')?.id,'rest');
  assert.equal(resolveVillageSiteEndpoint(site,'water','resident-c'),null);
  assert.equal(resolveVillageSitePath(site,'water','bench')?.lengthMetres,6);
  const rows={schema:1,profile:site.profile,sourceSha256:site.sourceSha256,frame:site.frame,sourceOriginalBuffersUnchanged:true,originalTriangleFrameMaximumErrorMetres:0,
    proxy:{radiusMetres:site.capsule.radius,bottomAboveGroundMetres:.005,topAboveGroundMetres:site.capsule.height,rigidSourceMarginMetres:.005,terrainContactToleranceMetres:.02},
    anchors:site.anchors.map(a=>({anchorId:a.id,qualified:a.id!=='well'})),routes:site.routes.map(r=>({routeId:r.id,qualified:r.id!=='home-well'}))};
  const filtered=applyVillageSiteRigidClearance(site,validateVillageSiteRigidClearance(site,rows));
  assert.equal(resolveVillageSiteEndpoint(filtered,'water'),null);
  assert.equal(resolveVillageSitePath(filtered,'water','bench'),null);
  assert.equal(resolveVillageSiteEndpoint(site,'water')?.id,'well','filtering never mutates or reuses another source index');
  assert.equal(resolveVillageSiteEndpoint(filtered,'water','resident-b')?.id,'rest');
});
test('indexed certificate matching still rejects duplicate endpoint proofs',()=>{
  const input=fixture() as any;input.certificate.routes.push(structuredClone(input.certificate.routes[0]));
  assert.throws(()=>createEaldholtVillageSite(input),/matching clearance certificate/);
});
