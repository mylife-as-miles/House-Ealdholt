import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLOCK_MAX, FLOCK_SEED, FLOCK_SIZE, GLIDE_PHASE, GUARDED_VIEWS, KEEP_OUT, LIFT_RELEASE, OPENING_OVER, PLAY_FOV, STILL_AT,
  YOUNG_LOW_BANK, buildFlight, coversBoard, flightSample, hiddenFrom, lowestFlight, nearHeight, obstacleHeight, planFlock,
  wyvernBody, wyvernReach, youngBeatMargin,
  type Flight, type FlightSample, type Vec3,
} from "./arena-wyverns-flight";

const flock = planFlock(FLOCK_SEED).map(buildFlight);
/** The young wyverns fly higher until the opening is surely over; most checks start once they are down. */
const DOWN = OPENING_OVER[1];

/**
 * Every sample of a flight over one loop, `rate` a second from `from`, with the time it was taken at. `liftStart` is
 * when the opening's lift begins to come off (Flight.sample): by default as though never told the opening was over.
 */
function* fly(flight: Flight, rate: number, from: number = DOWN, liftStart?: number): Generator<[number, FlightSample]> {
  const steps = Math.ceil(flight.period * rate);
  for (let i = 0; i <= steps; i++) {
    const time = from + i / rate;
    yield [time, flight.sample(time, flightSample(), liftStart)];
  }
}
/** The opening over at these moments of the look's clock (each young wyvern then comes down when it next may), and no
 * opening at all. */
const OPENING_ENDS = [3, 17.3, 31.9, 52.6];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** A camera and the picture it takes. */
interface View { name: string; eye: Vec3; forward: Vec3; up: Vec3; right: Vec3; tan: number }
function camera(name: string, eye: Vec3, target: Vec3, fov = PLAY_FOV): View {
  const d = sub(target, eye), l = length(d);
  const forward: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const flat = Math.hypot(forward[0], forward[2]);
  const right: Vec3 = [-forward[2] / flat, 0, forward[0] / flat];
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]];
  return { name, eye, forward, up, right, tan: Math.tan((fov * Math.PI) / 360) };
}
/** Where p falls in a camera's picture (-1..1 across and up, for an `aspect` wide picture) and how far away it is. */
function project(c: View, p: Vec3, aspect = 16 / 9) {
  const d = sub(p, c.eye), depth = dot(d, c.forward);
  return { depth, x: dot(d, c.right) / (depth * c.tan * aspect), y: dot(d, c.up) / (depth * c.tan), distance: length(d) };
}
const inPicture = (c: View, p: Vec3, aspect = 16 / 9, margin = 1) => {
  const q = project(c, p, aspect);
  return q.depth > 0 && Math.abs(q.x) < margin && Math.abs(q.y) < margin;
};

// Every view the board must be seen whole from: the play cameras and their flip (White's first, Black's thirteenth),
// White's and Black's pulled back as a narrow screen frames them, and the board, cinematic and showcase views.
const GUARDED = GUARDED_VIEWS.map((v, index) => camera(`view ${index}`, v.eye, v.target));
const WHITE = GUARDED[0], BLACK = GUARDED[12];

/**
 * Whether p covers the board from a camera: it is in the camera's picture (taken as wide as an ultrawide screen, with
 * a margin) and the line of sight through it goes on into the board's box (coversBoard).
 */
const covers = (c: View, p: Vec3) => inPicture(c, p, 2.4, 1.1) && coversBoard(c.eye, p);
const body = wyvernBody;

// The opening's shots (shared/play/match-opening.ts): each from where it starts to where it ends, and the middle. The
// versus shot is also a rematch's short opening, so it may come at any time; the rest only at a match's start, while
// the young wyverns still fly higher.
const shot = (name: string, from: [Vec3, Vec3, number], to: [Vec3, Vec3, number]) => [0, 0.5, 1].map((k) => {
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return camera(name, mix(from[0], to[0]), mix(from[1], to[1]), from[2] + (to[2] - from[2]) * k);
});
const OPENING_START = [
  ...shot("arena", [[-7.8, 5.8, 25.5], [-5.3, 5.6, -5], 46], [[-6.4, 4.6, 19.5], [-4.5, 5.0, -5], 48]),
  ...shot("White's muster", [[5.6, 1.05, 0.2], [1.6, 0.9, 3.3], 40], [[1.65, 1.08, -0.5], [1.1, 1.0, 3.57], 40]),
  ...shot("Black's muster", [[5.6, 1.05, -0.2], [1.6, 0.9, -3.3], 40], [[1.65, 1.08, 0.5], [1.1, 1.0, -3.57], 40]),
];
const VERSUS = [1, -1].flatMap((near) =>
  shot("versus", [[10.8 * near, 3.0, 0.8 * near], [0.2 * near, 0.6, 0], 50], [[9.8 * near, 2.6, 0], [0.2 * near, 0.6, 0], 50]));

test("the flock is the same for the same seed, and another seed flies another flock", () => {
  const again = planFlock(FLOCK_SEED).map(buildFlight), other = planFlock(FLOCK_SEED + 1).map(buildFlight);
  assert.equal(flock.length, FLOCK_MAX);
  assert.deepEqual([...FLOCK_SIZE], [8, 12, 16]);
  assert.equal(FLOCK_SIZE[2], FLOCK_MAX);
  let differs = 0;
  for (const [index, flight] of flock.entries()) {
    for (const time of [0, 3.7, 41.2, 61.5, 600.5]) {
      const a = flight.sample(time, flightSample()), b = again[index].sample(time, flightSample()), c = other[index].sample(time, flightSample());
      assert.deepEqual(a, b);
      if (length(sub(a.position, c.position)) > 1) differs++;
    }
  }
  assert.ok(differs > flock.length * 2.5, `another seed moved only ${differs} samples`);
});

test("half the flock at each tier is young: they are the ones the play cameras see", () => {
  for (const size of FLOCK_SIZE) {
    const young = flock.slice(0, size).filter((flight) => flight.spec.young).length;
    assert.equal(young, size / 2, `${young} young of ${size}`);
  }
});

test("each circuit comes round to where it began, wings and all", () => {
  for (const flight of flock) {
    for (const time of [DOWN, DOWN + 12.3]) {
      const a = flight.sample(time, flightSample()), b = flight.sample(time + flight.period, flightSample());
      assert.ok(length(sub(a.position, b.position)) < 1e-6);
      // the wings' slow drift runs on the clock, not the loop; everything else repeats
      assert.ok(Math.abs(a.bank - b.bank) < 1e-9);
      assert.ok(Math.abs(((a.phase - b.phase + 1.5) % 1) - 0.5) < 0.04);
    }
  }
});

test("flight is smooth: steady speed, gentle climbs, no jolts, banks and wingbeats that change a little each frame", () => {
  const frame = 1 / 60;
  for (const [index, flight] of flock.entries()) {
    const { speed, young } = flight.spec;
    // the young ones are also watched through the opening's lift and its letting down, told the opening was over at
    // one moment or another or never told
    const runs: [number, number | undefined][] = young
      ? [[0, undefined], [OPENING_OVER[0], undefined], [DOWN, undefined], ...OPENING_ENDS.map((end): [number, number] => [end, flight.liftStartAfter(end)])]
      : [[DOWN, undefined]];
    for (const [from, liftStart] of runs) {
      let last: FlightSample | null = null, lastVelocity: Vec3 | null = null;
      let fastest = 0, slowest = Infinity, hardest = 0, steepest = 0, turn = 0, roll = 0, beat = 0;
      for (const [, s] of fly(flight, 60, from, liftStart)) {
        if (last) {
          const v: Vec3 = [(s.position[0] - last.position[0]) / frame, (s.position[1] - last.position[1]) / frame, (s.position[2] - last.position[2]) / frame];
          fastest = Math.max(fastest, length(v));
          slowest = Math.min(slowest, length(v));
          steepest = Math.max(steepest, Math.abs(Math.atan2(v[1], Math.hypot(v[0], v[2]))));
          if (lastVelocity) hardest = Math.max(hardest, length(sub(v, lastVelocity)) / frame);
          lastVelocity = v;
          turn = Math.max(turn, Math.acos(Math.min(1, dot(s.forward, last.forward))));
          roll = Math.max(roll, Math.abs(s.bank - last.bank));
          beat = Math.max(beat, Math.abs(((s.phase - last.phase + 1.5) % 1) - 0.5));
        }
        last = s;
      }
      const label = `wyvern ${index} from ${from} s`;
      // a young one glides a fifth slower skimming the ground, and slower again climbing away from it
      const least = young ? 0.55 : 0.7;
      assert.ok(slowest > least * speed && fastest < 1.5 * speed, `${label}: speed ${slowest.toFixed(1)}..${fastest.toFixed(1)} for ${speed.toFixed(1)}`);
      assert.ok(steepest < (36 * Math.PI) / 180, `${label}: climbs or dives at ${(steepest * 180 / Math.PI).toFixed(0)} degrees`);
      // no harder than a swooping pull-out of about four g
      assert.ok(hardest < 18, `${label}: accelerates at ${hardest.toFixed(1)} units/s2`);
      assert.ok(turn < (2 * Math.PI) / 180, `${label}: turns ${(turn * 180 / Math.PI).toFixed(2)} degrees in a frame`);
      assert.ok(roll < (1 * Math.PI) / 180, `${label}: rolls ${(roll * 180 / Math.PI).toFixed(2)} degrees in a frame`);
      // no faster than its own fastest wingbeat, the climbing one (about 0.85 s for an adult, 0.5 s for a young one), with
      // a little for the beat easing in and out
      assert.ok(beat < 1.15 / (60 * flight.spec.climbBeat), `${label}: wings jump ${beat.toFixed(4)} of the cycle in a frame`);
    }
  }
});

test("each wyvern beats its wings to climb and glides to come down, the climb beating faster", () => {
  for (const [index, flight] of flock.entries()) {
    let beating = 0, gliding = 0, steps = 0, climbing = 0, climbingBeats = 0, diving = 0, divingBeats = 0;
    let last: FlightSample | null = null;
    for (const [, s] of fly(flight, 20)) {
      if (last) {
        const rise = (s.position[1] - last.position[1]) * 20 / flight.spec.speed;
        if (s.flapping > 0.5) beating++; else gliding++;
        if (rise > 0.12) { climbing++; if (s.flapping > 0.5) climbingBeats++; }
        if (rise < -0.12) { diving++; if (s.flapping > 0.5) divingBeats++; }
      }
      steps++;
      last = s;
    }
    assert.ok(beating > 0.15 * steps && gliding > 0.15 * steps, `wyvern ${index}: beats ${beating} glides ${gliding} of ${steps}`);
    // a young one climbing out of a skim glides up on its speed until it is high enough to beat
    if (climbing > 20) assert.ok(climbingBeats > (flight.spec.young ? 0.5 : 0.8) * climbing, `wyvern ${index}: beats in only ${climbingBeats} of ${climbing} climbing samples`);
    if (diving > 20) assert.ok(divingBeats < 0.35 * diving, `wyvern ${index}: beats in ${divingBeats} of ${diving} diving samples`);
  }
});

test("a young wyvern too low to beat its wings glides there, wings level and banked only a little", () => {
  for (const [index, flight] of flock.entries()) {
    const { span, young } = flight.spec;
    if (!young) continue;
    let low = 0;
    for (const [time, s] of fly(flight, 20)) {
      const [x, y, z] = s.position;
      if (y >= lowestFlight(x, z, span, true) + youngBeatMargin(span)) continue;
      low++;
      const label = `young wyvern ${index} at ${time.toFixed(2)} s`;
      // (no more than the last trace of a beat easing out as it comes down to that height)
      assert.ok(s.flapping < 0.01, `${label} beats its wings ${(y - lowestFlight(x, z, span, true)).toFixed(2)} over its floor`);
      assert.ok(Math.abs(s.bank) <= YOUNG_LOW_BANK + 1e-9, `${label} banks ${s.bank.toFixed(3)}`);
      assert.ok(Math.abs(((s.phase - GLIDE_PHASE + 1.5) % 1) - 0.5) < 0.02, `${label}: wings at ${s.phase.toFixed(3)}`);
    }
    // and it does fly that low: through the corners of the play cameras' pictures
    assert.ok(low > 0.2 * flight.period * 20, `young wyvern ${index} is low for only ${low} samples`);
  }
});

test("every wyvern stays within its altitude band: over everything standing and under its circuit's top", () => {
  for (const [index, flight] of flock.entries()) {
    const { spec } = flight;
    let highestFloor = -Infinity;
    for (const [, s] of fly(flight, 10)) highestFloor = Math.max(highestFloor, lowestFlight(s.position[0], s.position[2], spec.span, spec.young));
    // the top of its band: the highest it was drawn to fly, or the highest floor round the circuit if that is more
    // (with the head-room the lift keeps and the smooth join), never more
    const drawn = spec.path ? Math.max(...spec.path.map((point) => point[1]))
      : spec.height + spec.waves.reduce((sum, [amplitude]) => sum + Math.abs(amplitude), 0);
    const top = Math.max(drawn, highestFloor + 2.5) + 1.5;
    for (const [time, s] of fly(flight, 10)) {
      const [x, y, z] = s.position;
      const floor = lowestFlight(x, z, spec.span, spec.young);
      assert.ok(y >= floor - 1e-6, `wyvern ${index} at ${time.toFixed(1)} s is ${(floor - y).toFixed(2)} below its floor`);
      assert.ok(y <= top, `wyvern ${index} at ${time.toFixed(1)} s is at ${y.toFixed(1)}, above its band's top ${top.toFixed(1)}`);
      assert.ok(y >= flight.band[0] - 0.5 && y <= flight.band[1] + 0.5);
    }
  }
});

test("nothing of a wyvern touches the ground or anything standing on it", () => {
  for (const [index, flight] of flock.entries()) {
    const { span, young } = flight.spec;
    let least = Infinity, where = "";
    for (const [time, s] of fly(flight, 20)) {
      for (const point of body(s, span)) {
        const ground = nearHeight(point[0], point[2], 0) ?? obstacleHeight(point[0], point[2], 0);
        if (point[1] - ground < least) { least = point[1] - ground; where = `${time.toFixed(2)} s`; }
      }
    }
    assert.ok(least > (young ? 0.2 : 0.5), `wyvern ${index} comes within ${least.toFixed(2)} of the ground at ${where}`);
  }
});

test("no wyvern ever covers the board, its figures or their crests, from any view the match is seen from", () => {
  for (const seed of [FLOCK_SEED, 1, 2, 3, 77, 4242]) {
    const flights = seed === FLOCK_SEED ? flock : planFlock(seed).map(buildFlight);
    for (const [index, flight] of flights.entries()) {
      // through the opening's lift and its letting down (never told the opening was over, or told at one moment or
      // another), then a whole loop after
      const runs: [number, number | undefined, number][] = [[0, undefined, DOWN], [OPENING_OVER[0], undefined, DOWN], [DOWN, undefined, Infinity],
        ...(flight.spec.openingLift ? OPENING_ENDS.map((end): [number, number, number] => [end, flight.liftStartAfter(end), Infinity]) : [])];
      for (const [from, liftStart, until] of runs) {
        for (const [time, s] of fly(flight, 6, from, liftStart)) {
          if (time > until) break;
          for (const c of GUARDED) {
            const point = body(s, flight.spec.span).find((p) => covers(c, p));
            assert.ok(!point, `seed ${seed} wyvern ${index} at ${time.toFixed(2)} s covers the board from ${c.name} (${c.eye})`);
          }
        }
      }
    }
  }
});

test("no wyvern in the picture of a view the match is seen from comes nearer to its camera than KEEP_OUT.near", () => {
  for (const seed of [FLOCK_SEED, 2, 77]) {
    const flights = seed === FLOCK_SEED ? flock : planFlock(seed).map(buildFlight);
    for (const [index, flight] of flights.entries()) {
      const near = flight.spec.young ? KEEP_OUT.near.young : KEEP_OUT.near.adult;
      for (const [from, liftStart] of [[0, undefined], [DOWN, undefined], [OPENING_ENDS[1], flight.liftStartAfter(OPENING_ENDS[1])]]) {
        for (const [time, s] of fly(flight, 6, from, liftStart)) {
          const points = body(s, flight.spec.span);
          for (const c of GUARDED) {
            if (!points.some((p) => inPicture(c, p))) continue;
            const distance = length(sub(s.position, c.eye));
            assert.ok(distance >= near, `seed ${seed} wyvern ${index} at ${time.toFixed(2)} s is ${distance.toFixed(1)} from ${c.name}`);
          }
        }
      }
    }
  }
});

test("the opening's shots see the flock, held high through it, only at a distance and never in front of the board", () => {
  for (const [index, flight] of flock.entries()) {
    const near = flight.spec.young ? KEEP_OUT.near.young : KEEP_OUT.near.adult;
    // the opening may begin at any moment of the look's clock, and lasts until the flock is told it is over: a whole loop
    // with all of the lift on
    for (const [time, s] of fly(flight, 6, 0, Infinity)) {
      const points = body(s, flight.spec.span);
      for (const c of [...OPENING_START, ...VERSUS.filter((c) => c.eye[0] > 0)]) {
        if (!points.some((p) => inPicture(c, p))) continue;
        const distance = length(sub(s.position, c.eye));
        assert.ok(distance >= near, `wyvern ${index} at ${time.toFixed(2)} s is ${distance.toFixed(1)} units from the ${c.name} camera`);
        assert.ok(!points.some((p) => covers(c, p)), `wyvern ${index} at ${time.toFixed(2)} s covers the board in the ${c.name} shot`);
      }
    }
  }
});

test("a rematch's versus shot (any moment, lifted or not) never shows a wyvern near the lens or in front of the board", () => {
  // From White's side (the usual one) the circuits keep clear of it on their own. From Black's side (a Classic match
  // played as Black) the young wyverns' run down the west trench passes between that camera and the board, and there
  // the last word (hiddenFrom) keeps them out of the picture.
  let guarded = 0, samples = 0;
  for (const [index, flight] of flock.entries()) {
    const near = flight.spec.young ? KEEP_OUT.near.young : KEEP_OUT.near.adult;
    for (const liftStart of [Infinity, -Infinity]) {
      for (const [time, s] of fly(flight, 6, DOWN, liftStart)) {
        const points = body(s, flight.spec.span);
        for (const c of VERSUS) {
          if (!points.some((p) => inPicture(c, p))) continue;
          samples++;
          const clear = length(sub(s.position, c.eye)) >= near && !points.some((p) => covers(c, p));
          const hidden = hiddenFrom(c.eye, s, flight.spec.span, flight.spec.young);
          if (c.eye[0] > 0) assert.ok(clear && !hidden, `wyvern ${index} at ${time.toFixed(2)} s in the versus shot from White's side`);
          else if (!clear) { assert.ok(hidden, `wyvern ${index} at ${time.toFixed(2)} s is not kept out of the versus shot from Black's side`); guarded++; }
        }
      }
    }
  }
  // it does have something to do there, and it is not most of what that shot sees
  assert.ok(guarded > 0 && guarded < 0.5 * samples, `the guard acted on ${guarded} of ${samples} samples`);
});

test("from the play cameras and the other views the match is seen from, the last word never has to act", () => {
  for (const [index, flight] of flock.entries()) {
    for (const [from, liftStart] of [[DOWN, undefined], [0, -Infinity], [OPENING_ENDS[2], flight.liftStartAfter(OPENING_ENDS[2])]] as const) {
      for (const [time, s] of fly(flight, 6, from, liftStart)) {
        const points = body(s, flight.spec.span);
        for (const c of GUARDED) {
          if (!points.some((p) => inPicture(c, p))) continue;
          assert.ok(!hiddenFrom(c.eye, s, flight.spec.span, flight.spec.young), `wyvern ${index} at ${time.toFixed(2)} s would pop out of ${c.name}`);
        }
      }
    }
  }
});

test("told the opening is over, each young wyvern comes down within a loop, and never part way down behind White's side", () => {
  for (const flight of flock) {
    if (!flight.spec.openingLift) continue;
    for (const end of OPENING_ENDS) {
      const start = flight.liftStartAfter(end);
      assert.ok(start >= end && start <= end + flight.period, `told at ${end} s, it starts down at ${start.toFixed(1)} s`);
      for (let time = end; time < start + LIFT_RELEASE + 1; time += 0.1) {
        const s = flight.sample(time, flightSample(), start), down = flight.sample(time, flightSample(), -Infinity);
        const lift = s.position[1] - down.position[1];
        if (s.position[2] > 6) assert.ok(lift < 1e-9 || lift > flight.spec.openingLift - 1e-9, `at ${time.toFixed(1)} s it is ${lift.toFixed(2)} up over White's side`);
      }
      assert.ok(Math.abs(flight.sample(start + LIFT_RELEASE, flightSample(), start).position[1] - flight.sample(start + LIFT_RELEASE, flightSample(), -Infinity).position[1]) < 1e-9);
    }
    // never told, it is down by OPENING_OVER[1]
    assert.ok(Math.abs(flight.sample(DOWN, flightSample()).position[1] - flight.sample(DOWN, flightSample(), -Infinity).position[1]) < 1e-9);
  }
});

test("the play cameras see young wyverns: one now and then from White's, most of the time from Black's", () => {
  const share = (size: number, c: View) => {
    let seen = 0, samples = 0, most = 0, biggest = 0;
    for (let time = DOWN; time < DOWN + 300; time += 0.2) {
      let count = 0;
      for (const flight of flock.slice(0, size)) {
        if (!flight.spec.young) continue;
        const s = flight.sample(time, flightSample());
        if (!inPicture(c, s.position)) continue;
        count++;
        const q = project(c, s.position);
        biggest = Math.max(biggest, flight.spec.span / (2 * q.depth * c.tan * 16 / 9));
      }
      samples++;
      if (count) seen++;
      most = Math.max(most, count);
    }
    return { seen: seen / samples, most, biggest };
  };
  const low = { white: share(FLOCK_SIZE[0], WHITE), black: share(FLOCK_SIZE[0], BLACK) };
  const high = { white: share(FLOCK_SIZE[2], WHITE), black: share(FLOCK_SIZE[2], BLACK) };
  // here without the arena's own height maps hiding what is behind it, about 15% and 82% at low, 31% and all the time
  // at high
  assert.ok(low.white.seen > 0.12 && high.white.seen > 0.25, `White's camera sees one ${(100 * low.white.seen).toFixed(0)}% / ${(100 * high.white.seen).toFixed(0)}% of the time`);
  assert.ok(low.black.seen > 0.75 && high.black.seen > 0.95, `Black's camera sees one ${(100 * low.black.seen).toFixed(0)}% / ${(100 * high.black.seen).toFixed(0)}% of the time`);
  // never a crowd: at most three at once, none wider than a quarter of the picture
  for (const [name, result] of Object.entries({ ...high })) {
    assert.ok(result.most <= 3, `${name}: ${result.most} at once`);
    assert.ok(result.biggest < 0.25, `${name}: one ${(100 * result.biggest).toFixed(0)}% of the picture wide`);
  }
});

test("with motion reduced the flock stands still where each play camera sees a young wyvern", () => {
  for (const c of [WHITE, BLACK]) {
    // with motion reduced there is no opening, so no lift
    const seen = flock.slice(0, FLOCK_SIZE[0]).some((flight) => flight.spec.young && inPicture(c, flight.sample(STILL_AT, flightSample(), -Infinity).position));
    assert.ok(seen, `no young wyvern in ${c === WHITE ? "White's" : "Black's"} picture at ${STILL_AT} s`);
  }
});

test("the young wyverns, one after another on one circuit, keep well apart", () => {
  const young = flock.filter((flight) => flight.spec.young);
  let least = Infinity;
  for (let time = DOWN; time < DOWN + young[0].period; time += 0.1) {
    const at = young.map((flight) => flight.sample(time, flightSample()).position);
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) least = Math.min(least, length(sub(at[i], at[j])));
  }
  // eight on one circuit at high: never nearer than two wingspans, one behind another
  assert.ok(least > 2 * young[0].spec.span, `two young wyverns come within ${least.toFixed(1)} of each other`);
});

test("the airspace maps know the arena: the skull and the spires stand tall, the trench and the moat lie low", () => {
  // the skull behind Black's side, about 13 units tall; a spire on the ring at 40 units
  assert.ok(obstacleHeight(5.5, -17, 0) >= 13);
  assert.ok(obstacleHeight(-36, -23, 2) >= 18);
  // the lava moat west of the board, below the board's top, and the open abyss beyond it
  assert.ok(obstacleHeight(-55, 0, 0) < 0);
  assert.ok(obstacleHeight(-78, 0, 0) <= -19);
  // past the mapped rings the far lands are taken at their highest
  assert.ok(obstacleHeight(0, -200, 0) >= 50);
  // a wider reach never finds less
  for (const [x, z] of [[20, 30], [-60, 10], [90, -80], [5, 5]]) assert.ok(obstacleHeight(x, z, 10) >= obstacleHeight(x, z, 0));
  // round the board in finer detail: the trench by the board's west side lies low, the skull stands tall, and outside
  // the fine grid there is no answer
  assert.ok((nearHeight(-12.5, -7.5, 0) ?? Infinity) <= -2);
  assert.ok((nearHeight(9.5, -19.5, 0) ?? -Infinity) >= 13);
  assert.equal(nearHeight(0, -40, 1), null);
  for (const [x, z] of [[-9, 0], [3, 12], [10, -15]]) assert.ok((nearHeight(x, z, 2) ?? 0) >= (nearHeight(x, z, 0) ?? 0));
  // over the board itself a young wyvern stays higher than the play cameras, an adult higher still
  assert.ok(lowestFlight(0, 0, 3.5, true) > 6.4 + wyvernReach(3.5).down);
  assert.ok(lowestFlight(0, 0, 13) > KEEP_OUT.near.adult);
});
