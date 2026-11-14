// The master plan of Monolith Wilds.
//
// Coordinate system (three.js default): +x = east, -z = north, +y = up. 1 unit = 1 metre.
// Water level is y = 0 everywhere; any terrain below 0 is flooded.
//
// Every landmark module receives its `site` entry from here. Terrain (terrain-height.js) is
// sculpted around these sites, so positions here and the terrain features must stay in sync.

export const WORLD = {
  /** Terrain extends ±half in x and z. */
  half: 4600,
  /** Soft limit for the free camera (beyond this the outer mountain ring rises). */
  playRadius: 3300,
  /** Hard ceiling for the free camera. */
  maxAltitude: 2400,
  waterLevel: 0,
  /** Default time of day in hours (golden hour). */
  defaultHour: 17.6,
};

/** The great lake ("The Mirror") in the middle of the basin. */
export const LAKE = { x: 80, z: 40, radius: 820 };

/**
 * Canyon polyline (north -> south-west into the lake). The river at its floor is at water level.
 * Points are [x, z]. The Vertebral Span crosses it near the third point.
 */
export const CANYON = [
  [2750, -2950],
  [2300, -1600],
  [1950, -720],
  [1720, 0],
  [1610, 520],
  [1230, 810],
  [800, 520],
];

/** The northern escarpment that the Honeycomb Cloister is carved into. */
export const ESCARPMENT = {
  xStart: -2750,
  xEnd: -650,
  /** z of the cliff line at x. Land north (smaller z) of this rises ~400 m. */
  baseZ: -1350,
  rise: 400,
};

/**
 * Landmarks. Fields:
 *   id           module id (src/landmarks/<id>.js)
 *   name/subtitle  shown by the discovery UI
 *   x, z         site centre (ground height comes from heightAt)
 *   radius       footprint radius (metres) — geometry should stay roughly inside it
 *   clear        radius kept free of scattered vegetation / rocks / ruins (0 = allow)
 *   facing       yaw in radians the landmark "faces" (0 = looking toward +z / south)
 *   discover     distance at which the discovery title appears
 */
export const LANDMARKS = [
  {
    id: 'loom',
    name: 'The Loom of Hours',
    subtitle: 'A ring of stone that hangs from nothing, weaving threads no one alive can read.',
    x: 320, z: -1750, radius: 380, clear: 300, facing: 0, discover: 1300,
  },
  {
    id: 'wardens',
    name: 'The Kneeling Wardens',
    subtitle: 'Five colossi bowed toward the water, waiting for a command that never came.',
    x: -250, z: -900, radius: 330, clear: 300, facing: 0.25, discover: 900,
  },
  {
    id: 'observatory',
    name: 'The Drowned Observatory',
    subtitle: 'Its dome still turns toward a sky that has long since changed.',
    x: 330, z: 180, radius: 220, clear: 0, facing: -0.6, discover: 700,
  },
  {
    id: 'stair',
    name: 'The Stair to Nowhere',
    subtitle: 'Eleven thousand steps. The door at the top opens onto air.',
    x: -420, z: 300, radius: 160, clear: 0, facing: 0.9, discover: 800,
  },
  {
    id: 'choir',
    name: 'The Choir of Monoliths',
    subtitle: 'When the wind crosses the plain, the stones answer.',
    x: -1750, z: -150, radius: 600, clear: 520, facing: 0, discover: 1100,
  },
  {
    id: 'needles',
    name: 'The Needle City',
    subtitle: 'A city built only upward, as though the ground were a rumour.',
    x: 1350, z: -1150, radius: 470, clear: 440, facing: 0.4, discover: 1400,
  },
  {
    id: 'span',
    name: 'The Vertebral Span',
    subtitle: 'A bridge grown rather than built; its bones still hold the warmth of the day.',
    x: 1720, z: 0, radius: 380, clear: 320, facing: Math.PI / 2, discover: 1000,
  },
  {
    id: 'temple',
    name: 'The Descending Temple',
    subtitle: 'Built from the sky downward. It stopped one step short of the earth.',
    x: -450, z: 1650, radius: 260, clear: 220, facing: -0.4, discover: 1200,
  },
  {
    id: 'orrery',
    name: 'The Stone Orrery',
    subtitle: 'A clockwork of mountains, still keeping the hours of a vanished calendar.',
    x: -1800, z: 1150, radius: 470, clear: 430, facing: 0, discover: 1300,
  },
  {
    id: 'monastery',
    name: 'The Honeycomb Cloister',
    subtitle: 'Ten thousand cells cut into the cliff, each facing the same unseen star.',
    x: -1250, z: -1440, radius: 380, clear: 260, facing: 0, discover: 1100,
  },
  {
    id: 'isles',
    name: 'The Unmoored Isles',
    subtitle: 'Pieces of the land that forgot the weight of the world.',
    x: 1350, z: 1650, radius: 520, clear: 0, facing: 0, discover: 1300,
  },
];

export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

/**
 * Where the camera starts: high over the south-western hills, looking north-east across the Mirror.
 * At golden hour the sun sits behind the left shoulder, raking across the frame: the escarpment
 * falls on the left, the Loom and the Wardens at the left third, the Stair's islet and the
 * Observatory mid-lake, the red peaks lit on the right, the natural arch in the foreground.
 */
export const SPAWN = {
  position: [-1000, 0, 1250], // y is resolved to ground + offset at runtime (ground ≈ 93 m)
  heightAboveGround: 237,
  lookAt: [414, 140, -627],
};

/**
 * True if (x, z) lies inside a landmark's clear radius (+ margin).
 * Scatter modules (vegetation, rocks, ruins) must call this before placing anything.
 */
export function isReserved(x, z, margin = 0) {
  for (let i = 0; i < LANDMARKS.length; i++) {
    const l = LANDMARKS[i];
    if (l.clear <= 0) continue;
    const dx = x - l.x;
    const dz = z - l.z;
    const r = l.clear + margin;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** Nearest landmark to (x, z) and its horizontal distance. */
export function nearestLandmark(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const l of LANDMARKS) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return { landmark: best, distance: bestD };
}
