import { EALDHOLT_PREVIEW_COPY } from './copy';
import { EALDHOLT_HOUSE } from './house';
import { EALDHOLT_INHERITED_COPY } from './inherited-copy';

/** Compact presentation only. The domain, save confirmation, story dialogue
 * and meaning of preview versus inherited play remain unchanged. Adapters
 * show expanded information on demand and keep the save consequence visible
 * before confirmation. Longer accessible labels need not add visible text. */
export const EALDHOLT_INTERFACE_COPY = {
  house: EALDHOLT_HOUSE.name,
  context: 'Aethelgard',
  legacy: 'My Legacy',
  introSpeaker: 'House steward',
  introBody: 'The house is known here; choose the banner we will carry.',
  chooseBanner: 'Choose banner',
  visitVillage: 'Visit village',
  bannerHeading: 'Your banner',
  edit: 'Edit',
  previousField: 'Previous field',
  nextField: 'Next field',
  previousValue: 'Previous value',
  nextValue: 'Next value',
  done: 'Done',
  begin: 'Begin',
  commitConsequence: 'New Ealdholt save. Earlier saves kept.',
  info: 'Info',
  fullInfo: EALDHOLT_INHERITED_COPY.confirmation,
  previewInfo: EALDHOLT_PREVIEW_COPY.visitOnly,
  back: 'Back',
  home: 'Home',
  play: 'Play',
  close: 'Close',
  views: 'Views',
  people: 'People',
  camera: 'Camera',
  reset: 'Reset',
  activity: 'Activity',
  activityNote: 'Household prototype',
  details: 'Details',
  pause: 'Pause',
  resume: 'Resume',
  retry: 'Retry',
  accessible: {
    home: EALDHOLT_PREVIEW_COPY.actions.home,
    play: EALDHOLT_PREVIEW_COPY.actions.play,
    close: EALDHOLT_INHERITED_COPY.close,
    edit: EALDHOLT_PREVIEW_COPY.banner.edit,
    info: 'About this house and saves',
    reset: EALDHOLT_PREVIEW_COPY.controls.resetView,
  },
} as const;
