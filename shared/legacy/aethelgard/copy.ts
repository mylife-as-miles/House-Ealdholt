import { EALDHOLT_HOUSE } from "./house";

/** Shared Desktop/Quest copy for the opt-in, visit-only village prototype.
 * It makes no claim of house initialization, saved progression or live story. */
export const EALDHOLT_PREVIEW_COPY = {
  title: "MY LEGACY",
  previewLabel: "Village preview",
  visitOnly: "Your design lasts for this preview session. Existing house saves stay unchanged.",
  steps: {
    intro: "Your house",
    banner: "Your banner",
    village: "The village",
  },
  intro: {
    title: EALDHOLT_HOUSE.name,
    speaker: "HOUSE STEWARD",
    body: "Your house is known here. Beyond this village, its influence is modest. Choose the banner we will carry.",
    continue: "Shape your banner",
    skip: "Explore the village",
  },
  banner: {
    title: "Your banner",
    body: "Choose or edit a banner design for this visit.",
    preset: "Banner design",
    edit: "Edit banner",
    customize: "Customize design",
    unchosen: "No design chosen yet.",
    updated: "Banner design updated for this visit.",
    designRequired: "Choose a design to preview your banner.",
    continue: "Explore the village",
    skip: "Design later",
  },
  fields: {
    division: "Field pattern",
    firstField: "First field colour",
    secondField: "Second field colour",
    ordinary: "Band or border",
    ordinaryColour: "Band colour",
    charge: "Emblem",
    chargeColour: "Emblem colour",
  },
  village: {
    title: EALDHOLT_HOUSE.name,
    body: "Explore the village.",
    viewHelp: "Orbit or zoom to explore the village.",
    desktopViewHelp: "Drag to orbit. Scroll to zoom.",
    questViewHelp: "Use the view controls to orbit or zoom.",
  },
  controls: {
    view: "Village view",
    orbitLeft: "Orbit left",
    orbitRight: "Orbit right",
    tiltUp: "Tilt up",
    tiltDown: "Tilt down",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetView: "Reset view",
  },
  actions: {
    home: "Return to Home",
    play: "Return to Play",
    back: "Back",
    retry: "Try again",
    pause: "Pause",
    resume: "Resume",
  },
  loading: {
    title: "Preparing the village",
    body: "Preparing your view of the village.",
  },
  error: {
    title: "Village unavailable",
    body: "The village could not be loaded. Try again or return to the menu.",
  },
} as const;

/** My Legacy's own loading screen, shown while the inherited village is
 * prepared: Desktop draws it full-screen with a bar; Quest shows the same title
 * and status on its existing status lines. One line per stage the loader
 * reports (loading-progress.ts keeps the order and each stage's share). */
export const EALDHOLT_LOADING_COPY = {
  eyebrow: EALDHOLT_PREVIEW_COPY.title,
  title: EALDHOLT_HOUSE.name.toUpperCase(),
  accessibleName: "My Legacy loading screen",
  progressLabel: EALDHOLT_PREVIEW_COPY.loading.title,
  stages: {
    download: "Fetching the village",
    verify: "Checking the village",
    parse: "Raising the houses",
    ground: "Laying the ground",
    coast: "Drawing the coast",
    foliage: "Leafing the trees",
    pond: "Filling the pond",
    woodland: "Planting the woodland",
    environment: "Setting the sky",
    residents: "Waking the residents",
    assembly: "Gathering the village",
    warmup: "Lighting the hearths",
  },
  ready: "The village is ready",
  error: EALDHOLT_PREVIEW_COPY.error,
} as const;
