/** Measured original-source path, not a replacement site/certificate. Admission
 * requires fresh original-triangle revalidation and exact source/clip identities.
 * Private full audit SHA is retained; no source mesh/triangle data is bundled. */
const candidate={
  "sourceSha256": "3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28",
  "siteSha256": "fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475",
  "residentId": "ealdholt-swineherd",
  "fromAnchorId": "candidate-v1-door-3-positive-1005",
  "toAnchorId": "candidate-v1-well-0-320-6",
  "requiredClip": "carry_bucket_walk",
  "sourceGroundPolyline": [
    [
      58.67926104137864,
      1,
      11.814426661561345
    ],
    [
      60.6,
      1,
      16.331444391074704
    ],
    [
      60.4646508269657,
      1,
      16.935349173034304
    ],
    [
      60.03763027179929,
      1,
      17.462369728200713
    ],
    [
      57.84597692862102,
      1,
      19.8
    ],
    [
      57.09499148868226,
      1,
      20.1
    ],
    [
      46.800000000000004,
      1,
      24.5
    ],
    [
      44.2,
      1,
      24.6
    ],
    [
      27.75683269974729,
      1,
      25.643167300252717
    ],
    [
      27.153904420833783,
      1,
      25.94609557916622
    ],
    [
      22.29241881789772,
      1,
      28.10758118210228
    ],
    [
      18.6,
      1,
      31.73100762414044
    ],
    [
      18.535576575978354,
      1,
      38.464423424021646
    ],
    [
      18.44510977810164,
      1,
      38.85489022189836
    ],
    [
      17.700000000000003,
      1,
      41.5
    ],
    [
      17.300000000000004,
      0.9999999999999964,
      41.8
    ],
    [
      16.6,
      1,
      41.9
    ],
    [
      16.1,
      1,
      41.5
    ],
    [
      16,
      0.9999999999999964,
      41
    ],
    [
      13.565125451925766,
      1.0000000000000036,
      34.41388139803304
    ]
  ],
  "lengthMetres": 70.92275691575249,
  "certificateSha256": "c3588eff53b533293cb410451401933c2e82d5a13f1c5d4dea25350cd962cbb0",
  "body": {
    "radius": 0.6231633375592951,
    "height": 1.9020472484796265,
    "margin": 0.005,
    "lift": 0.02
  },
  "files": {
    "crowd-v1/residents/ealdholt-swineherd.glb": "c3412424009968e83dde87bc6d0119b2dd5f12cd27dd641edc84b984ef985678",
    "crowd-v1/residents/ealdholt-swineherd.json": "4f6b57d155e3796669d27822da15eab2f3f1658a5f905b4d22453a5aa7be6063",
    "crowd-v1/clips/crowd-clips-adult-male-v1.glb": "ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5",
    "crowd-v1/clips/manifest.json": "f1550ee2da8f9e4e2332e8981a8ae1e16b244e6094e25a44416a488125868bbe",
    "crowd-v1/props/kits.json": "1c13206f5a53aeb589cafcf9c6d7c776dec048d1ff78798410b74494b1d8dc1f",
    "crowd-v1/props/crowd-props-craft-v1.glb": "9295ac763d90a7622b90d32f7d7f6e590a627481984f5680e5cd4932b6895873",
    "crowd-v1/props/crowd-props-everyday-v1.glb": "7136c2a4f0e88504352021ef81444deccdd21c47431de2ebdcf207cdd63626bc",
    "crowd-v1/props/crowd-props-farm-v1.glb": "6fb38361fb5149f22c723bf430c755dbaf71f756357314d9c942baaf0e880796",
    "crowd-v1/props/crowd-props-guard-v1.glb": "d9c0148847ef17fa1479e2339224dacce8e7833d3f2ec199dd6c312abfe33ccd",
    "crowd-v1/props/crowd-props-letters-and-care-v1.glb": "60f852e5778b0600eadce79fa1495af7a092612a78d72777097f9a6c709bc4bb",
    "crowd-v1/props/crowd-props-textile-v1.glb": "08fd795be027d5cac2507e46361028cbac58698c67bc1a9b6c672e1bd3331aec",
    "crowd-v1/props/crowd-props-workplace-v1.glb": "e0fba22ea8442981124d53973427a37849c638d015c2de16288c53fcad394548"
  },
  "clipMeasurement": {
    "radiusMetres": 0.573163337559295,
    "heightMetres": 1.8520472484796264,
    "minimumBodyYMetres": -0.0006525555356455998,
    "placedBelowGround": false
  },
  "additionalRoutePaddingMetres": 0.05
} as const;
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
export const EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE=freeze(candidate);
