import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BLINK_PROFILE, DEFAULT_FACE_CALIBRATION, FACE_EXPRESSIONS, FACE_JOINT_KEYS, FACE_JOINT_NAMES, FACE_MORPH_CHANNELS,
  INFLUENCE_GLANCE_INTERVAL, VISEME_IDS, VISEME_JAW_OPEN, babbleVisemesAt, blinkWeightAt, clampGaze, createFacePose, evaluateFacePose, faceCueAt,
  faceMorphIndex, faceSeed, gazeDriftAt, gazeFromHeadDirection, hashUnit, influenceGlanceAt, validateBlinkProfile,
  validateFaceCalibration, validateVisemeTrack, visemeTrackAt,
} from './face-performance';

const seed = faceSeed('ealdholt-village-smith');

test('joint names match the exported face rig and are unique', () => {
  assert.deepEqual([...FACE_JOINT_KEYS].sort(), Object.keys(FACE_JOINT_NAMES).sort());
  const names = Object.values(FACE_JOINT_NAMES);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^face_[a-z_]+$/);
});

test('morph channels are unique and every viseme except silence has a channel', () => {
  assert.equal(new Set(FACE_MORPH_CHANNELS).size, FACE_MORPH_CHANNELS.length);
  assert.ok(FACE_MORPH_CHANNELS.length <= 45, 'desktop close-up budget allows at most 45 morph targets');
  for (const v of VISEME_IDS) {
    if (v === 'sil') assert.equal(faceMorphIndex('viseme_sil'), -1);
    else assert.ok(faceMorphIndex('viseme_' + v) >= 0, v);
  }
  for (const preset of Object.values(FACE_EXPRESSIONS)) for (const ch of Object.keys(preset)) assert.ok(faceMorphIndex(ch) >= 0, ch);
});

test('hashing and seeds are deterministic and spread', () => {
  assert.equal(hashUnit(1, 2), hashUnit(1, 2));
  assert.notEqual(hashUnit(1, 2), hashUnit(1, 3));
  assert.equal(faceSeed('a'), faceSeed('a'));
  assert.notEqual(faceSeed('ealdholt-village-smith'), faceSeed('ealdholt-smithy-child'));
  let sum = 0;
  for (let i = 0; i < 2000; i++) { const u = hashUnit(seed, i); assert.ok(u >= 0 && u < 1); sum += u; }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.03);
});

test('blink profile validation guards overlap and duration', () => {
  assert.equal(validateBlinkProfile(DEFAULT_BLINK_PROFILE), null);
  assert.ok(validateBlinkProfile({ ...DEFAULT_BLINK_PROFILE, minIntervalSeconds: 0.3 }));
  assert.ok(validateBlinkProfile({ ...DEFAULT_BLINK_PROFILE, openSeconds: 0.8 }));
  assert.ok(validateBlinkProfile({ ...DEFAULT_BLINK_PROFILE, doubleBlinkChance: 0.9 }));
  assert.ok(validateBlinkProfile({ ...DEFAULT_BLINK_PROFILE, maxIntervalSeconds: Number.NaN }));
});

/** Blink onsets found by sampling closure at 100 Hz over a long window. */
function blinkOnsets(s: number, seconds: number): number[] {
  const out: number[] = [];
  let closed = false;
  for (let i = 0; i <= seconds * 100; i++) {
    const w = blinkWeightAt(s, i / 100);
    if (!closed && w > 0.5) { out.push(i / 100); closed = true; }
    if (closed && w < 0.1) closed = false;
  }
  return out;
}

test('blinks are deterministic, fully close, and keep realistic intervals', () => {
  const t = 123.456;
  assert.equal(blinkWeightAt(seed, t), blinkWeightAt(seed, t));
  const onsets = blinkOnsets(seed, 600);
  assert.ok(onsets.length > 90 && onsets.length < 260, `blinks in 10 minutes: ${onsets.length}`);
  let maxW = 0;
  for (let i = 0; i < 60000; i++) maxW = Math.max(maxW, blinkWeightAt(seed, i / 100));
  assert.ok(maxW > 0.99);
  const gaps = onsets.slice(1).map((o, i) => o - onsets[i]);
  // double blinks are about 0.3 s apart; ordinary gaps respect the profile's interval band
  assert.ok(gaps.every(g => g > 0.25 && g < DEFAULT_BLINK_PROFILE.maxIntervalSeconds + 0.5), JSON.stringify(gaps.slice(0, 20)));
  const ordinary = gaps.filter(g => g > 1);
  assert.ok(ordinary.every(g => g >= DEFAULT_BLINK_PROFILE.minIntervalSeconds - 0.5));
  assert.ok(gaps.some(g => g < 0.6), 'some double blinks occur');
});

test('a blink closes quickly and opens more slowly', () => {
  const onsets = blinkOnsets(seed, 30);
  const first = onsets[0];
  let start = first;
  while (blinkWeightAt(seed, start - 0.001) > 0) start -= 0.001;
  let peak = start;
  while (blinkWeightAt(seed, peak + 0.001) >= blinkWeightAt(seed, peak) && peak < start + 0.2) peak += 0.001;
  let end = peak;
  while (blinkWeightAt(seed, end + 0.001) > 0 && end < peak + 0.5) end += 0.001;
  const closing = peak - start, opening = end - peak;
  assert.ok(closing < opening, `closing ${closing} opening ${opening}`);
  assert.ok(end - start < 0.4);
});

test('blinks differ between residents', () => {
  const other = faceSeed('ealdholt-smithy-elder');
  assert.notDeepEqual(blinkOnsets(seed, 60).slice(0, 5), blinkOnsets(other, 60).slice(0, 5));
});

test('gaze clamps elliptically and converts head directions', () => {
  const c = DEFAULT_FACE_CALIBRATION;
  assert.equal(validateFaceCalibration(c), null);
  assert.deepEqual(clampGaze({ yaw: 0.1, pitch: 0.05 }, c), { yaw: 0.1, pitch: 0.05, clamped: false });
  const far = clampGaze({ yaw: 2, pitch: 0 }, c);
  assert.ok(far.clamped && Math.abs(far.yaw - c.eyeYawLimit) < 1e-9);
  const diag = clampGaze({ yaw: 1, pitch: 1 }, c);
  assert.ok(diag.clamped && (diag.yaw / c.eyeYawLimit) ** 2 + (diag.pitch / c.eyePitchDownLimit) ** 2 <= 1 + 1e-9);
  const up = clampGaze({ yaw: 0, pitch: -1 }, c);
  assert.ok(Math.abs(up.pitch + c.eyePitchUpLimit) < 1e-9);
  assert.deepEqual(clampGaze({ yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY }, c), { yaw: 0, pitch: 0, clamped: false });
  const right = gazeFromHeadDirection(-1, 0, 1);
  assert.ok(Math.abs(right.yaw - Math.PI / 4) < 1e-9 && Math.abs(right.pitch) < 1e-9);
  const down = gazeFromHeadDirection(0, -1, 1);
  assert.ok(Math.abs(down.pitch - Math.PI / 4) < 1e-9);
  assert.deepEqual(gazeFromHeadDirection(0, 0, 0), { yaw: 0, pitch: 0 });
  assert.ok(validateFaceCalibration({ ...c, lowerLidClosed: 0.3 }));
  assert.ok(validateFaceCalibration({ ...c, eyeYawLimit: 2 }));
});

test('gaze drift is small, piecewise constant and deterministic', () => {
  let changes = 0;
  let prev = gazeDriftAt(seed, 0);
  for (let i = 1; i <= 6000; i++) {
    const d = gazeDriftAt(seed, i / 100);
    assert.ok(Math.abs(d.yaw) <= 0.0181 && Math.abs(d.pitch) <= 0.0181);
    if (d.yaw !== prev.yaw) changes++;
    prev = d;
  }
  assert.ok(changes > 35 && changes < 160, `changes ${changes}`);
  assert.deepEqual(gazeDriftAt(seed, 12.34), gazeDriftAt(seed, 12.34));
});

test('influence glances are undirected and more frequent for persistent sensitivity', () => {
  const count = (s: 'occasional' | 'persistent') => {
    let n = 0, on = false;
    for (let i = 0; i < 6000 * 10; i++) {
      const g = influenceGlanceAt(seed, i / 10, s);
      assert.ok(g.amount >= 0 && g.amount <= 1 && Math.abs(g.gaze.yaw) <= 0.3 + 1e-9 && g.gaze.pitch <= 0);
      if (!on && g.amount > 0.5) { n++; on = true; }
      if (on && g.amount === 0) on = false;
    }
    return n;
  };
  const rare = count('occasional'), often = count('persistent');
  assert.ok(often > rare * 2, `${rare} vs ${often}`);
  assert.ok(INFLUENCE_GLANCE_INTERVAL.persistent < INFLUENCE_GLANCE_INTERVAL.occasional);
});

test('viseme tracks crossfade and validate', () => {
  const track = [
    { viseme: 'PP' as const, startSeconds: 0, endSeconds: 0.1 },
    { viseme: 'aa' as const, startSeconds: 0.1, endSeconds: 0.3 },
    { viseme: 'sil' as const, startSeconds: 0.3, endSeconds: 0.5 },
  ];
  assert.equal(validateVisemeTrack(track), null);
  assert.ok(validateVisemeTrack([{ viseme: 'aa', startSeconds: 0.2, endSeconds: 0.1 }]));
  assert.ok(validateVisemeTrack([{ viseme: 'zz' as never, startSeconds: 0, endSeconds: 1 }]));
  const mid = visemeTrackAt(track, 0.2);
  assert.deepEqual(mid.map(v => v.viseme), ['aa']);
  assert.ok(mid[0].weight > 0.99);
  const blend = visemeTrackAt(track, 0.1);
  assert.equal(blend.length, 2);
  assert.ok(blend.every(v => v.weight > 0.3 && v.weight < 0.7));
  assert.deepEqual(visemeTrackAt(track, 0.45), []);
});

test('composite pose fills a reused DTO without allocating new arrays', () => {
  const pose = createFacePose();
  const morphs = pose.morphs;
  const out = evaluateFacePose({ timeSeconds: 3.2, seed, gaze: { yaw: 0.2, pitch: 0.1 }, expression: { name: 'smile', intensity: 1 },
    visemes: [{ viseme: 'aa', weight: 1 }] }, DEFAULT_FACE_CALIBRATION, pose);
  assert.equal(out, pose);
  assert.equal(out.morphs, morphs);
  assert.ok(out.morphs[faceMorphIndex('mouthSmileLeft')] > 0.7);
  assert.equal(out.morphs[faceMorphIndex('viseme_aa')], 1);
  assert.ok(Math.abs(out.jawOpen - VISEME_JAW_OPEN.aa) < 1e-9);
  assert.ok(Math.abs(out.joints.jaw - VISEME_JAW_OPEN.aa * DEFAULT_FACE_CALIBRATION.jawOpen) < 1e-9);
  for (const v of out.morphs) assert.ok(v >= 0 && v <= 1);
});

test('blink drives lid joints and morphs; reduced motion stops animated blinks only', () => {
  const pose = createFacePose();
  evaluateFacePose({ timeSeconds: 0, seed, blinkOverride: 1, gaze: { yaw: 0, pitch: 0 }, reducedMotion: true }, DEFAULT_FACE_CALIBRATION, pose);
  assert.equal(pose.blink, 1);
  assert.equal(pose.morphs[faceMorphIndex('eyeBlinkLeft')], 1);
  assert.ok(Math.abs(pose.joints.lidUpper - DEFAULT_FACE_CALIBRATION.upperLidClosed) < 1e-9);
  assert.ok(Math.abs(pose.joints.lidLower - DEFAULT_FACE_CALIBRATION.lowerLidClosed) < 1e-9);
  for (let i = 0; i < 2000; i++) {
    evaluateFacePose({ timeSeconds: i / 20, seed, reducedMotion: true, gaze: { yaw: 0.1, pitch: 0 } }, DEFAULT_FACE_CALIBRATION, pose);
    assert.equal(pose.blink, 0);
    assert.equal(pose.eyeYaw, 0.1);
  }
});

test('lids follow downward gaze and expressions cannot hold eyes open during a blink', () => {
  const pose = createFacePose();
  evaluateFacePose({ timeSeconds: 0, seed, reducedMotion: true, gaze: { yaw: 0, pitch: 0.3 } }, DEFAULT_FACE_CALIBRATION, pose);
  assert.ok(pose.joints.lidUpper > 0.1 && pose.joints.eyePitch === 0.3);
  evaluateFacePose({ timeSeconds: 0, seed, reducedMotion: true, blinkOverride: 1, expression: { name: 'surprise', intensity: 1 } }, DEFAULT_FACE_CALIBRATION, pose);
  assert.equal(pose.morphs[faceMorphIndex('eyeBlinkLeft')], 1);
  assert.equal(pose.morphs[faceMorphIndex('eyeBlinkRight')], 1);
});

test('the same inputs always give the same pose', () => {
  const a = evaluateFacePose({ timeSeconds: 41.7, seed, sensitivity: 'persistent', gaze: { yaw: -0.2, pitch: 0 } });
  const b = evaluateFacePose({ timeSeconds: 41.7, seed, sensitivity: 'persistent', gaze: { yaw: -0.2, pitch: 0 } });
  assert.deepEqual({ ...a, morphs: [...a.morphs] }, { ...b, morphs: [...b.morphs] });
});

test('babble: deterministic phrases of syllables with pauses, consonant onsets and vowel nuclei', () => {
  const a = babbleVisemesAt(seed, 12.34), b = babbleVisemesAt(seed, 12.34);
  assert.deepEqual(a, b);
  const other = faceSeed('ealdholt-smithy-child');
  const window = (sd: number) => Array.from({ length: 150 }, (_, i) => babbleVisemesAt(sd, i / 30));
  assert.notDeepEqual(window(seed), window(other), 'residents babble differently');
  let silent = 0, vowelFrames = 0, longestSilence = 0, run = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 60 * 30; i++) {
    const v = babbleVisemesAt(seed, i / 30);
    for (const x of v) { assert.ok(x.weight >= 0 && x.weight <= 1); assert.notEqual(x.viseme, 'sil'); seen.add(x.viseme); }
    if (v.length === 0) { silent++; run++; longestSilence = Math.max(longestSilence, run); } else run = 0;
    if (v.some(x => ['aa', 'E', 'I', 'O', 'U'].includes(x.viseme) && x.weight > 0.4)) vowelFrames++;
  }
  assert.ok(silent > 60 && silent < 900, `silent frames in a minute: ${silent}`);
  assert.ok(longestSilence / 30 < 2.5, 'pauses stay short');
  assert.ok(vowelFrames > 600, `open-mouth frames: ${vowelFrames}`);
  assert.ok(seen.size >= 10, 'a range of visemes occurs');
  assert.deepEqual(babbleVisemesAt(seed, 5, 0), []);
  assert.deepEqual(babbleVisemesAt(seed, -1), []);
  assert.deepEqual(babbleVisemesAt(seed, Number.NaN), []);
  // constant-time lookup far into a session
  assert.ok(Array.isArray(babbleVisemesAt(seed, 3_600_000)));
});

test('talking drives the jaw joint and the viseme morphs when no cue track is given; explicit visemes win', () => {
  const pose = createFacePose();
  let maxJaw = 0, maxMorph = 0;
  const aa = faceMorphIndex('viseme_aa');
  for (let i = 0; i < 300; i++) {
    evaluateFacePose({ timeSeconds: i / 30, seed, talking: true, reducedMotion: true }, DEFAULT_FACE_CALIBRATION, pose);
    maxJaw = Math.max(maxJaw, pose.joints.jaw);
    let m = 0;
    for (let c = faceMorphIndex('viseme_PP'); c <= aa + 4; c++) m = Math.max(m, pose.morphs[c]);
    maxMorph = Math.max(maxMorph, m);
  }
  assert.ok(maxJaw > 0.4 * DEFAULT_FACE_CALIBRATION.jawOpen, `jaw opens while talking: ${maxJaw}`);
  assert.ok(maxMorph > 0.5);
  evaluateFacePose({ timeSeconds: 1, seed, talking: false }, DEFAULT_FACE_CALIBRATION, pose);
  assert.equal(pose.joints.jaw, 0);
  evaluateFacePose({ timeSeconds: 1, seed, talking: true, visemes: [{ viseme: 'O', weight: 1 }] }, DEFAULT_FACE_CALIBRATION, pose);
  assert.ok(Math.abs(pose.jawOpen - VISEME_JAW_OPEN.O) < 1e-9, 'an authored track replaces the babble');
  evaluateFacePose({ timeSeconds: 1, seed, talking: 0.5 }, DEFAULT_FACE_CALIBRATION, pose);
  assert.ok(pose.jawOpen <= 0.5 * VISEME_JAW_OPEN.aa + 1e-9, 'talking amount scales the opening');
});

test('face cues give clip-synchronised expressions with eased edges', () => {
  const cues = [{ expression: 'blow' as const, startSeconds: 2.85, endSeconds: 3.35 }];
  assert.equal(faceCueAt(cues, 1), null);
  const mid = faceCueAt(cues, 3.1);
  assert.ok(mid && mid.name === 'blow' && mid.intensity === 1);
  const edge = faceCueAt(cues, 2.9);
  assert.ok(edge && edge.intensity > 0 && edge.intensity < 1);
  assert.equal(faceCueAt(cues, Number.NaN), null);
  const pose = createFacePose();
  evaluateFacePose({ timeSeconds: 0, seed, reducedMotion: true, expression: faceCueAt(cues, 3.1) }, DEFAULT_FACE_CALIBRATION, pose);
  assert.ok(pose.morphs[faceMorphIndex('mouthPucker')] > 0.5);
});
