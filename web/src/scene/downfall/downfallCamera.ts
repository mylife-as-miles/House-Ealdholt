/**
 * The shots of the downfall, as a pure function of the board: where the camera stands for each beat and how it
 * travels between them. No three.js: plain numbers in, a pose for any instant out, so a replay frames the ending
 * exactly as the match did and the tests can read every shot.
 *
 *  - realize: the King, a three-quarter view from the side he faces, as he learns it;
 *  - collapse (checkmate): up and back over his army as the realization spreads from him outward;
 *  - alone (checkmate): cut to the King alone, a little below his eyes, from where the fewest others stand in
 *    the frame and none before him, while his defiance breaks, his weapon falls and he sinks to a knee; framed from
 *    his chest up where those beside him crowd every wider frame, drawing back to all of him as he goes down;
 *  - hold: the long, slow composition on the kneeling King, past his shoulder to the victorious sovereign
 *    standing in the background where both can be seen from his side (never round on his back), otherwise from
 *    the front;
 *  - final: the pull back to the whole board, where the results are shown.
 */
import { KNEEL_FRONT, KNEEL_SINK, KNEEL_STEP, type DownfallPlan } from "./downfallPlan";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface CameraPose { readonly position: Vec3; readonly target: Vec3; readonly fov: number; }

export interface Spot { readonly x: number; readonly z: number; }

export interface DownfallCameraInput {
  readonly plan: DownfallPlan;
  /**
   * The beaten King: where he stands, the way he faces (unit), how tall he stands (world units), and how high the
   * top of the crest over his head is (it fades in his close shot; absent: a third over his height).
   */
  readonly king: Spot & { readonly facing: Spot; readonly height: number; readonly crest?: number };
  readonly victor: (Spot & { readonly height: number }) | null;
  /** The beaten army, its King included. */
  readonly army: readonly Spot[];
  /** Every other standing figure: what may stand in a shot. `kneels` when it will be down by the close shots. */
  readonly standing: readonly (Spot & { readonly height: number; readonly kneels: boolean })[];
  /** Where the camera is when the downfall begins, and the match's own lens. */
  readonly origin: CameraPose;
  readonly lens: number;
  readonly aspect: number;
  /** No shot stands farther than this from the board's centre (the hall's inner wall). */
  readonly reach?: number;
  /**
   * Whether nothing of the arena (a skull, a column, the sorcerer) stands between an eye and a point: a shot that
   * would see the King through stone, or stand inside it, is not taken. Absent: nothing stands in the way.
   */
  readonly sight?: (eye: Vec3, point: Vec3) => boolean;
}

export interface DownfallShots {
  readonly realize: CameraPose;
  readonly collapse: CameraPose | null;
  readonly alone: CameraPose | null;
  /** The hold's first and last pose: it creeps in between them. */
  readonly hold: readonly [CameraPose, CameraPose];
  /** True when the victorious sovereign stands in the hold's frame. */
  readonly victorInHold: boolean;
  readonly final: CameraPose;
}

export interface DownfallCamera {
  readonly shots: DownfallShots;
  at(time: number): CameraPose;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const easeInOut = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
const lerpV = (a: Vec3, b: Vec3, t: number) => v(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
const deg = Math.PI / 180;

/**
 * Where the shots aim on the King, as fractions of his height: standing, the middle of a frame that holds him from
 * his feet to the crest over his head; on one knee, the middle of his kneeling figure.
 */
const STAND_AIM = 0.6, KNEEL_AIM = 0.4;

/** What the close framing of the King alone costs against the wider one, in crowding: it is taken only when clearly cleaner. */
const ALONE_CLOSE_COST = 0.08;

/**
 * The hold's two-shot past his shoulder is taken only from where he is seen side-on or nearer: no farther round from
 * the way he faces than this (radians). Farther, the long hold would be on his back; it is taken from the front.
 */
const HOLD_PROFILE = 2.0;

/** Seconds into the kneel when he is down, and how far down he is at `time` (0 standing, 1 on his knee). */
export function kneelProgress(plan: DownfallPlan, time: number): number {
  const t = (time - plan.timeline.kneel - KNEEL_FRONT - KNEEL_STEP) / KNEEL_SINK;
  return ease(t);
}

function orbit(pivot: Spot, azimuth: number, distance: number, height: number): Vec3 {
  return v(pivot.x + Math.sin(azimuth) * distance, height, pivot.z + Math.cos(azimuth) * distance);
}

/** Interpolates two poses around a pivot on the floor, so a move between shots swings round rather than cutting through. */
function swing(pivot: Spot, a: CameraPose, b: CameraPose, t: number): CameraPose {
  const polar = (p: Vec3) => ({ azimuth: Math.atan2(p.x - pivot.x, p.z - pivot.z), distance: Math.hypot(p.x - pivot.x, p.z - pivot.z), y: p.y });
  const pa = polar(a.position), pb = polar(b.position);
  let turn = pb.azimuth - pa.azimuth;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  const position = orbit(pivot, pa.azimuth + turn * t, lerp(pa.distance, pb.distance, t), lerp(pa.y, pb.y, t));
  return { position, target: lerpV(a.target, b.target, t), fov: lerp(a.fov, b.fov, t) };
}

/**
 * Whether anything stands between the eye and a point: a figure blocks when it is close to the line of sight
 * on the floor and tall enough where the line passes it. Board-space, like the reactions' own sight test.
 */
export function sightBlocked(eye: Vec3, aim: Vec3, standing: DownfallCameraInput["standing"], radius = 0.3, ignore: Spot | null = null): boolean {
  const dx = aim.x - eye.x, dz = aim.z - eye.z, length = dx * dx + dz * dz;
  if (length < 1e-8) return false;
  for (const figure of standing) {
    if (ignore && Math.hypot(figure.x - ignore.x, figure.z - ignore.z) < 1e-3) continue;
    const u = ((figure.x - eye.x) * dx + (figure.z - eye.z) * dz) / length;
    if (u <= 0.02 || u >= 0.97) continue;
    const off = Math.hypot(figure.x - eye.x - dx * u, figure.z - eye.z - dz * u);
    if (off >= radius) continue;
    const top = figure.height * (figure.kneels ? 0.7 : 1);
    if (top > lerp(eye.y, aim.y, u) - 0.06) return true;
  }
  return false;
}

function crowded(eye: Vec3, standing: DownfallCameraInput["standing"], king: Spot): boolean {
  if (Math.hypot(eye.x - king.x, eye.z - king.z) < 0.5) return true;
  return standing.some(figure => Math.hypot(figure.x - eye.x, figure.z - eye.z) < 0.48 && eye.y < figure.height + 0.25);
}

/** Where a point falls in the frame: x and y from -1 to 1 across it, and whether it is in front of the eye. */
export function frameOf(pose: CameraPose, aspect: number, point: Vec3): { x: number; y: number; ahead: boolean } {
  let fx = pose.target.x - pose.position.x, fy = pose.target.y - pose.position.y, fz = pose.target.z - pose.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // right = forward x up, up' = right x forward
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const px = point.x - pose.position.x, py = point.y - pose.position.y, pz = point.z - pose.position.z;
  const depth = px * fx + py * fy + pz * fz;
  const tan = Math.tan(pose.fov * deg / 2);
  return { x: (px * rx + pz * rz) / (depth * tan * aspect), y: (px * ux + py * uy + pz * uz) / (depth * tan), ahead: depth > 0.05 };
}

/** A body in the frame as a box from its feet to its top, `half` wide either side: its extent and its depth. */
function boxOf(pose: CameraPose, aspect: number, at: Spot, bottom: number, top: number, half: number) {
  let fx = pose.target.x - pose.position.x, fy = pose.target.y - pose.position.y, fz = pose.target.z - pose.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const depth = (at.x - pose.position.x) * fx + ((bottom + top) / 2 - pose.position.y) * fy + (at.z - pose.position.z) * fz;
  const low = frameOf(pose, aspect, v(at.x, bottom, at.z)), high = frameOf(pose, aspect, v(at.x, top, at.z));
  const width = half / (Math.max(0.05, depth) * Math.tan(pose.fov * deg / 2) * aspect);
  const x = (low.x + high.x) / 2;
  return { x0: x - width, x1: x + width, y0: Math.min(low.y, high.y), y1: Math.max(low.y, high.y), depth, ahead: low.ahead && high.ahead };
}
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * How much other figures crowd a shot of the King, lower being cleaner: how much of the frame each fills (one
 * still standing counts double a kneeling one, one nearer the eye than the King counts double again) and, far more,
 * how much of the King any figure before him hides. `down` is how far down he is (his box is lower when kneeling).
 */
function crowding(pose: CameraPose, aspect: number, king: Spot & { readonly height: number }, top: number, others: DownfallCameraInput["standing"], ignore: readonly Spot[]): number {
  const subject = boxOf(pose, aspect, king, 0, top, 0.24 * king.height);
  const area = Math.max(1e-6, (subject.x1 - subject.x0) * (subject.y1 - subject.y0));
  let score = 0;
  for (const figure of others) {
    if (ignore.some(spot => Math.hypot(spot.x - figure.x, spot.z - figure.z) < 1e-3)) continue;
    const box = boxOf(pose, aspect, figure, 0, figure.height * (figure.kneels ? 0.62 : 0.97), 0.24 * figure.height);
    if (!box.ahead || box.depth < 0.1) continue;
    const inFrame = overlap(box.x0, box.x1, -1, 1) * overlap(box.y0, box.y1, -1, 1) / 4;
    const before = box.depth < subject.depth - 0.15;
    score += inFrame * (figure.kneels ? 1 : 2) * (before ? 2 : 1);
    if (before) score += 6 * overlap(box.x0, box.x1, subject.x0, subject.x1) * overlap(box.y0, box.y1, subject.y0, subject.y1) / area;
  }
  return score;
}

export function planDownfallCamera(input: DownfallCameraInput): DownfallCamera {
  const { plan, king, aspect } = input;
  const timeline = plan.timeline;
  const scale = king.height / 1.48;
  const facing = Math.atan2(king.facing.x, king.facing.z);
  const reach = input.reach ?? 10.5;
  const sees = (eye: Vec3, point: Vec3) => !input.sight || input.sight(eye, point);
  const chest = v(king.x, king.height * 0.55, king.z);
  const inHall = (eye: Vec3) => Math.hypot(eye.x, eye.z) <= reach && sees(eye, chest);
  const originAzimuth = Math.atan2(input.origin.position.x - king.x, input.origin.position.z - king.z);
  const nearOrigin = (azimuth: number) => Math.abs(Math.atan2(Math.sin(azimuth - originAzimuth), Math.cos(azimuth - originAzimuth)));
  const aim = (fraction: number) => v(king.x, king.height * fraction, king.z);
  const clear = (eye: Vec3, at: Vec3, kneeling: boolean) => {
    const standing = kneeling ? input.standing : input.standing.map(figure => ({ ...figure, kneels: false }));
    return inHall(eye) && !crowded(eye, input.standing, king) && !sightBlocked(eye, at, standing, 0.3, king);
  };
  /** The first clear azimuth of `turns` off the King's facing, preferring the one nearest `prefer`. */
  const choose = (turns: readonly number[], prefer: (azimuth: number) => number, make: (azimuth: number) => { eye: Vec3; at: Vec3 }, kneeling: boolean) => {
    const order = turns.map(turn => facing + turn).sort((a, b) => prefer(a) - prefer(b));
    for (const azimuth of order) { const shot = make(azimuth); if (clear(shot.eye, shot.at, kneeling)) return { azimuth, ...shot }; }
    const azimuth = order[0];
    return { azimuth, ...make(azimuth) };
  };

  // ---- realize: three-quarters from the side he faces, nearest the player's own side
  const realizeAim = aim(STAND_AIM);
  const realizeShot = choose([0.6, -0.6, 0.32, -0.32, 0.9, -0.9], nearOrigin,
    azimuth => ({ eye: orbit(king, azimuth, 3.9 * scale, 1.95 * scale), at: realizeAim }), false);
  const realize: CameraPose = { position: realizeShot.eye, target: realizeShot.at, fov: input.lens };
  const side = Math.sign(Math.sin(realizeShot.azimuth - facing)) || 1;

  // ---- collapse: up and back over the beaten army, from the side it faces
  let collapse: CameraPose | null = null;
  if (timeline.alone !== null) {
    const army = input.army.length ? input.army : [king];
    const cx = army.reduce((sum, spot) => sum + spot.x, 0) / army.length, cz = army.reduce((sum, spot) => sum + spot.z, 0) / army.length;
    const centre = { x: lerp(cx, king.x, 0.4), z: lerp(cz, king.z, 0.4) };
    const radius = Math.max(1.2, ...army.map(spot => Math.hypot(spot.x - centre.x, spot.z - centre.z)));
    // Near enough to see who kneels: the army fills the frame's width rather than sitting small in its middle.
    const distance = Math.min(7.6, Math.max(5.2, radius * 1.15 + 2.2));
    const elevation = 30 * deg;
    let azimuth = facing + side * 0.32;
    let eye = orbit(centre, azimuth, distance * Math.cos(elevation), distance * Math.sin(elevation) + 0.3);
    if (!inHall(eye)) {
      // Too wide for the hall: come in until it fits.
      const fit = Math.max(4, Math.min(distance, (reach - Math.hypot(centre.x, centre.z)) / Math.cos(elevation)));
      eye = orbit(centre, azimuth, fit * Math.cos(elevation), fit * Math.sin(elevation) + 0.3);
      if (!inHall(eye)) { azimuth = facing; eye = orbit(centre, azimuth, fit * Math.cos(elevation), fit * Math.sin(elevation) + 0.3); }
    }
    collapse = { position: eye, target: v(centre.x, 0.35, centre.z), fov: input.lens };
  }

  // ---- alone: a little below his eyes, on a longer lens, from where he is most alone in the frame
  let alone: CameraPose | null = null;
  const crest = input.king.crest ?? king.height * 1.33;
  // Standing, the frame holds him from his knees to the crest over his head (it fades while he breaks); kneeling,
  // the aim follows his head down until all of him is in it, his knee on the stone. Where those beside him crowd that
  // frame from every side (a Queen at each shoulder in a Scholar's mate), it is taken closer, from his chest up on a
  // longer lens, so the frame holds him alone; it draws back to all of him as he goes down.
  const aloneFov = Math.min(input.lens, 30), aloneTop = crest + 0.06 * king.height, aloneBottom = 0.22 * king.height;
  const aloneDistance = (aloneTop - aloneBottom) * 1.04 / (2 * Math.tan(aloneFov * deg / 2));
  const aloneAim = (aloneTop + aloneBottom) / 2;
  const closeFov = Math.min(input.lens, 24), closeBottom = 0.5 * king.height;
  const framings = [
    { fov: aloneFov, distance: aloneDistance, aim: aloneAim, cost: 0 },
    { fov: closeFov, distance: (aloneTop - closeBottom) * 1.04 / (2 * Math.tan(closeFov * deg / 2)), aim: (aloneTop + closeBottom) / 2, cost: ALONE_CLOSE_COST },
  ];
  let aloneFrame = framings[0];
  if (timeline.alone !== null) {
    const ignore = input.victor ? [king, input.victor] : [king];
    let best: { score: number; pose: CameraPose; frame: (typeof framings)[number] } | null = null;
    for (const frame of framings) for (const turn of [0, 0.2, -0.2, 0.42, -0.42, 0.7, -0.7, 1.0, -1.0, 1.3, -1.3]) {
      const azimuth = facing + turn * side;
      const eye = orbit(king, azimuth, frame.distance, 0.66 * king.height), at = v(king.x, frame.aim, king.z);
      if (!inHall(eye) || crowded(eye, input.standing, king)) continue;
      const pose = { position: eye, target: at, fov: frame.fov };
      // Crowding standing and kneeling (the army is down by then), with a little weight on staying near the first
      // shot, and the close framing only where it is clearly the cleaner.
      const turnFrom = Math.abs(Math.atan2(Math.sin(azimuth - realizeShot.azimuth), Math.cos(azimuth - realizeShot.azimuth)));
      const score = crowding(pose, aspect, king, crest, input.standing, ignore) + 0.04 * turnFrom + frame.cost;
      if (!best || score < best.score - 1e-9) best = { score, pose, frame };
    }
    alone = best?.pose ?? { position: orbit(king, facing + 0.42 * side, aloneDistance, 0.66 * king.height), target: v(king.x, aloneAim, king.z), fov: aloneFov };
    aloneFrame = best?.frame ?? framings[0];
  }

  // ---- hold: past his shoulder to the victor, or from the front when the victor cannot be framed
  const kneelAim = aim(KNEEL_AIM);
  let hold: [CameraPose, CameraPose] | null = null;
  let victorInHold = false;
  const victor = input.victor;
  if (victor) {
    const toward = Math.atan2(victor.x - king.x, victor.z - king.z);
    const victorHead = v(victor.x, victor.height * 0.9, victor.z);
    // On one knee his head is about 0.62 of his height, and the knee and the fallen weapon are at his feet.
    const kingHead = v(king.x, king.height * 0.62, king.z);
    const kingFeet = v(king.x, 0.04, king.z);
    // A medium two-shot from behind his shoulder: his raised knee is his right, so that side first (behind him and
    // to his right is +angle), where his hand rests and his weapon lies.
    // Toward his side rather than his back: his bowed head, his knee and his hand read in profile. Of the shots that
    // frame both, the one the fewest others crowd and none stands before him in.
    let chosen: { score: number; hold: [CameraPose, CameraPose] } | null = null;
    for (const s of [1, -1]) for (const angle of [1.0, 0.82, 1.18, 0.62, 1.35, 0.45]) {
      const azimuth = toward + Math.PI + s * angle;
      const eye = orbit(king, azimuth, 2.3 * king.height, 0.62 * king.height);
      if (!inHall(eye) || crowded(eye, input.standing, king)) continue;
      if (Math.abs(Math.atan2(Math.sin(azimuth - facing), Math.cos(azimuth - facing))) > HOLD_PROFILE) continue;
      const target = v(lerp(king.x, victor.x, 0.25), lerp(king.height * 0.37, victorHead.y, 0.3), lerp(king.z, victor.z, 0.25));
      let fits = false, fov = Math.min(input.lens, 32);
      for (; fov <= 40; fov += 2) {
        const pose = { position: eye, target, fov };
        const a = frameOf(pose, aspect, kingHead), b = frameOf(pose, aspect, victorHead), c = frameOf(pose, aspect, kingFeet);
        if (a.ahead && b.ahead && Math.abs(a.x) < 0.8 && Math.abs(b.x) < 0.85 && Math.abs(a.y) < 0.8 && Math.abs(b.y) < 0.85 && c.y > -0.92) { fits = true; break; }
      }
      if (!fits) continue;
      const standing = input.standing.filter(figure => Math.hypot(figure.x - victor.x, figure.z - victor.z) > 1e-3);
      if (sightBlocked(eye, kingHead, input.standing, 0.28, king) || sightBlocked(eye, victorHead, standing, 0.26, victor)) continue;
      const near = orbit(king, azimuth, 2.08 * king.height, 0.6 * king.height);
      const pose: CameraPose = { position: eye, target, fov };
      // Earlier candidates win ties: the order above is the preference.
      const score = crowding(pose, aspect, king, king.height * 0.66, input.standing, [king, victor]) + 0.01 * (s < 0 ? 4 : 0) + 0.002 * Math.abs(angle - 1);
      if (!chosen || score < chosen.score - 1e-9) chosen = { score, hold: [pose, { position: near, target, fov: fov - 1 }] };
    }
    if (chosen) { hold = chosen.hold; victorInHold = true; }
  }
  if (!hold) {
    const shot = choose([-0.5 * side, 0.5 * side, -0.25 * side, 0.25 * side, 0.8 * side], azimuth => Math.abs(azimuth - (facing - 0.5 * side)),
      azimuth => ({ eye: orbit(king, azimuth, 2.5 * scale, 0.92 * scale), at: kneelAim }), true);
    const near = orbit(king, shot.azimuth, 2.2 * scale, 0.88 * scale);
    hold = [{ position: shot.eye, target: kneelAim, fov: Math.min(input.lens, 30) }, { position: near, target: kneelAim, fov: Math.min(input.lens, 30) - 1 }];
  }

  // ---- final: up and back from the hold, the kneeling King below and the board beyond him, at the wide view's
  // height and distance (no swing round the board in the last second and a half); nearer where the hall's wall or
  // the arena stands in the way
  const holdEnd = hold[1].position;
  const away = Math.atan2(holdEnd.x - king.x, holdEnd.z - king.z);
  const wall = (eye: Vec3) => { const out = Math.hypot(eye.x, eye.z); return out > reach ? v(eye.x * reach / out, eye.y, eye.z * reach / out) : eye; };
  let finalEye = wall(orbit(king, away, 8, 6.8));
  for (let back = 7.5; back >= 3.5 && !inHall(finalEye); back -= 0.5) finalEye = wall(orbit(king, away, back, 6.8 * back / 8 + 1.2 * (1 - back / 8)));
  if (!inHall(finalEye)) finalEye = wall(orbit(king, originAzimuth, 8, 6.8));
  const final: CameraPose = { position: finalEye, target: v(king.x, 0.7, king.z), fov: input.lens };

  const shots: DownfallShots = { realize, collapse, alone, hold, victorInHold, final };
  const pivot = { x: king.x, z: king.z };
  const approach = Math.min(timeline.alone === null ? 1.3 : 1.6, timeline.spread);
  return {
    shots,
    at(time: number): CameraPose {
      if (time < approach) return swing(pivot, input.origin, realize, easeInOut(time / approach));
      if (time >= timeline.final) return swing(pivot, hold![1], final, easeInOut((time - timeline.final) / (timeline.end - timeline.final)));
      if (time >= timeline.hold) {
        const t = ease((time - timeline.hold) / (timeline.final - timeline.hold));
        return { position: lerpV(hold![0].position, hold![1].position, t), target: hold![0].target, fov: lerp(hold![0].fov, hold![1].fov, t) };
      }
      if (alone && timeline.alone !== null && time >= timeline.alone) {
        // On him: a slow push while he breaks, the aim following his head down as he kneels.
        const push = ease((time - timeline.alone) / (timeline.hold - timeline.alone));
        const down = kneelProgress(plan, time);
        // A close framing draws back to the whole of him as he goes down (lens and distance together).
        const distance = lerp(aloneFrame.distance, aloneDistance, down), fov = lerp(aloneFrame.fov, aloneFov, down);
        const eye = orbit(king, Math.atan2(alone.position.x - king.x, alone.position.z - king.z), distance * (1 - 0.08 * push), lerp(0.66, 0.5, down) * king.height);
        return { position: eye, target: v(king.x, lerp(aloneFrame.aim, king.height * KNEEL_AIM, down), king.z), fov };
      }
      if (collapse) {
        const rise = 1.4;
        if (time < timeline.spread) return realize;
        if (time < timeline.spread + rise) return swing(pivot, realize, collapse, easeInOut((time - timeline.spread) / rise));
        const drift = ease((time - timeline.spread - rise) / Math.max(0.1, (timeline.alone ?? timeline.hold) - timeline.spread - rise));
        const toward = v(lerp(collapse.position.x, collapse.target.x, 0.06 * drift), lerp(collapse.position.y, collapse.target.y, 0.04 * drift), lerp(collapse.position.z, collapse.target.z, 0.06 * drift));
        return { position: toward, target: collapse.target, fov: collapse.fov };
      }
      // The yield, in one shot: a slow push on the King while he lets his weapon fall and kneels.
      const push = ease((time - approach) / Math.max(0.1, timeline.hold - approach));
      const down = kneelProgress(plan, time);
      const azimuth = Math.atan2(realize.position.x - king.x, realize.position.z - king.z);
      return { position: orbit(king, azimuth, 3.9 * scale * (1 - 0.18 * push), lerp(1.95, 1.45, push) * scale), target: v(king.x, king.height * lerp(STAND_AIM, KNEEL_AIM, down), king.z), fov: input.lens };
    },
  };
}
