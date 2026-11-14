// Evidence plan for one household member, driven by the real shared face contract (matched views across members).
//   main-game-vr/node_modules/.bin/tsx scripts/characters/review/member-evidence-plan.ts MEMBER GLB_DIR OUT_DIR BUILD/report.json
// MEMBER is smith, spinner, child or elder; GLB_DIR holds the published set. Writes OUT_DIR/evidence-plan.json for
// render-resident.mjs and OUT_DIR/face-contract-states.json. Evidence stays outside the repository.
import fs from 'node:fs';
import { DEFAULT_FACE_CALIBRATION as C0, FACE_MORPH_CHANNELS, createFacePose, evaluateFacePose, faceSeed, blinkWeightAt } from '../../../shared/legacy/aethelgard/characters/face-performance';
import { HOUSEHOLD_ART_SETS } from '../../../shared/legacy/aethelgard/characters/household-art-sets';
const [member, glbDir, outDir, reportPath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const motion = report.motion;
type Cfg = { set: string; id: string; height: number; work: string; workProps: object[]; walkProps: object[]; idleProps: object[]; extraClips: string[];
  signature: [string, Record<string, number>][]; workCam: object; workTimes: number[]; calib: typeof C0 };
const P = (node: string, bone?: string) => (bone ? { model: 'p', node, bone } : { model: 'p', node });
// work props follow household-art-sets.ts: the child's bellows lever is part of the animated workplace (props clip)
const cfgs: Record<string, Cfg> = {
  smith: { set: 'village-smith', id: 'ealdholt-village-smith', height: 1.75, work: 'work_hammer', workProps: [P('prop_hammer', 'hand_r'), P('prop_tongs', 'hand_l'), P('workplace')],
    walkProps: [], idleProps: [], extraClips: [], workCam: { az: -60, el: 10, dist: 2.7, fov: 32, target: [0, 1.0, 0.3] }, workTimes: [0, 0.2, 0.36, 0.46, 0.56, 0.6, 19 / 30, 0.7, 0.85, 49 / 30],
    signature: [['anvil squint', { eyeSquintLeft: 0.5, eyeSquintRight: 0.5, browDownLeft: 0.55, browDownRight: 0.55 }], ['rare broad smile', { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.5, cheekSquintRight: 0.5 }]],
    calib: { ...C0 } },
  spinner: { set: 'smithy-spinner', id: 'ealdholt-smithy-spinner', height: 1.72, work: 'work_spindle', workProps: [P('prop_spindle', 'hand_l'), P('prop_fibre_roll', 'hand_l'), P('workplace')],
    walkProps: [], idleProps: [], extraClips: [], workCam: { az: 30, el: 6, dist: 2.6, fov: 32, target: [0, 1.05, 0] }, workTimes: [0, 0.3, 0.55, 0.8, 1.2, 1.95, 2.75, 3.05, 3.35, 3.65],
    signature: [['appraising look', { browInnerUp: 0.55, eyeSquintLeft: 0.45, eyeSquintRight: 0.45, browOuterUpLeft: 0.35 }], ['amused half smile', { mouthSmileLeft: 0.6, cheekSquintLeft: 0.35, eyeSquintLeft: 0.15 }]],
    calib: { ...C0 } },
  child: { set: 'smithy-child', id: 'ealdholt-smithy-child', height: 1.385, work: 'work_bellows', workProps: [P('workplace')],
    walkProps: [], idleProps: [], extraClips: [], workCam: { az: -50, el: 10, dist: 3.1, fov: 34, target: [0.45, 0.65, 0.55] }, workTimes: [0, 0.2, 0.42, 0.55, 0.9, 1.25, 1.4, 1.82, 1.95, 2.4],
    signature: [['wide-eyed curiosity', { eyeWideLeft: 0.75, eyeWideRight: 0.75, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, browInnerUp: 0.3 }], ['pout when sent away', { mouthPucker: 0.7, browDownLeft: 0.5, browDownRight: 0.5, mouthFrownLeft: 0.3, mouthFrownRight: 0.3 }]],
    calib: { ...C0 } },
  elder: { set: 'smithy-elder', id: 'ealdholt-smithy-elder', height: 1.54, work: 'work_carving', workProps: [P('prop_knife', 'hand_r'), P('prop_spoon', 'hand_l'), P('workplace')],
    walkProps: [P('prop_stick', 'hand_l')], idleProps: [P('prop_stick', 'hand_l')], extraClips: ['sit', 'sit_down', 'stand_up'], workCam: { az: 35, el: 14, dist: 2.2, fov: 32, target: [0, 0.65, 0.2] },
    workTimes: [0, 0.2, 0.35, 0.6, 0.95, 1.55, 2.15, 2.6, 2.9, 3.4],
    signature: [['skeptical side glance', { mouthPressLeft: 0.6, mouthPressRight: 0.6, browDownRight: 0.35, browInnerUp: 0.15 }], ['warm crinkled smile', { mouthSmileLeft: 0.75, mouthSmileRight: 0.7, cheekSquintLeft: 0.55, cheekSquintRight: 0.55, eyeSquintLeft: 0.4, eyeSquintRight: 0.4 }]],
    calib: { ...C0, upperLidClosed: 0.51, lowerLidClosed: -0.14 } },
};
const cfg = cfgs[member];
const seed = faceSeed(cfg.id);
const deg = (r: number) => r * 180 / Math.PI;
type Input = Parameters<typeof evaluateFacePose>[0];
// the calibration each set publishes for Codex (household-art-sets.ts), so the renders show what the runtime contract will drive
const C = HOUSEHOLD_ART_SETS.find((a) => a.residentId === cfg.id)?.faceCalibration ?? cfg.calib;
function tierA(input: Input) {
  const p = evaluateFacePose(input, C, createFacePose()); const j = p.joints;
  const lu = [deg(j.lidUpper), 0, 0], ll = [deg(j.lidLower), 0, 0], eye = [deg(j.eyePitch), 0, deg(j.eyeYaw)];
  return { bones: { face_eye_l: eye, face_eye_r: eye, face_lid_upper_l: lu, face_lid_upper_r: lu, face_lid_lower_l: ll, face_lid_lower_r: ll, face_jaw: [deg(j.jaw), 0, 0] } };
}
function tierB(input: Input, extra: Record<string, number> = {}) {
  const p = evaluateFacePose(input, C, createFacePose()); const j = p.joints;
  const morphs: Record<string, number> = {}; FACE_MORPH_CHANNELS.forEach((c, i) => { if (p.morphs[i] > 0) morphs[c] = +p.morphs[i].toFixed(4); });
  for (const [k, v] of Object.entries(extra)) morphs[k] = Math.min(1, (morphs[k] || 0) + v);
  const lu = [deg(j.eyePitch * 0.55 * (1 - p.blink)), 0, 0], ll = [deg(j.eyePitch * 0.25 * (1 - p.blink)), 0, 0], eye = [deg(j.eyePitch), 0, deg(j.eyeYaw)];
  return { morphs, bones: { face_eye_l: eye, face_eye_r: eye, face_lid_upper_l: lu, face_lid_upper_r: lu, face_lid_lower_l: ll, face_lid_lower_r: ll } };
}
let onset = 0; for (let t = 0; t < 30; t += 0.001) if (blinkWeightAt(seed, t) > 0.01) { onset = t; break; }
const blinkTimes = [0, 0.03, 0.06, 0.08, 0.11, 0.15, 0.19, 0.24].map(d => +(onset - 0.005 + d).toFixed(3));
const k = cfg.height / 1.75;
const head = (az = 0) => ({ az, el: 2, dist: 0.55 * Math.max(0.85, k), target: 'head', targetOffset: [0, -0.035 * k, 0], fov: 26 });
const eyesCam = { az: 0, el: 0, dist: 0.3 * Math.max(0.85, k), target: 'head', targetOffset: [0, -0.022 * k, 0], fov: 22 };
const base = { light: 'studio', clip: 'idle', time: 0.5 };
const frame = (model: string, label: string, extra: object) => ({ model, label, ...base, props: model === 'p' ? [] : cfg.idleProps, ...extra });
const gazes: [string, number, number][] = [['forward', 0, 0], ['to own left', -0.4, 0], ['to own right', 0.4, 0], ['up', 0, -0.3], ['down', 0, 0.32]];
const visemes = ['sil', 'aa', 'O', 'E', 'PP', 'FF', 'TH', 'U'] as const;
const outputs: object[] = [];
const d = 3.4 * k + 0.4, ty = cfg.height * 0.5;
const turn = (m: string, l: string, light = 'studio') => [0, 35, 90, 180].map((az, i) => frame(m, `${l} ${['front', 'three-quarter', 'profile', 'back'][i]}`, { light, camera: { az, el: 3, dist: d, fov: 30, target: [0, ty, 0] } }));
outputs.push({ file: '01-turntable-lod0.png', size: [380, 560], cols: 4, frames: turn('a', 'LOD0') });
outputs.push({ file: '02-turntable-lod1-quest.png', size: [300, 440], cols: 4, frames: [...turn('b', 'LOD1'), ...turn('c', 'Quest')] });
outputs.push({ file: '03-head-closeup.png', size: [460, 520], cols: 4, frames: [0, 35, 90, 150].map(az => frame('a', `LOD0 head az ${az}`, { camera: head(az) })) });
const v = motion.walk.speedMetresPerSecond, W = motion.walk.seconds;
outputs.push({ file: '04-normal-distance-daylight.png', size: [520, 520], cols: 4, frames: [
  frame('a', 'LOD0 at 8 m', { light: 'village', camera: { az: 30, el: 6, dist: 8, fov: 30, target: [0, ty, 0] } }), frame('b', 'LOD1 at 8 m', { light: 'village', camera: { az: 30, el: 6, dist: 8, fov: 30, target: [0, ty, 0] } }),
  frame('b', 'LOD1 at 15 m', { light: 'village', camera: { az: 30, el: 5, dist: 15, fov: 30, target: [0, ty, 0] } }), frame('c', 'Quest at 8 m', { light: 'village', camera: { az: 30, el: 6, dist: 8, fov: 30, target: [0, ty, 0] } }),
  frame('a', 'LOD0 work, 6 m', { light: 'village', clip: cfg.work, time: cfg.workTimes[3], props: cfg.workProps, camera: { ...cfg.workCam, dist: 6 } }),
  frame('b', 'LOD1 work, 10 m', { light: 'village', clip: cfg.work, time: cfg.workTimes[5], props: cfg.workProps, camera: { ...cfg.workCam, dist: 10 } }),
  frame('a', 'LOD0 walk, 7 m', { light: 'village', clip: 'walk', time: W * 0.25, props: cfg.walkProps, camera: { az: 60, el: 6, dist: 7, fov: 30, target: [0, ty, 0] } }),
  frame('b', 'LOD1 talk, 9 m', { light: 'village', clip: 'talk', time: 2.0, camera: { az: 20, el: 6, dist: 9, fov: 30, target: [0, ty, 0] } })] });
outputs.push({ file: '05-blink-morph-lod0.png', size: [300, 200], cols: 8, frames: blinkTimes.map(t => frame('a', `B t=${(t - onset).toFixed(2)}`, { camera: eyesCam, ...tierB({ timeSeconds: t, seed }) })) });
outputs.push({ file: '06-blink-joints-lod1.png', size: [300, 200], cols: 8, frames: blinkTimes.map(t => frame('b', `A t=${(t - onset).toFixed(2)}`, { camera: eyesCam, ...tierA({ timeSeconds: t, seed }) })) });
// round 2: LOD1 and Quest carry the face morphs, so the shared adapters blink, speak and emote by morph there too
outputs.push({ file: '06b-blink-morph-lod1-quest.png', size: [300, 200], cols: 8, frames: [
  ...blinkTimes.map(t => frame('b', `LOD1 B t=${(t - onset).toFixed(2)}`, { camera: eyesCam, ...tierB({ timeSeconds: t, seed }) })),
  ...blinkTimes.map(t => frame('c', `Quest B t=${(t - onset).toFixed(2)}`, { camera: eyesCam, ...tierB({ timeSeconds: t, seed }) }))] });
outputs.push({ file: '07-gaze-joints.png', size: [300, 220], cols: 5, frames: [
  ...gazes.map(([l, yaw, pitch]) => frame('a', `LOD0 gaze ${l}`, { camera: eyesCam, ...tierB({ timeSeconds: 0, seed, reducedMotion: true, gaze: { yaw, pitch } }) })),
  ...gazes.map(([l, yaw, pitch]) => frame('c', `Quest gaze ${l}`, { camera: eyesCam, ...tierA({ timeSeconds: 0, seed, reducedMotion: true, gaze: { yaw, pitch } }) }))] });
outputs.push({ file: '08-visemes-morph-lod0.png', size: [300, 300], cols: 8, frames: visemes.map(vi => frame('a', `viseme ${vi}`, { camera: head(15), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, visemes: vi === 'sil' ? [] : [{ viseme: vi, weight: 1 }] }) })) });
outputs.push({ file: '09-jaw-joints-quest-lod1.png', size: [300, 300], cols: 6, frames: [
  ...(['sil', 'aa', 'O'] as const).map(vi => frame('b', `LOD1 joint ${vi}`, { camera: head(15), ...tierA({ timeSeconds: 0, seed, reducedMotion: true, visemes: vi === 'sil' ? [] : [{ viseme: vi, weight: 1 }] }) })),
  ...(['sil', 'aa', 'O'] as const).map(vi => frame('c', `Quest joint ${vi}`, { camera: head(15), ...tierA({ timeSeconds: 0, seed, reducedMotion: true, visemes: vi === 'sil' ? [] : [{ viseme: vi, weight: 1 }] }) }))] });
outputs.push({ file: '09b-visemes-morph-lod1-quest.png', size: [300, 300], cols: 8, frames: [
  ...(['sil', 'aa', 'O', 'E'] as const).map(vi => frame('b', `LOD1 viseme ${vi}`, { camera: head(15), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, visemes: vi === 'sil' ? [] : [{ viseme: vi, weight: 1 }] }) })),
  ...(['sil', 'aa', 'O', 'E'] as const).map(vi => frame('c', `Quest viseme ${vi}`, { camera: head(15), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, visemes: vi === 'sil' ? [] : [{ viseme: vi, weight: 1 }] }) }))] });
const exprs: [string, Input['expression'], Record<string, number>][] = [['neutral', null, {}], ['smile', { name: 'smile', intensity: 1 }, {}], ['concern', { name: 'concern', intensity: 1 }, {}],
  ...cfg.signature.map(([l, m]) => [l, null, m] as [string, Input['expression'], Record<string, number>]), ['surprise', { name: 'surprise', intensity: 0.8 }, {}]];
outputs.push({ file: '10b-expressions-lod1-quest.png', size: [300, 320], cols: 6, frames: [
  ...exprs.slice(0, 3).map(([l, e, m]) => frame('b', `LOD1 ${l}`, { camera: head(10), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, expression: e }, m) })),
  ...exprs.slice(0, 3).map(([l, e, m]) => frame('c', `Quest ${l}`, { camera: head(10), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, expression: e }, m) }))] });
outputs.push({ file: '17-likeness-0p8m-daylight.png', size: [420, 420], cols: 3, frames: [
  ...([['a', 'LOD0'], ['b', 'LOD1'], ['c', 'Quest']] as const).map(([mm, l]) => frame(mm, `${l} 0.8 m`, { light: 'village', camera: { az: 20, el: 4, dist: 0.8, target: 'head', targetOffset: [0, -0.02 * k, 0], fov: 30 } })),
  ...([['a', 'LOD0'], ['b', 'LOD1'], ['c', 'Quest']] as const).map(([mm, l]) => frame(mm, `${l} back 0.8 m`, { light: 'village', camera: { az: 200, el: 6, dist: 0.8, target: 'head', targetOffset: [0, -0.02 * k, 0], fov: 30 } }))] });
outputs.push({ file: '10-expressions-lod0.png', size: [300, 320], cols: 6, frames: exprs.map(([l, e, m]) => frame('a', l, { camera: head(10), ...tierB({ timeSeconds: 0, seed, reducedMotion: true, expression: e }, m) })) });
const walkTimes = Array.from({ length: 12 }, (_, i) => +(i * W / 12).toFixed(4));
outputs.push({ file: '11-walk-cycle-contacts.png', size: [300, 420], cols: 12, frames: walkTimes.map(t => frame('a', `walk ${t.toFixed(2)}s`, { clip: 'walk', time: t, root: [0, 0, v * t], grid: true, props: cfg.walkProps, markers: ['foot_l', 'foot_r'], contactHeight: 0.1, camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } })) });
const T = motion[cfg.work].seconds;
outputs.push({ file: '12-work-loop.png', size: [340, 380], cols: 5, frames: cfg.workTimes.map(t => frame('a', `${cfg.work} ${t.toFixed(2)}s`, { clip: cfg.work, time: Math.min(t, T - 1e-4), props: cfg.workProps, grid: true, markers: ['foot_l', 'foot_r'], camera: cfg.workCam })) });
outputs.push({ file: '13-work-closeup.png', size: [420, 340], cols: 3, frames: [cfg.workTimes[2], cfg.workTimes[5], cfg.workTimes[8]].map(t => frame('a', `work ${t}s`, { clip: cfg.work, time: t, props: cfg.workProps, camera: { ...cfg.workCam, dist: (cfg.workCam as { dist: number }).dist * 0.5 } })) });
const ws = motion.walk_start.seconds, wt = motion.walk_stop.seconds;
outputs.push({ file: '14-transitions.png', size: [260, 400], cols: 8, frames: [
  ...[0, 0.33, 0.66, 0.999].map(u => frame('a', `start ${(u * ws).toFixed(1)}s`, { clip: 'walk_start', time: u * ws, props: cfg.walkProps, grid: true, markers: ['foot_l', 'foot_r'], camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } })),
  ...[0, 0.33, 0.66, 0.999].map(u => frame('a', `stop ${(u * wt).toFixed(1)}s`, { clip: 'walk_stop', time: u * wt, props: cfg.walkProps, grid: true, markers: ['foot_l', 'foot_r'], camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } }))] });
const I = motion.idle.seconds;
outputs.push({ file: '15-loop-seams.png', size: [260, 400], cols: 6, frames: [
  frame('a', 'walk t=0', { clip: 'walk', time: 0, props: cfg.walkProps, camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } }), frame('a', `walk t=${W.toFixed(2)} (end)`, { clip: 'walk', time: W - 1e-4, props: cfg.walkProps, camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } }),
  frame('a', 'idle t=0', { clip: 'idle', time: 0, camera: { az: 20, el: 4, dist: d, fov: 30, target: [0, ty, 0] } }), frame('a', `idle t=${I.toFixed(1)} (end)`, { clip: 'idle', time: I - 1e-4, camera: { az: 20, el: 4, dist: d, fov: 30, target: [0, ty, 0] } }),
  frame('a', 'work t=0', { clip: cfg.work, time: 0, props: cfg.workProps, camera: cfg.workCam }), frame('a', `work t=${T.toFixed(1)} (end)`, { clip: cfg.work, time: T - 1e-4, props: cfg.workProps, camera: cfg.workCam })] });
if (cfg.extraClips.length) {
  const fr: object[] = [];
  for (const c of cfg.extraClips) { const S = motion[c].seconds; for (const u of [0, 0.25, 0.5, 0.75, 0.999]) fr.push(frame('a', `${c} ${(u * S).toFixed(1)}s`, { clip: c, time: u * S, props: [P('prop_stick', 'hand_l'), P('workplace')], grid: true, markers: ['foot_l', 'foot_r'], camera: { az: 50, el: 8, dist: d * 0.9, fov: 30, target: [0, 0.7, 0.2] } })); }
  outputs.push({ file: '16-sit.png', size: [300, 400], cols: 5, frames: fr });
}
const n = (s: number) => Math.round(s * 30);
outputs.push({ sequence: 'seq-walk', size: [480, 640], frames: Array.from({ length: n(W) + 1 }, (_, i) => frame('a', '', { clip: 'walk', time: Math.min(W - 1e-4, i / 30), root: [0, 0, v * i / 30], grid: true, props: cfg.walkProps, markers: ['foot_l', 'foot_r'], camera: { az: 90, el: 4, dist: d, fov: 30, target: [0, ty, 0] } })) });
outputs.push({ sequence: 'seq-work', size: [560, 560], frames: Array.from({ length: n(T) + 1 }, (_, i) => frame('a', '', { clip: cfg.work, time: Math.min(T - 1e-4, i / 30), props: cfg.workProps, camera: cfg.workCam })) });
outputs.push({ sequence: 'seq-blink-talk', size: [480, 480], frames: Array.from({ length: 90 }, (_, i) => frame('a', '', { clip: 'talk', time: i / 30, camera: head(20), ...tierB({ timeSeconds: onset - 1 + i / 30, seed, gaze: { yaw: 0.1 * Math.sin(i / 15), pitch: 0 }, visemes: i % 9 < 5 ? [{ viseme: (['aa', 'E', 'O', 'PP'] as const)[Math.floor(i / 9) % 4], weight: 0.8 }] : [] }) })) });
const measure = [{ id: 'walk', model: 'a', clip: 'walk', fps: 30, bones: ['foot_l', 'foot_r', 'toes_l', 'toes_r', 'hips', 'hand_l'], meshes: [] },
  { id: 'work', model: 'a', clip: cfg.work, fps: 30, bones: ['foot_l', 'foot_r', 'hand_r', 'hand_l', 'hips'], meshes: [] },
  { id: 'idle', model: 'a', clip: 'idle', fps: 30, bones: ['foot_l', 'foot_r', 'hips'], meshes: [] }];
const models = { a: `${cfg.set}-desktop-lod0.glb`, b: `${cfg.set}-desktop-lod1.glb`, c: `${cfg.set}-quest.glb`, p: `${cfg.set}-props.glb` };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outDir + '/evidence-plan.json', JSON.stringify({ modelDir: glbDir, models, outputs, measure }, null, 1));
fs.writeFileSync(outDir + '/face-contract-states.json', JSON.stringify({ member, residentId: cfg.id, seed, blinkOnset: onset, blinkTimes, calibration: C }, null, 1));
console.log('plan written', outputs.length, 'outputs; blink onset', onset.toFixed(3));
