/** Shared visual values for the ThreeUI Community adaptation. Presentation
 * only: no changes to resident data, saved choices, scene geometry or clocks. */
export const EALDHOLT_UI_THEME = Object.freeze({
  source: Object.freeze({
    name: 'ThreeUI Community',
    repository: 'https://github.com/MengTo/threeui',
    commit: '68802d5428071ada5c20db8094b1649e6bb770ed',
    component: 'src/shaders/section-elements/SectionElements.tsx#SectionButton',
  }),
  palette: Object.freeze({
    ink: '#f3eee4',
    body: '#e2dfd2',
    muted: '#c5bfaf',
    panel: '#171c18',
    raised: '#242c24',
    border: '#75654c',
    accent: '#e2bd7c',
    accentInk: '#171910',
    hover: '#374334',
    primary: '#513d24',
    primaryHover: '#6b5130',
  }),
  panelRadius: 4,
  controlRadius: 4,
} as const);
