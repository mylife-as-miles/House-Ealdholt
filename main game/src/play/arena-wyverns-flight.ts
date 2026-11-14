/**
 * Where the arena's wyverns fly (arena-wyverns.ts draws them). Plain numbers and no three.js, so the paths can be
 * tested on their own. Each wyvern flies a closed circuit round the arena, worked out once from a seed and then read
 * by time, so a still at a given time is always the same picture.
 *
 * Units are the board's own (a square is 1.02 across; Blender metres / 2.3), y up, the board's centre at the origin,
 * White's side +z. A bearing is measured from -z (toward the eclipse) round toward +x, in radians.
 */

export type Vec3 = [number, number, number];

// --- what is in the way ------------------------------------------------------------------------------------------------

/**
 * The highest solid surface of either battlefield, on a polar grid round the board: 36 bearings of 10 degrees (the first
 * centred on -z) by 32 rings of 5 units, out to 160. Measured from the look's own meshes (both settings, rendered from
 * straight above into a height map), each cell rounded up to a whole unit. One character a cell, ring by ring from the
 * centre: height = character code - 68, so "0" is -20, which stands for nothing at all (the open abyss).
 */
const OBSTACLES =
  "DDDDDEDDDDDDDDEDDDDDDDDEDDDDDDDDEDDD" +
  "EEEEDDDDDDDDDDDEFFDFFEDDDDDDDDDDDFED" +
  "EDDDIIHIHDEDEFFEDDDDDDEFEDEEDBDDEFFF" +
  "IERFHIIHEEEFFFFFFFGFFFFFFFFGJKJJGLML" +
  "HGRRIKEDEEDEEEHJFFHOEFEGFFEFENIKKLML" +
  "EEFFGGCDDEEEFEFFFPEDFFEFFEEEENMNKHHH" +
  "CCDLCBBBEEFDDFFGGFGFFFEEFDJFCCCBENQP" +
  "JLCOKBWRBBBEEEEWEFGGCWYBBBJGBBBBBGKB" +
  "CDBOOSXABCCAAAASBAAAAQRAABAAAAYQKDCB" +
  "@@LMPTC@BCJ@A@BDA@@@AAB@@@@@AAUPXGB@" +
  "JJ@@ONB?@@G?@@@@@@@@@@@@@@@@?@DF@G@@" +
  "JJO[OD??A?C??AAAA??@@???@??@@??A@Q@@" +
  "GMP]SA@AA@@@@BBAA??@AAA@B@@@A@@AAEHH" +
  "DKN[AABAAABBABBAB@>ABBBBAAB@BBBBBANJ" +
  "CCBVACCCB@XCCDCBBEFBCCBBBAA@ACB@CBNN" +
  "DDCJPCCC11QDCDCDAILJBDDCCB111ACDDDNN" +
  "DDC[[SC11111CCCDBLOSKHDDD111;B]c_EED" +
  "KHE_^WB1ML22BDDCEQRTSKDED<2DGGEc_Z`D" +
  "LMK[aWICQP2:HFEAGQTWUIEEEC2HKMIb_ccI" +
  "MLKJaWOIQQ@EJIGDGRVXTNIGIH:LNNKGdfeM" +
  "MMJJPPQORNHJJNJDGOWXXPKGKI<OPPOK_faM" +
  "DMDKPSWRWYOMNPODGMXYXTMLLJ>NPPQNC[EF" +
  "DDCKLWXS]\\UOORPEDMXYXTQOOJDOOQRPFY]h" +
  "CCTKMXYX`]WOPRPGCKSXXSRRQKENRPRRGZgh" +
  "@A`GLYZX`]\\OPTPIDIRWVRSURLIRRPTUIOgX" +
  "=ZbFKXZX^a^QPUQNFIPRPMWVULKRRRYYNHdV" +
  "=ZcHJYYWae`RQUQPHGPQOSXXVMMKMPZZPWSC" +
  "NZYKJYXVbfaWSURMIHLQOXZZXLPHKQZZQX]]" +
  "QYYPJXXWahbYTTRMIGLQPYZZXOQGHQVXQEAT" +
  "WMYQJXTWbh^YTTPLIFJPOYYXVQQHJORUMGGU" +
  "FMKWJSQZdgYXRQMKFFHNLTUTRPQGJQR_`IJM" +
  "?LL\\MPRZb_TRPM000000000OMOOBDQQ``stM";
const OBSTACLE_RING = 5, OBSTACLE_RINGS = 32, OBSTACLE_BEARINGS = 36;
const OBSTACLE_HEIGHTS = Int8Array.from(OBSTACLES, (character) => character.charCodeAt(0) - 68);
/** Past the mapped rings only the far lands' last ridges stand, and none of them higher than this. */
const FAR_GROUND = 50;

/** The highest surface within `reach` of (x, z), from the table above (rounded up, so never lower than the real one). */
export function obstacleHeight(x: number, z: number, reach: number): number {
  const rho = Math.hypot(x, z);
  let high = rho + reach > OBSTACLE_RINGS * OBSTACLE_RING ? FAR_GROUND : -Infinity;
  const first = Math.max(0, Math.floor((rho - reach) / OBSTACLE_RING));
  const last = Math.min(OBSTACLE_RINGS - 1, Math.floor((rho + reach) / OBSTACLE_RING));
  if (first > last) return high;
  const cell = (Math.PI * 2) / OBSTACLE_BEARINGS;
  const bearing = Math.atan2(x, -z);
  const spread = reach >= rho ? Math.PI : Math.asin(reach / rho);
  const from = Math.round((bearing - spread) / cell);
  const cells = Math.min(OBSTACLE_BEARINGS - 1, Math.round((bearing + spread) / cell) - from);
  for (let k = 0; k <= cells; k++) {
    const b = (((from + k) % OBSTACLE_BEARINGS) + OBSTACLE_BEARINGS) % OBSTACLE_BEARINGS;
    for (let ring = first; ring <= last; ring++) {
      const height = OBSTACLE_HEIGHTS[ring * OBSTACLE_BEARINGS + b];
      if (height > high) high = height;
    }
  }
  return high;
}

/**
 * The arena round the board, where the play cameras see the ground past the board's edges, in finer detail than the
 * table above: cells of one board unit over x -24..24, z -30..30, each the highest surface of either battlefield in
 * it, rounded up to half a unit. One letter a cell, row by row from the lowest z: height = the letter's place in
 * NEAR_ALPHABET x 0.5 - 4. Measured like the table above. Only the young wyverns, which fly low through it, use it.
 */
const NEAR_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const NEAR =
  "444488HLPP2VVUV444444444444434444442222377754LLE" +
  "4444888HNRRGUU4444444444444544556888823377653ML8" +
  "444499FGNRRGGAA469944444555554888888888334455355" +
  "444499GGHONEEAA9999GGA955555588AA999998845555333" +
  "444999EE6FD33ACBAAAGGAA95665589AA999AA9985555333" +
  "4449999763399AABBBBBBBAA9655899CAAAAAA9998853333" +
  "44499997733AAAIKLLKBBBBAAAAA9BEEEBBAABB998854444" +
  "448888877A9AABMNNNNLJBBBCCAA9EFFFDDBBBBB99854444" +
  "444777776ACCAINOPPONLBBBA9989DLLLLFDCCBBBA864444" +
  "444499AA93CCCLOPPPPOMKGBA99899LLSSQKDCEECA885544" +
  "3478AIHDCBDDBLOPPPPONMGFAAA8AAZZaaURKGGDCCEE8554" +
  "QQQPONLJFDCCBLOPPPPONMJGAAA8A9ZaaaWVKGBCCCEE9844" +
  "QRRQPOMKGDAACFNOPPPONMKFAAA899AABXWVHGCBBAED9444" +
  "QRQQPOMKGCAABFLNNOOONMJBAAAA99AAAAABACCBCA999444" +
  "QQPONMLHBB9EEBBKMMNNMKHBA9AA899AAAAAAA9CC9999444" +
  "557GGAAAAAAAAABCCIKKIAAA9967899AA9AA999BMMA94555" +
  "55FHH9BCFC999ABCCBBBAAAA9677788AA9999989LLA94555" +
  "559GGACEFHIJ99ACCAAAACC96677778888888889CC994555" +
  "555568BCFHIJ36ACC9999CCA667777777H88834899994555" +
  "555554553333366AA99997AA777777777HHHGG4789994555" +
  "SS8755HHG333377777777879778777777HHHII9AGG943366" +
  "557554JJG3333777777889877AA88777733HIIAAGG845577" +
  "55555KKKA8333777778BB777777AA8777733GHBGC8845677" +
  "55555LLK83333777788BB777777AA8877773ABAFC8844777" +
  "55555LL88A333777887777777777777778BABB6A97733777" +
  "5568KK58AA33337887788888888887777FGAHG3357733677" +
  "A999KKAA83333338877877777777877777AAHG8889993357" +
  "A9AAJJBA88888838777877777777877777GGEED98999389A" +
  "A9ABHHB988888878777877777777877777FFAFF98999789A" +
  "A98BCBA7788887887778777997778777777778888899989A" +
  "987AAA67799887887778777997778777777777866988889A" +
  "9876666799988778777877777777877787777776AA988867" +
  "9875666699988788777877777777877787777799AA987777" +
  "56775AA68998877887787777777787788777789988777677" +
  "887AACCB968888788778888888888778877778889AA78767" +
  "8879ACCB968888778877777777777788778888789BB88766" +
  "987798B976899A77788AA777777AA88777998779ABB77776" +
  "98799887899ABB77778AA777799AA87777BBA989AA997777" +
  "987AA98ABBABBB7777788AA77AA8877777CCBB9AA9999777" +
  "988BA99BCCBAAAA877777B7777B777777CCCCB9AA9999777" +
  "677899ACCBABAA988877777777778889ACCCBBA89AAA7776" +
  "788999CCBBAABC988878776666888889ABBACCC88AAA7776" +
  "7999ABDDCBACCB8866888666668887799AAAACC986667779" +
  "99AAACDDCB9AB98866688655557778889AABAAA998877789" +
  "A5997CCBB9AA8788866886444477788899ABBBAAA988789A" +
  "B4BBBBAA99AABB88869A48444467788BBB9ABCCAAA99879A" +
  "B4CCCB9999AABB9879AB9944446978ABBB59BCCABAA9987A" +
  "4ACCBA959AAAA9977ABBAA87CB9999ACCAJJIBC9BBAAA987" +
  "8ABBA995589999977ABABA9CDCBAAA8CBAJJJAB99AAAAA85" +
  "8889988565AA99978AAABBAEEDBAAA9A977FF99889979488" +
  "89995579999AAA6589BBUUBFFE999AAA666777789BB93AA9" +
  "999984899996855559ABSS8CEEAAABBBB67777779BB94BBA" +
  "9988888999975665589HMM9889AABCCCB67777779ABB4BBB" +
  "9998888999775666656EHH989889CCCC888777888AA84ABB" +
  "99998889984A95665778AA88A987BVC788877888877774AB" +
  "999998855CCBA94558884558AA987U477666478877888843" +
  "999999566CCBA97778888888AA98ARP55554BBA488888832" +
  "9AA9935668BBB488858488898A99AMM8844BBBA488889922" +
  "2AA93456678BB999984888993AAAAA98888BBDDB88999922" +
  "3311445567744AA9988888994AAAAA9CBBAAAEEB89999922";
const NEAR_X0 = -24, NEAR_Z0 = -30, NEAR_WIDTH = 48, NEAR_ROWS = 60;
const NEAR_HEIGHTS = Float32Array.from(NEAR, (letter) => NEAR_ALPHABET.indexOf(letter) * 0.5 - 4);

/** The highest surface within `reach` of (x, z) from the fine grid, or null where that reach is not inside it. */
export function nearHeight(x: number, z: number, reach: number): number | null {
  const x0 = Math.floor(x - reach), x1 = Math.floor(x + reach), z0 = Math.floor(z - reach), z1 = Math.floor(z + reach);
  if (x0 < NEAR_X0 || x1 >= NEAR_X0 + NEAR_WIDTH || z0 < NEAR_Z0 || z1 >= NEAR_Z0 + NEAR_ROWS) return null;
  let high = -Infinity;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      // only the cells the reach's disc touches
      const dx = Math.max(cx - x, 0, x - (cx + 1)), dz = Math.max(cz - z, 0, z - (cz + 1));
      if (dx * dx + dz * dz > reach * reach) continue;
      high = Math.max(high, NEAR_HEIGHTS[(cz - NEAR_Z0) * NEAR_WIDTH + (cx - NEAR_X0)]);
    }
  }
  return high;
}

/**
 * Where the match is played from (web/src/scene/sceneEngine.ts CAMERA_SHOTS, measured in the match): both presets look
 * at PLAY_TARGET from 8.6 units out and 6.4 up through a 46.6 degree lens, and the flip between them (flipCamera) is half
 * an orbit at that radius and height through +x. Here every fifteen degrees of it, White's preset first.
 */
export const PLAY_TARGET: Vec3 = [0, 0.35, 0];
export const PLAY_CAMERAS: Vec3[] = Array.from({ length: 13 }, (_, k): Vec3 => {
  const turn = (k / 12) * Math.PI;
  return [8.6 * Math.sin(turn), 6.4, 8.6 * Math.cos(turn)];
});

/**
 * The views the board must always be seen whole from (web/src/scene/sceneEngine.ts CAMERA_SHOTS and SHOWCASE_SHOT): where
 * the match is played from (PLAY_CAMERAS, and White's and Black's pulled back to 19 units out, as a narrow screen frames
 * them), and the board, cinematic and showcase views an AI Battle or a showcase is watched from. All through the same
 * lens, PLAY_FOV degrees from the top of the picture to the bottom.
 */
export const GUARDED_VIEWS: { eye: Vec3; target: Vec3 }[] = [
  ...PLAY_CAMERAS.map((eye) => ({ eye, target: PLAY_TARGET })),
  { eye: [0, 11.3, 15.6], target: PLAY_TARGET }, { eye: [0, 11.3, -15.6], target: PLAY_TARGET },
  { eye: [0, 12.4, 0.35], target: [0, 0.2, 0] }, { eye: [9.6, 3.6, 6.8], target: [-0.4, 0.5, -0.4] },
  { eye: [7.1, 6.5, 8.2], target: PLAY_TARGET },
];
export const PLAY_FOV = 46.615;

/**
 * What the flock keeps out of. No wyvern ever comes between the board and any of GUARDED_VIEWS: `board` is the board as
 * those views must see it whole, its frame (4.75 out each way) with a margin, up to the crests over the tallest figures,
 * and nothing of a wyvern inside one of their pictures may lie on a line of sight from its camera to the board. Nor may
 * a wyvern in a play camera's picture come nearer to it than `near` (an adult fills too much of the picture any closer; a
 * young one is a third of the size). And `arenaShot`: the first shot of the opening (shared/play/match-opening.ts
 * "arena") looks at the whole battlefield from 20 to 26 units out past White's side, and nothing passes close in front of
 * its lens. The adults keep all of it by flying high wherever they could come near (lowestFlight); the young ones, which
 * fly low through the corners of the play cameras' pictures, by the shape of their circuits, and the tests hold every
 * moment of every flight to it.
 */
export const KEEP_OUT = {
  board: { half: 5.6, top: 4.2 },
  near: { adult: 22, young: 12 },
  arenaShot: { centre: [-7.1, 5.2, 22.5] as Vec3, radius: 24 },
} as const;

/**
 * How far a wyvern reaches from the middle of its trunk, measured on the model over its whole wingbeat: all of it lies
 * within `side` (the tail is the farthest, 0.71 of the span behind), its wingtips within `wing` to either side; its lowest
 * point lies at most `down` below the trunk with its wings beating and banked as far as it ever banks (at the bottom of
 * the downstroke the wingtips hang 0.34 of the span below it), and at most `glide` below it gliding, its wings level
 * (GLIDE_PHASE), banked no more than YOUNG_LOW_BANK.
 */
export function wyvernReach(span: number) {
  return { side: 0.78 * span, wing: 0.55 * span, down: 0.45 * span, glide: 0.16 * span };
}

/**
 * A wyvern's body as points, from a sample of its flight: the trunk, belly, nose, tail and the middle of the tail, each
 * wing at a quarter and half the span out, and with its wings beating, the wingtips at the top and the bottom of the
 * stroke. Shares of the span measured on the model over its wingbeat.
 */
export function wyvernBody(s: FlightSample, span: number): Vec3[] {
  const f = s.forward, flat = Math.hypot(f[0], f[2]) || 1;
  const lx = f[2] / flat, lz = -f[0] / flat, c = Math.cos(s.bank), sn = Math.sin(s.bank);
  const left: Vec3 = [lx * c, sn, lz * c], up: Vec3 = [-lx * sn, c, -lz * sn];
  const at = (side: number, rise: number, ahead: number): Vec3 => [
    s.position[0] + (left[0] * side + up[0] * rise + f[0] * ahead) * span,
    s.position[1] + (left[1] * side + up[1] * rise + f[1] * ahead) * span,
    s.position[2] + (left[2] * side + up[2] * rise + f[2] * ahead) * span];
  const points = [at(0, 0, 0), at(0, -0.1, 0), at(0, 0, 0.31), at(0, -0.05, -0.71), at(0, -0.03, -0.35),
    at(0.25, 0, 0), at(-0.25, 0, 0), at(0.5, 0, 0), at(-0.5, 0, 0)];
  if (s.flapping > 0) points.push(at(0.31, 0.39, 0), at(-0.31, 0.39, 0), at(0.31, -0.34, 0), at(-0.31, -0.34, 0));
  return points;
}

/**
 * Whether `point` lies in front of the board as seen from `eye`: the line of sight through it goes on into the board's
 * box (KEEP_OUT.board, up to the crests over the tallest figures), or it is inside that box. Whether it is in the
 * camera's picture at all is the caller's to know.
 */
export function coversBoard(eye: Vec3, point: Vec3): boolean {
  const { half, top } = KEEP_OUT.board;
  let near = 0, far = Infinity;
  for (const [axis, low, high] of [[0, -half, half], [1, 0, top], [2, -half, half]] as const) {
    const d = point[axis] - eye[axis];
    if (Math.abs(d) < 1e-9) { if (eye[axis] < low || eye[axis] > high) return false; continue; }
    let a = (low - eye[axis]) / d, b = (high - eye[axis]) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return false;
  }
  return far >= 1;
}

/**
 * The last word, for a camera no circuit was planned round (a rematch's versus shot from Black's side, a duel's close
 * shot, a free camera): a wyvern any of whose body lies in front of the board from `eye`, or whose trunk comes nearer to
 * it than KEEP_OUT.near, is not drawn for that frame. From the play cameras and the views in GUARDED_VIEWS the circuits
 * already keep it clear, so there it never has to act (arena-wyverns.test.ts).
 */
export function hiddenFrom(eye: Vec3, sample: FlightSample, span: number, young: boolean, inView?: (point: Vec3) => boolean): boolean {
  // `inView`, where given, says whether a point is in the camera's picture: only what can be seen counts (a wyvern
  // passing close by outside the picture is left alone)
  const body = wyvernBody(sample, span).filter((point) => !inView || inView(point));
  if (!body.length) return false;
  const p = sample.position;
  if (Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) < (young ? KEEP_OUT.near.young : KEEP_OUT.near.adult)) return true;
  return body.some((point) => coversBoard(eye, point));
}

/** The most a young wyvern banks while it flies low enough that only a glide keeps its wingtips clear. */
export const YOUNG_LOW_BANK = 0.32;

/** Head-room kept between the lowest a wyvern reaches and the highest thing beneath it. */
const CLEARANCE = 1.5, YOUNG_CLEARANCE = 0.35;

/**
 * The lowest the middle of a wyvern's trunk may fly at (x, z): over everything solid in its reach. An adult also stays
 * above a dome round the play cameras' positions and their flip, KEEP_OUT.near plus its reach from each, which holds the
 * board, the figures and every line of sight to them, and above one round the opening's first shot. A young wyvern may
 * fly as low as a glide allows, over the fine grid round the board (nearHeight), and buildFlight has it glide wherever
 * it flies that low; it stays above the cameras' height over the board itself. Those whose circuits pass in front of the
 * opening's first shot keep away from it by flying higher until the opening is over (FlightSpec.openingLift).
 */
export function lowestFlight(x: number, z: number, span: number, young = false): number {
  const { side, wing, down, glide } = wyvernReach(span);
  if (young) {
    let floor = (nearHeight(x, z, wing) ?? obstacleHeight(x, z, wing)) + glide + YOUNG_CLEARANCE;
    const { half } = KEEP_OUT.board;
    if (Math.abs(x) < half + wing && Math.abs(z) < half + wing) floor = Math.max(floor, PLAY_CAMERAS[0][1] + down + 1);
    return floor;
  }
  let floor = obstacleHeight(x, z, side) + down + CLEARANCE;
  for (const [cx, cy, cz] of PLAY_CAMERAS) {
    const around = KEEP_OUT.near.adult + side, away = Math.hypot(x - cx, z - cz);
    if (away < around) floor = Math.max(floor, cy + Math.sqrt(around * around - away * away));
  }
  const [sx, sy, sz] = KEEP_OUT.arenaShot.centre;
  const around = KEEP_OUT.arenaShot.radius + side, away = Math.hypot(x - sx, z - sz);
  if (away < around) floor = Math.max(floor, sy + Math.sqrt(around * around - away * away));
  return floor;
}

/** How much higher than lowestFlight a young wyvern must fly to beat its wings there. */
export const youngBeatMargin = (span: number) => { const { down, glide } = wyvernReach(span); return down - glide; };

/**
 * The match's opening (shared/play/match-opening.ts) starts once the arena is drawing steadily, at most about 20 seconds
 * after the look's first frame, and its camera's warm-up takes at most about 16 more; its first shot is over 2.6 seconds
 * later. A young wyvern with an opening lift flies that much higher until it is told the opening is over (or that there
 * is none: arena-wyverns.ts `opening`). Never told, it starts down at the first of these times as though told then, and
 * by the second it has come down to its own circuit wherever it was on it (Flight.liftStartAfter).
 */
export const OPENING_OVER = [40, 75] as const;

/**
 * Where the flock stands still when motion is reduced (the look's clock then stays at 0): a moment after the opening's
 * lift when a young wyvern is in view from each play camera.
 */
export const STILL_AT = 82;

// --- a circuit ---------------------------------------------------------------------------------------------------------

export interface FlightSpec {
  /** Wingspan, board units. */
  span: number;
  /** Middle of the circuit, (x, z). */
  centre: [number, number];
  /** Mean distance from the middle. */
  radius: number;
  /** The circuit's shape: radius x (1 + a cos(bearing + p) + b cos(2 bearing + q)), as [a, p, b, q]. */
  shape: [number, number, number, number];
  /** +1 flies with the bearing rising (clockwise seen from above), -1 the other way. */
  turn: 1 | -1;
  /** Bearing where the loop begins. */
  bearing: number;
  /** Mean altitude above the board. */
  height: number;
  /** Rises and falls over one loop, each [amplitude, waves a loop, phase]. */
  waves: [number, number, number][];
  /** A dive low past the arena's edge and the climb back: the bearing of its lowest point, how far it drops below the
   * circuit, and its width as a share of the loop. The circuit is lifted wherever it would come too low (lowestFlight),
   * so the dive bottoms out over the open moat and nowhere near anything standing. */
  swoop: { bearing: number; depth: number; width: number } | null;
  /** Mean airspeed, units a second. */
  speed: number;
  /** Seconds a wingbeat takes flying level, and at the steepest climb. */
  beat: number;
  climbBeat: number;
  /** Seconds the clock is moved on for this wyvern, so two on one circuit fly apart; and a share of its loop it is moved
   * on besides (young wyverns that fly one circuit after another, evenly apart whatever the loop's length). */
  delay: number;
  delayShare?: number;
  /** Where its wings idle in a glide drift from (radians), so the flock does not breathe in step. */
  drift: number;
  /** A young wyvern: a third of an adult's size, it skims the strips behind the board that the play cameras see, so its
   * floor is the fine one (nearHeight) and its dive has a long flat bottom. */
  young: boolean;
  /** How much higher it flies while the match's opening may be playing, coming down to its circuit over OPENING_OVER. */
  openingLift: number;
  /** A circuit through these points (x, height, z) in turn, as a smooth closed curve, in place of the one above (centre,
   * radius, shape, bearing, height, waves and swoop are then not used). A young wyvern's is drawn through the corners
   * of the play cameras' pictures; where a point is set lower than it may fly, it flies as low as it may. */
  path?: Vec3[];
}

export interface FlightSample {
  position: Vec3;
  /** Unit vector the body points along: the flight direction, with only part of a climb or a dive in it. */
  forward: Vec3;
  /** Roll about `forward`, radians. Negative drops the left wing (the group's +x), as in a left turn. */
  bank: number;
  /** Where in Fly_Cycle the wings are, 0..1. */
  phase: number;
  /** 1 while it beats its wings, 0 in a glide (eased in between). */
  flapping: number;
}

export interface Flight {
  spec: FlightSpec;
  /** Seconds one loop takes. */
  period: number;
  /** The lowest and highest the trunk goes. */
  band: [number, number];
  /**
   * Where it is at `time`. `liftStart` is when the opening's lift (FlightSpec.openingLift) begins to come off, over
   * LIFT_RELEASE seconds: -Infinity for none at all; by default, as though the opening were over at OPENING_OVER[0].
   */
  sample(time: number, out: FlightSample, liftStart?: number): FlightSample;
  /** The first moment at or after `time` that its lift may begin to come off (see LIFT_HOLD). */
  liftStartAfter(time: number): number;
}

/**
 * Fly_Cycle, as a share of its length, where the wings are spread level with the back on the way down: the glide pose.
 * It is the Queen's rite's own level point (rites/wyvern.ts: CLIP_TOP 0.3 plus CLIP_LEVEL 0.27); a little earlier the
 * wings still stand in a V, a little later the downstroke has begun.
 */
export const GLIDE_PHASE = 0.57;
/** The body takes this share of a climb or a dive: a long tail must not swing about with every rise. */
const CLIMB_SHARE = 0.7;
/** Banking: share of the angle a level, coordinated turn would need, and the most it may take. */
const BANK_GAIN = 1.35, MAX_BANK = 1.0;
/** The steepest a circuit is lifted at, as rise over run (about 23 degrees), and the steepest it comes back down after;
 * a young wyvern, small and quick, climbs and drops at up to YOUNG_SLOPE (31 degrees). */
const MAX_LIFT = 0.42, MAX_SINK = 0.3, YOUNG_SLOPE = 0.6;
const LOOP_SAMPLES = 2048, TIME_SAMPLES = 1024;
/** Where a young wyvern never comes down from the opening's lift (FlightSpec.openingLift): the band behind White's side,
 * z > LIFT_HOLD, which White's pulled-back camera looks across at the board. And the seconds the lift takes to come off. */
const LIFT_HOLD = 6;
export const LIFT_RELEASE = 10;
/** Board units to metres, and gravity in metres a second squared, for the bank a turn needs. */
const METRES = 2.3, GRAVITY = 9.81;

const TAU = Math.PI * 2;
const wrap = (value: number, length: number) => ((value % length) + length) % length;
/** A smooth maximum: never below either, and no corner where they cross. */
const smoothMax = (a: number, b: number, k: number) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The highest (or lowest) of each sample's neighbours within `half` samples either side, round a loop. */
function slidingExtreme(values: Float64Array, half: number, highest: boolean): Float64Array {
  const n = values.length, out = new Float64Array(n);
  if (half <= 0) return Float64Array.from(values);
  if (2 * half + 1 >= n) return out.fill(highest ? Math.max(...values) : Math.min(...values));
  // a queue of candidates, best first; each sample enters once and leaves once
  const queue = new Int32Array(n + 2 * half + 1);
  let head = 0, tail = 0;
  const better = (a: number, b: number) => (highest ? a >= b : a <= b);
  for (let i = -2 * half; i < n; i++) {
    const value = values[((i + half) % n + n) % n];
    while (tail > head && better(value, values[((queue[tail - 1] % n) + n) % n])) tail--;
    queue[tail++] = i + half;
    while (queue[head] < i - half) head++;
    if (i >= 0) out[i] = values[((queue[head] % n) + n) % n];
  }
  return out;
}

/** A circular blur of a loop of samples, about a Gaussian `sigma` samples wide: three running box averages. */
function blurLoop(values: Float64Array, sigma: number): Float64Array {
  const n = values.length;
  // three boxes of width w have the variance of a Gaussian of sigma when 3 (w^2 - 1) / 12 = sigma^2
  const half = Math.max(0, Math.min(Math.floor(n / 2) - 1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)));
  let from = Float64Array.from(values), to = new Float64Array(n);
  if (half === 0) return from;
  for (let pass = 0; pass < 3; pass++) {
    let sum = 0;
    for (let d = -half; d <= half; d++) sum += from[(d + n) % n];
    for (let k = 0; k < n; k++) {
      to[k] = sum / (2 * half + 1);
      sum += from[(k + half + 1) % n] - from[(k - half + n) % n];
    }
    [from, to] = [to, from];
  }
  return from;
}

/** A closed Catmull-Rom curve through `points`, as `count` points evenly spaced along it. */
function closedCurve(points: Vec3[], count: number): Vec3[] {
  const n = points.length, fine = count * 8, dense: Vec3[] = [], along = new Float64Array(fine + 1);
  for (let k = 0; k < fine; k++) {
    const u = (k / fine) * n, i = Math.floor(u), f = u - i;
    const p0 = points[(i - 1 + n) % n], p1 = points[i % n], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const at = (c: number) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f * f +
      (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f * f * f);
    dense.push([at(0), at(1), at(2)]);
  }
  for (let k = 0; k < fine; k++) {
    const a = dense[k], b = dense[(k + 1) % fine];
    along[k + 1] = along[k] + Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const out: Vec3[] = [];
  for (let j = 0, k = 0; j < count; j++) {
    const target = (j / count) * along[fine];
    while (along[k + 1] < target) k++;
    const f = (target - along[k]) / Math.max(1e-9, along[k + 1] - along[k]), a = dense[k], b = dense[(k + 1) % fine];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}

/** Works a circuit out: its path round the loop, lifted clear of everything, then timed, banked and given wingbeats. */
export function buildFlight(spec: FlightSpec): Flight {
  // 1. the circuit as designed, evenly round the loop
  const N = LOOP_SAMPLES;
  const lx = new Float64Array(N), ly = new Float64Array(N), lz = new Float64Array(N), need = new Float64Array(N);
  const [a, p, b, q] = spec.shape;
  const swoopAt = spec.swoop ? wrap(((spec.swoop.bearing - spec.bearing) * spec.turn) / TAU, 1) : 0;
  const route = spec.path ? closedCurve(spec.path, N) : null;
  for (let k = 0; k < N; k++) {
    if (route) {
      lx[k] = route[k][0]; ly[k] = route[k][1]; lz[k] = route[k][2];
      need[k] = lowestFlight(lx[k], lz[k], spec.span, spec.young);
      continue;
    }
    const u = k / N, bearing = spec.bearing + spec.turn * TAU * u;
    const r = spec.radius * (1 + a * Math.cos(bearing + p) + b * Math.cos(2 * bearing + q));
    lx[k] = spec.centre[0] + r * Math.sin(bearing);
    lz[k] = spec.centre[1] - r * Math.cos(bearing);
    let y = spec.height;
    for (const [amplitude, count, phase] of spec.waves) y += amplitude * Math.sin(TAU * count * u + phase);
    if (spec.swoop) {
      const d = (wrap(u - swoopAt + 0.5, 1) - 0.5) / spec.swoop.width;
      y -= spec.swoop.depth * Math.exp(-0.5 * d * d);
    }
    ly[k] = y;
    need[k] = lowestFlight(lx[k], lz[k], spec.span, spec.young);
  }
  // 2. lifted wherever it would come too low: a floor that rises no faster than MAX_LIFT ahead of whatever it clears
  // (so the climb starts in good time), smoothed, then joined to the design without a corner
  const run = new Float64Array(N);
  let around = 0;
  for (let k = 0; k < N; k++) { const j = (k + 1) % N; run[k] = Math.hypot(lx[j] - lx[k], lz[j] - lz[k]); around += run[k]; }
  // head-room the smoothing may eat into on a sharp rise; and a dip between two rises narrower than about 36 units is
  // bridged, since a beast this size does not drop into every gap between two ridges (a young one skims low over the
  // ground between the stones, so only a gap narrower than its own length is bridged, and it needs less head-room)
  const size = spec.young ? 1 / 3 : 1;
  const bridge = Math.round((spec.young ? 2 : 18) / (around / N));
  const floor = slidingExtreme(slidingExtreme(need.map((value) => value + (spec.young ? 0.3 : 2.5)), bridge, true), bridge, false);
  // it climbs at up to MAX_LIFT ahead of what it clears and comes down more gently after it
  const lift = spec.young ? YOUNG_SLOPE : MAX_LIFT, sink = spec.young ? YOUNG_SLOPE : MAX_SINK;
  for (let lap = 0; lap < 2; lap++) {
    for (let k = 0; k < N; k++) { const j = (k + N - 1) % N; floor[k] = Math.max(floor[k], floor[j] - sink * run[j]); }
  }
  for (let lap = 0; lap < 2; lap++) {
    for (let k = N - 1; k >= 0; k--) { const j = (k + 1) % N; floor[k] = Math.max(floor[k], floor[j] - lift * run[k]); }
  }
  const smoothFloor = blurLoop(floor, (3 * size) / (around / N));
  for (let k = 0; k < N; k++) ly[k] = smoothMax(ly[k], smoothFloor[k], 3 * size);

  // 3. timed: quicker diving, slower climbing, and a young wyvern slower still skimming the ground (the air it rides
  // is thick there), so it is in sight a little longer
  const lowDown = new Float64Array(N);
  if (spec.young) {
    const margin = youngBeatMargin(spec.span) + 0.25;
    for (let k = 0; k < N; k++) lowDown[k] = ly[k] < need[k] + margin ? 1 : 0;
  }
  const slowing = blurLoop(lowDown, 3 / (around / N));
  const at = new Float64Array(N + 1);
  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N, dy = ly[j] - ly[k], step = Math.hypot(run[k], dy);
    const slope = dy / Math.max(step, 1e-6);
    const speed = spec.speed * (1 + 0.45 * Math.max(0, -slope) - 0.25 * Math.max(0, slope)) * (1 - 0.2 * slowing[k]);
    at[k + 1] = at[k] + step / speed;
  }
  const period = at[N];
  const M = TIME_SAMPLES, dt = period / M;
  const px = new Float64Array(M), py = new Float64Array(M), pz = new Float64Array(M);
  for (let j = 0, k = 0; j < M; j++) {
    const t = j * dt;
    while (at[k + 1] < t) k++;
    const f = (t - at[k]) / (at[k + 1] - at[k]), n = (k + 1) % N;
    px[j] = lx[k] + (lx[n] - lx[k]) * f;
    py[j] = ly[k] + (ly[n] - ly[k]) * f;
    pz[j] = lz[k] + (lz[n] - lz[k]) * f;
  }

  // a young wyvern that flies too low to beat its wings glides there, its wings level and banked only a little
  const skimming = new Uint8Array(M);
  if (spec.young) {
    const margin = youngBeatMargin(spec.span) + 0.25;
    for (let j = 0; j < M; j++) skimming[j] = py[j] < lowestFlight(px[j], pz[j], spec.span, true) + margin ? 1 : 0;
  }
  const skims = (start: number, length: number) => { for (let j = 0; j < length; j++) if (skimming[(start + j) % M]) return true; return false; };

  // 4. heading and bank, from the velocity and the turn (differences over a broad step: the samples are fine, and a
  // narrow one would read the interpolation's own corners as tiny jolts)
  const fx = new Float64Array(M), fy = new Float64Array(M), fz = new Float64Array(M), rawBank = new Float64Array(M), vy = new Float64Array(M);
  const h = Math.max(1, Math.round(0.35 / dt));
  for (let j = 0; j < M; j++) {
    const i0 = (j - h + M) % M, i1 = (j + h) % M;
    const vx = (px[i1] - px[i0]) / (2 * h * dt), vyj = (py[i1] - py[i0]) / (2 * h * dt), vz = (pz[i1] - pz[i0]) / (2 * h * dt);
    const ax = (px[i1] - 2 * px[j] + px[i0]) / (h * dt) ** 2, az = (pz[i1] - 2 * pz[j] + pz[i0]) / (h * dt) ** 2;
    vy[j] = vyj;
    const length = Math.hypot(vx, vyj * CLIMB_SHARE, vz) || 1;
    fx[j] = vx / length; fy[j] = (vyj * CLIMB_SHARE) / length; fz[j] = vz / length;
    // left of the heading, level: up x forward
    const flat = Math.hypot(vx, vz) || 1, leftX = vz / flat, leftZ = -vx / flat;
    const lateral = (ax * leftX + az * leftZ) * METRES;
    rawBank[j] = Math.max(-MAX_BANK, Math.min(MAX_BANK, -Math.atan2(lateral, GRAVITY) * BANK_GAIN));
  }
  // (a young one, quick round the tight corners of its circuit, rolls into them over a little longer)
  const bank = blurLoop(rawBank, (spec.young ? 0.5 : 0.3) / dt);
  if (spec.young) {
    // the most it may bank eases down to YOUNG_LOW_BANK over about a second before it flies low, and back up after
    const near = blurLoop(slidingExtreme(Float64Array.from(skimming), Math.round(1 / dt), true), 0.3 / dt);
    for (let j = 0; j < M; j++) {
      const share = near[j] > 0.98 || skimming[j] ? 1 : near[j], limit = MAX_BANK + (YOUNG_LOW_BANK - MAX_BANK) * share;
      bank[j] = Math.max(-limit, Math.min(limit, bank[j]));
    }
  }

  // 5. wingbeats: it beats its wings to climb and glides to come down; holding its height it beats and soars by turns
  // (the lava's heat rises under it), with a slow beat now and then in a long glide; a climb beats faster. Every
  // stretch of beating holds a whole number of beats, so the wings always come back to the glide pose before a glide.
  const beating = new Uint8Array(M);
  const soar = period / Math.max(1, Math.round(period / 16));
  for (let j = 0; j < M; j++) {
    const climb = vy[j] / spec.speed;
    beating[j] = skimming[j] ? 0 : climb > 0.04 ? 1 : climb < -0.04 ? 0 : Math.sin((TAU * j * dt) / soar + spec.drift) > -0.15 ? 1 : 0;
  }
  const runs = (value: number) => {
    // stretches of `value`, as [start, length] in samples, round the loop
    const list: [number, number][] = [];
    const startAt = beating.findIndex((v) => v !== value);
    if (startAt < 0) return beating[0] === value ? [[0, M] as [number, number]] : list;
    for (let j = 0, from = -1; j <= M; j++) {
      const index = (startAt + j) % M, inside = j < M && beating[index] === value;
      if (inside && from < 0) from = j;
      if (!inside && from >= 0) { list.push([(startAt + from) % M, j - from]); from = -1; }
    }
    return list;
  };
  const fill = (start: number, length: number, value: number) => { for (let j = 0; j < length; j++) beating[(start + j) % M] = value; };
  // a glide too short to see becomes beating (unless it is low), and a burst of beats too short to finish one becomes
  // gliding
  for (const [start, length] of runs(0)) if (length * dt < 1.4 && !skims(start, length)) fill(start, length, 1);
  for (const [start, length] of runs(1)) if (length * dt < 1.8 * spec.beat) fill(start, length, 0);
  // a slow beat every six seconds or so in a long glide
  const slow: [number, number][] = [];
  for (const [start, length] of runs(0)) {
    const seconds = length * dt, count = Math.floor((seconds - 3) / 6);
    for (let i = 0; i < count; i++) {
      const middle = start + Math.round(((i + 1) / (count + 1)) * length), from = (middle - Math.round(1.1 / dt) + M) % M;
      // not on the way down: a wyvern coming down glides
      let sinking = false;
      for (let j = 0; j < Math.round(2.2 / dt) && !sinking; j++) sinking = vy[(from + j) % M] < -0.04 * spec.speed;
      if (!skims(from, Math.round(2.2 / dt)) && !sinking) slow.push([from, Math.round(2.2 / dt)]);
    }
  }
  const rate = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const climb = Math.max(0, Math.min(1, vy[j] / (0.3 * spec.speed)));
    rate[j] = beating[j] ? 1 / (spec.beat + (spec.climbBeat - spec.beat) * climb) : 0;
  }
  const beats = new Float64Array(M + 1);
  const ease = Math.round(0.4 / dt);
  const stretches: [number, number, boolean][] = [...runs(1).map(([s, l]): [number, number, boolean] => [s, l, false]),
    ...slow.map(([s, l]): [number, number, boolean] => [s, l, true])];
  const step = new Float64Array(M);
  for (const [start, length, isSlow] of stretches) {
    // the beat rate over the stretch, eased in and out at its ends (a stretch the whole way round has none), scaled
    // to a whole number of beats
    const whole = length >= M;
    const weights = new Float64Array(length);
    let total = 0;
    for (let j = 0; j < length; j++) {
      const edge = whole ? 1 : Math.min(1, Math.min(j + 0.5, length - j - 0.5) / Math.max(1, ease));
      weights[j] = (isSlow ? 1 / 2.2 : rate[(start + j) % M]) * edge * edge * (3 - 2 * edge) * dt;
      total += weights[j];
    }
    const count = isSlow ? 1 : Math.max(1, Math.round(total));
    for (let j = 0; j < length; j++) step[(start + j) % M] += (weights[j] * count) / total;
  }
  for (let j = 0; j < M; j++) beats[j + 1] = beats[j] + step[j];
  // the loop's beats come to a whole number, so the wings line up when it starts round again
  const perLoop = Math.round(beats[M]);
  const correction = (perLoop - beats[M]) / M;
  for (let j = 1; j <= M; j++) beats[j] += correction * j;
  // A stretch of beats can run round the end of the loop, so the count at the loop's start may sit part way through a
  // beat. Counted from a glide instead, every glide lies a whole number of beats on, its wings in the glide pose.
  const glideAt = step.findIndex((value) => value === 0);
  if (glideAt >= 0) {
    const offset = beats[glideAt] - Math.floor(beats[glideAt]);
    for (let j = 0; j <= M; j++) beats[j] -= offset;
  }
  const flapping = new Float64Array(M);
  for (let j = 0; j < M; j++) flapping[j] = Math.min(1, step[j] / (dt / spec.beat));

  let low = Infinity, high = -Infinity;
  for (let j = 0; j < M; j++) { low = Math.min(low, py[j]); high = Math.max(high, py[j]); }

  // 6. the opening's lift comes off in one go, LIFT_RELEASE seconds of flight, beginning at the first moment after the
  // opening is over from which it flies all of that time away from LIFT_HOLD (the band behind White's side, which
  // White's pulled-back camera looks across at the board). So it is never part way down there: over that band it flies
  // with all of the lift, high over that camera, or with none.
  const away = new Float64Array(M);
  for (let k = 0; k < 2 * M; k++) {
    // seconds of flight away from the band from each sample on, counted back round the loop twice
    const j = (2 * M - 1 - k) % M, next = (j + 1) % M;
    away[j] = pz[j] > LIFT_HOLD ? 0 : Math.min(period, (k === 0 ? 0 : away[next]) + dt);
  }
  const shift = spec.delay + (spec.delayShare ?? 0) * period;
  const liftStartAfter = (time: number) => {
    for (let t = time; t < time + 2 * period; t += dt / 4) {
      const j = Math.floor(wrap(t + shift, period) / dt) % M;
      // a sample in from the start of the run, so the whole of the release falls inside it
      if (away[j] >= LIFT_RELEASE + 2 * dt) return t + dt;
    }
    return time;
  };
  const defaultLiftStart = spec.openingLift ? liftStartAfter(OPENING_OVER[0]) : -Infinity;
  const liftAt = (time: number, start: number) => start === -Infinity ? 0
    : time <= start ? spec.openingLift : spec.openingLift * (1 - smoothstep(start, start + LIFT_RELEASE, time));

  return {
    spec, period, band: [low, high], liftStartAfter,
    sample(time, out, liftStart = defaultLiftStart) {
      const local = (wrap(time + spec.delay + (spec.delayShare ?? 0) * period, period) / period) * M;
      const j = Math.floor(local) % M, f = local - Math.floor(local);
      const i0 = (j + M - 1) % M, i1 = j, i2 = (j + 1) % M, i3 = (j + 2) % M;
      const spline = (v: Float64Array) => {
        const p0 = v[i0], p1 = v[i1], p2 = v[i2], p3 = v[i3];
        return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
      };
      const lifted = spec.openingLift ? liftAt(time, liftStart) : 0;
      out.position[0] = spline(px); out.position[1] = spline(py) + lifted; out.position[2] = spline(pz);
      const ox = fx[i1] + (fx[i2] - fx[i1]) * f, oy = fy[i1] + (fy[i2] - fy[i1]) * f, oz = fz[i1] + (fz[i2] - fz[i1]) * f;
      const length = Math.hypot(ox, oy, oz) || 1;
      out.forward[0] = ox / length; out.forward[1] = oy / length; out.forward[2] = oz / length;
      out.bank = bank[i1] + (bank[i2] - bank[i1]) * f;
      const counted = beats[j] + (beats[j + 1] - beats[j]) * f;
      // a slow drift of the wings about the pose, so a glide is not held like a statue
      const drift = 0.018 * Math.sin((TAU * time) / 3.4 + spec.drift);
      out.phase = wrap(GLIDE_PHASE + counted + drift, 1);
      out.flapping = flapping[i1] + (flapping[i2] - flapping[i1]) * f;
      return out;
    },
  };
}

export function flightSample(): FlightSample {
  return { position: [0, 0, 0], forward: [0, 0, 1], bank: 0, phase: GLIDE_PHASE, flapping: 0 };
}

// --- the flock ---------------------------------------------------------------------------------------------------------

/** A small seeded generator (mulberry32): the same seed always plans the same flock. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A circuit of its own, in degrees, before the seed varies it. */
interface Circuit {
  span: number; centre: [number, number]; radius: number; shape: [number, number, number, number]; turn: 1 | -1;
  bearing: number; height: number; waves: [number, number, number][];
  swoop: { bearing: number; depth: number; width: number } | null; speed: number;
  young?: boolean; openingLift?: number; path?: Vec3[];
}
/** A wingman: the circuit of the wyvern at `follows`, a little wider and higher, `delay` seconds behind it. */
interface Wingman { follows: number; span: number; wider: number; higher: number; delay: number }
const deg = (value: number) => (value * Math.PI) / 180;

/** Young wyverns that fly the circuit of the one at `follows` behind it, `share` of a loop apart: the same size, so
 * exactly the same flight, and never closer than that share of the loop to one another. */
interface Follower { follows: number; share: number }

/**
 * The young wyverns' circuit (x, height, z). The play cameras look down on the board, the top of their pictures twelve
 * degrees below the horizon, so past the board they see the arena's ground and a little air just over it. With the
 * board, its figures and crests kept clear from every view (KEEP_OUT), that air is found in a few places: a band just
 * over the ground behind each far edge, and down the trench along the board's west side (seen from Black's camera at
 * its south end, from White's at its north end). The young wyverns glide through them one after another as low as they
 * may (a point set at -4 is flown as low as lowestFlight allows): diving in from the east along the band behind White's
 * half, round into the trench and up it, over the rubble at its north end and along the band behind Black's half, then
 * climbing away east, back south high over the arena's east side, and round to dive in again.
 */
const ROUND: Vec3[] = [
  [18, 8.5, 17.5], [12.5, 4.5, 15.5], [6, -4, 13.2], [0, -4, 13.1], [-4, -4, 12.6], [-7, -4, 10.6], [-8.6, -4, 7], [-8.7, -4, 2],
  [-8.8, -4, -3], [-9.5, -4, -7.5], [-10, -4, -10.5], [-12, 4, -13.5], [-12.8, 7.5, -16], [-8.5, 10, -16.8], [-3.5, 12.5, -12.5], [3, 14.5, -3],
  [9.5, 14.5, 5], [16.5, 12, 9.5], [20.5, 10.5, 14],
];
/** The young wyverns fly low through the air in front of the opening's first shot and behind its musters, so until the
 * opening is surely over they fly this much higher (OPENING_OVER). */
const OPENING_LIFT = 12;
const youngCircuit = (path: Vec3[], span: number, speed: number): Circuit => ({
  span, centre: [0, 0], radius: 0, shape: [0, 0, 0, 0], turn: 1, bearing: 0, height: 0, waves: [], swoop: null, speed,
  young: true, openingLift: OPENING_LIFT, path,
});

/**
 * The flock, in the order the quality tiers take them (arena-wyverns.ts FLOCK_SIZE: the first 8, 12 or 16). The young
 * wyverns are the ones the play cameras see; the adults circle low over the lava moat, 55 to 70 units out, at about the
 * spires' height, lifted by buildFlight over the spires and the stacks on the eclipse side, and are seen from the
 * opening, the duels and any wider view. Low has two young wyverns down the west trench, one along each far band, a pair
 * of moat circuits, a diver into the moat and one far out; medium adds a young one down the trench and one along each
 * band, and a wingman; high a fourth down the trench, a ring over the spires, a second far one and a second diver.
 * Bearings in degrees.
 */
const DESIGNS: (Circuit | Wingman | Follower)[] = [
  youngCircuit(ROUND, 3.5, 4.2),
  { follows: 0, share: 0.25 },
  { span: 13.6, centre: [0, 0], radius: 60, shape: [0.06, 40, 0.04, 200], turn: -1, bearing: 300, height: 12, waves: [[4, 3, 0.5]], swoop: null, speed: 8.5 },
  { span: 12.8, centre: [-3, 4], radius: 63, shape: [0.07, 250, 0.04, 90], turn: 1, bearing: 200, height: 10, waves: [[3, 2, 0]], swoop: null, speed: 8.8 },
  { follows: 0, share: 0.5 },
  { follows: 0, share: 0.75 },
  { span: 13.1, centre: [0, 0], radius: 65, shape: [0.04, 10, 0.03, 150], turn: 1, bearing: 20, height: 34, waves: [[4, 1, 1]], swoop: { bearing: 255, depth: 32, width: 0.09 }, speed: 8.6 },
  { span: 14.0, centre: [0, 10], radius: 118, shape: [0.1, 60, 0.05, 0], turn: 1, bearing: 230, height: 26, waves: [[5, 2, 0]], swoop: null, speed: 10 },
  { follows: 0, share: 0.125 },
  { follows: 0, share: 0.625 },
  { follows: 2, span: 12.2, wider: 4, higher: 3, delay: -3.5 },
  { span: 14.4, centre: [4, -6], radius: 48, shape: [0.1, 300, 0.05, 30], turn: -1, bearing: 120, height: 30, waves: [[4, 2, 2]], swoop: null, speed: 8.0 },
  { follows: 0, share: 0.375 },
  { follows: 0, share: 0.875 },
  { span: 15.0, centre: [-10, -10], radius: 135, shape: [0.08, 300, 0.05, 120], turn: -1, bearing: 30, height: 40, waves: [[5, 2, 2]], swoop: null, speed: 10.5 },
  { span: 13.2, centre: [-2, 0], radius: 62, shape: [0.06, 200, 0.05, 60], turn: -1, bearing: 330, height: 36, waves: [[4, 1, 1]], swoop: { bearing: 135, depth: 30, width: 0.1 }, speed: 8.8 },
];

/** How many wyverns a flock can hold (the high tier flies them all). */
export const FLOCK_MAX = DESIGNS.length;
/** How many fly at each quality tier (low, medium, high): the first of DESIGNS, so low has four young and four adults. */
export const FLOCK_SIZE = [8, 12, 16] as const;

/** The flock's circuits for a seed: the designs above, each varied a little by the seed. */
export function planFlock(seed: number): FlightSpec[] {
  const random = seededRandom(seed);
  const vary = (value: number, share: number) => value * (1 + (random() * 2 - 1) * share);
  const swing = (degrees: number, by: number) => deg(degrees + (random() * 2 - 1) * by);
  const wings = (span: number) => {
    // a bigger wyvern beats its wings more slowly (as the Queen's does: rites/wyvern.ts IDLE_BEAT)
    const size = Math.sqrt(span / 13);
    return { beat: 1.32 * size * vary(1, 0.06), climbBeat: 0.92 * size * vary(1, 0.06), drift: random() * TAU };
  };
  const specs: FlightSpec[] = [];
  for (const design of DESIGNS) {
    if ("share" in design) {
      // the same flight exactly, a share of the loop on: only its wings beat in a time of their own
      const leader = specs[design.follows];
      specs.push({ ...leader, delayShare: design.share, ...wings(leader.span) });
      continue;
    }
    if ("follows" in design) {
      // the same circuit, flown a little wider and faster so it keeps its place behind the leader
      const leader = specs[design.follows];
      const span = vary(design.span, 0.06), radius = leader.radius + design.wider;
      specs.push({ ...leader, span, radius, height: leader.height + design.higher, speed: (leader.speed * radius) / leader.radius,
                   delay: design.delay, ...wings(span) });
      continue;
    }
    const span = vary(design.span, 0.06);
    if (design.path) {
      // a young wyvern's low stretch stays where it was drawn; the seed moves only the rest of its circuit a little
      const path = design.path.map(([x, y, z]): Vec3 => y < 0 ? [x, y, z]
        : [x + (random() * 2 - 1) * 0.6, y + (random() * 2 - 1) * 0.6, z + (random() * 2 - 1) * 0.6]);
      specs.push({ ...design, path, span, speed: vary(design.speed, 0.05), delay: 0, ...wings(span), young: true,
                   openingLift: design.openingLift ?? 0 });
      continue;
    }
    specs.push({
      span,
      centre: [design.centre[0] + (random() * 2 - 1) * 2, design.centre[1] + (random() * 2 - 1) * 2],
      radius: vary(design.radius, 0.05),
      shape: [design.shape[0], swing(design.shape[1], 15), design.shape[2], swing(design.shape[3], 15)],
      turn: design.turn,
      bearing: swing(design.bearing, 8),
      height: vary(design.height, 0.05),
      waves: design.waves.map(([amplitude, count, phase]): [number, number, number] => [vary(amplitude, 0.15), count, phase + (random() * 2 - 1) * 0.4]),
      swoop: design.swoop ? { bearing: swing(design.swoop.bearing, 6), depth: vary(design.swoop.depth, 0.08), width: design.swoop.width } : null,
      speed: vary(design.speed, 0.06),
      delay: 0,
      ...wings(span),
      young: false,
      openingLift: 0,
    });
  }
  return specs;
}

/** The seed the arena flies: any seed gives a flock that keeps clear of the board and everything standing. */
export const FLOCK_SEED = 1111;
