/** Generated only from the real published-rig export and full-mesh measurement.
 * Null is an explicit hold, never guessed bounds or a runtime idle substitute. */
export interface GuardWatchMeasuredBounds {
  readonly radiusMetres: number; readonly heightMetres: number;
  readonly minimumBodyYMetres: number; readonly minimumPropYMetres: number;
}
export interface PublishedGuardWatch {
  readonly version: 1;
  readonly residentId: string;
  readonly file: string;
  readonly sources: Readonly<Record<string,string>>;
  readonly seconds: number;
  readonly fadeSeconds: number;
  readonly soles: Readonly<Record<'l'|'r',readonly {readonly bone:string;readonly point:readonly[number,number,number]}[]>>;
  readonly handoff:{readonly leftClosedByPhase:number;readonly rightReleaseAfterPhase:number};
  readonly grips:Readonly<Record<'l'|'r',readonly number[]>>;
  readonly measurements: Readonly<Record<'desktop'|'quest', {
    readonly clips: Readonly<Record<string,GuardWatchMeasuredBounds>>;
    readonly blends: GuardWatchMeasuredBounds;
    readonly maximumHandGapMetres: number;
    readonly maximumGripAngleDegrees: number;
    readonly maximumFootCorrectionMetres:number;
    readonly fps: 60;
    readonly includesActualSkinAndHeldSpear: true;
  }>>;
}
function freeze<T>(v:T):T { if(v && typeof v==="object") { for(const c of Object.values(v))freeze(c); Object.freeze(v); } return v; }
export const PUBLISHED_GUARD_WATCH: PublishedGuardWatch | null = freeze({
  "version": 1,
  "residentId": "ealdholt-garrison-spearman",
  "file": "crowd-v1/addons/guard-watch-compact-v1/guard-watch-adult-male-compact-v1.glb",
  "sources": {
    "crowd-v1/clips/crowd-clips-adult-male-v1.glb": "ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5",
    "crowd-v1/residents/ealdholt-garrison-spearman.glb": "faee99f94a1b49f022dd8363945ea3d91c9db5536adcedecd035fb0246ffbce5",
    "crowd-v1/residents/ealdholt-garrison-spearman.json": "36f23cef1d2ec6be40570f000df30c41303f48de4bf5b96f137561b95ce7f762",
    "crowd-v1/props/crowd-props-guard-v1.glb": "d9c0148847ef17fa1479e2339224dacce8e7833d3f2ec199dd6c312abfe33ccd",
    "crowd-v1/addons/guard-watch-compact-v1/guard-watch-adult-male-compact-v1.glb": "3bcd07e9f86a1574e3ff139a37730f43fdbc91cff8f5e7e3a943ab612071cb0a",
    "crowd-v1/addons/guard-watch-compact-v1/provenance.json": "2fb2654feadd5ed0f8d9c3cedf0139e465bdc70e3151499cb8d8e69ac90fa331",
    "crowd-v1/addons/guard-watch-compact-v1/measurement.json": "476904d5e9df8b4fb38731ab2bf156a898b6a0092e19e5ac35198771291572b7"
  },
  "soles": {
    "l": [
      {
        "bone": "foot_l",
        "point": [
          -0.0021213055588304996,
          0.0035072173923254013,
          0.09096220880746841
        ]
      },
      {
        "bone": "foot_l",
        "point": [
          -0.0001968173310160637,
          0.1507275402545929,
          0.018141284584999084
        ]
      },
      {
        "bone": "toes_l",
        "point": [
          0.014588342979550362,
          0.05981430411338806,
          0.020265989005565643
        ]
      }
    ],
    "r": [
      {
        "bone": "foot_r",
        "point": [
          -0.009128215722739697,
          0.0023344201035797596,
          0.09166451543569565
        ]
      },
      {
        "bone": "foot_r",
        "point": [
          0.0001968173310160637,
          0.1507275402545929,
          0.018141284584999084
        ]
      },
      {
        "bone": "toes_r",
        "point": [
          -0.0034990981221199036,
          0.058707620948553085,
          0.026079220697283745
        ]
      }
    ]
  },
  "grips": {
    "r": [
      0.5777,
      -0.0509,
      -0.8147,
      0,
      0.8146,
      0.0996,
      0.5714,
      0,
      0.0521,
      -0.9937,
      0.099,
      0,
      0.466,
      0.1512,
      0.3537,
      1
    ],
    "l": [
      0.5777,
      0.0509,
      0.8147,
      0,
      -0.8146,
      0.0996,
      0.5714,
      0,
      -0.0521,
      -0.9937,
      0.099,
      0,
      0.202,
      0.0695,
      -0.1148,
      1
    ]
  },
  "handoff": {
    "leftClosedByPhase": 0.32,
    "rightReleaseAfterPhase": 0.34
  },
  "seconds": 1.2,
  "fadeSeconds": 0.12,
  "measurements": {
    "desktop": {
      "clips": {
        "guard_patrol_walk": {
          "radiusMetres": 0.5343557601088281,
          "heightMetres": 3.1270282508522014,
          "minimumBodyYMetres": 0.0008908239048367,
          "minimumPropYMetres": 0.6700227722353413,
          "samples": 85
        },
        "guard_stand_watch_d": {
          "radiusMetres": 0.5506471427397078,
          "heightMetres": 2.4377422734226464,
          "minimumBodyYMetres": 0.0029731711637478657,
          "minimumPropYMetres": -0.0007841988869330407,
          "samples": 541
        },
        "guard_stand_watch_d_compact_enter_v1": {
          "radiusMetres": 0.5748225724277701,
          "heightMetres": 3.1066786379118247,
          "minimumBodyYMetres": 0.0020512722420762395,
          "minimumPropYMetres": -0.0003522549861878499,
          "samples": 74
        },
        "guard_stand_watch_d_compact_exit_v1": {
          "radiusMetres": 0.5748225664435662,
          "heightMetres": 3.106750590891252,
          "minimumBodyYMetres": 0.002051273506772371,
          "minimumPropYMetres": -0.00034270537054470473,
          "samples": 74
        }
      },
      "blends": {
        "radiusMetres": 0.5506471427397078,
        "heightMetres": 3.1270282508522014,
        "minimumBodyYMetres": 0.0005833790272337468,
        "minimumPropYMetres": -0.0073956847635152645
      },
      "maximumHandGapMetres": 0.00003184363955492257,
      "maximumGripAngleDegrees": 0.003648544713771318,
      "maximumFootCorrectionMetres": 0.0635802212177056,
      "fps": 60,
      "includesActualSkinAndHeldSpear": true
    },
    "quest": {
      "clips": {
        "guard_patrol_walk": {
          "radiusMetres": 0.5343557601088281,
          "heightMetres": 3.1270282508522014,
          "minimumBodyYMetres": 0.0008908239048367,
          "minimumPropYMetres": 0.6700227722353413,
          "samples": 85
        },
        "guard_stand_watch_d": {
          "radiusMetres": 0.5506471427397078,
          "heightMetres": 2.4377422734226464,
          "minimumBodyYMetres": 0.0029731711637478657,
          "minimumPropYMetres": -0.0007841988869330407,
          "samples": 541
        },
        "guard_stand_watch_d_compact_enter_v1": {
          "radiusMetres": 0.5748225724277701,
          "heightMetres": 3.1066786379118247,
          "minimumBodyYMetres": 0.0020512722420762395,
          "minimumPropYMetres": -0.0003522549861878499,
          "samples": 74
        },
        "guard_stand_watch_d_compact_exit_v1": {
          "radiusMetres": 0.5748225664435662,
          "heightMetres": 3.106750590891252,
          "minimumBodyYMetres": 0.002051273506772371,
          "minimumPropYMetres": -0.00034270537054470473,
          "samples": 74
        }
      },
      "blends": {
        "radiusMetres": 0.5506471427397078,
        "heightMetres": 3.1270282508522014,
        "minimumBodyYMetres": 0.0005833790272337468,
        "minimumPropYMetres": -0.0073956847635152645
      },
      "maximumHandGapMetres": 0.00003184363955492257,
      "maximumGripAngleDegrees": 0.003648544713771318,
      "maximumFootCorrectionMetres": 0.0635802212177056,
      "fps": 60,
      "includesActualSkinAndHeldSpear": true
    }
  }
});
