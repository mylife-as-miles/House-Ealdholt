/**
 * Native, live UIKitML implementation of the approved desktop1280x720 layout.
 * Generate before build; do not hand-edit public/ui/menu.uikitml.
 * Native property references: https://github.com/pmndrs/uikit/blob/main/docs/getting-started/components-and-properties.md
 * All images remain supplied artwork. SVG decorations reproduce desktop vectors.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLE_RECORDS, CHRONICLES_TITLE,
  getChronicleRecords, getChronicleShortTitle, getHotspotRecords,
} from '../shared/chronicles/content.ts';
import { CHRONICLES_LOAD_FAILURE } from '../shared/chronicles/status.ts';
import {
  ARENAS, CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS,
  SETTINGS_CATEGORIES, SHOWCASE_CATEGORIES, getModalContent,
} from '../shared/menu/content.ts';
import { CARD_ART_POSITIONS, MENU_LAYOUT, MENU_THEME } from '../shared/menu/theme.ts';
import { questMenuArt } from '../shared/menu/derived-assets.ts';
import { SETTINGS_RESET_COPY, SETTINGS_STORAGE_COPY } from '../shared/menu/settings.ts';
import { SHOWCASE_COPY } from '../shared/showcase/catalog.ts';
import { CREDITS_FILM_COPY } from '../shared/menu/credits-film.ts';
import { OPENING_FILM_COPY, STORY_CINEMATIC_COPY } from '../shared/menu/opening-film.ts';
import { BATTLEFIELDS } from '../shared/play/match.ts';
import { BATTLEFIELD_PREVIEWS } from '../shared/play/setup.ts';
import {
  QUEST_CHRONICLE_CONTROLS, QUEST_CHRONICLE_IDS, QUEST_CHRONICLE_LAYOUT, QUEST_FILM_LAYOUT, questText, QUEST_FIXED_ACTION_IDS, QUEST_FIXED_TEXT_IDS, QUEST_SETTING_ROWS,
  QUEST_UI_LAYOUT, QUEST_VIEW_IDS, QUEST_SHOWCASE_ACTION_IDS, QUEST_SHOWCASE_TEXT_IDS,
} from '../main-game-vr/src/ui-contract.ts';

export async function generateQuestUI(destination?: string): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const ids = new Set<string>();
  const c = MENU_THEME.colors;
  const geometry = MENU_LAYOUT;
  const escape = (value: string): string => questText(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  const id = (value: string): string => {
    if (ids.has(value)) throw new Error(`Duplicate Quest UI ID: ${value}`);
    ids.add(value);
    return ` id="${value}"`;
  };
  const number = (value: number): string => Number(value.toFixed(6)).toString();
  const rect = (x: number, y: number, width: number, height: number): string => `position-type: absolute; position-left: ${number(x)}; position-top: ${number(y)}; width: ${number(width)}; height: ${number(height)};`;
  const node = (tag: string, elementId: string | undefined, className: string, contents: string, style = ''): string => `<${tag}${elementId ? id(elementId) : ''}${className ? ` class="${className}"` : ''}${style ? ` style="${style}"` : ''}>${contents}</${tag}>`;
  const text = (value: string, x: number, y: number, width: number, height: number, className = 'body', elementId?: string, style = ''): string => node('span', elementId, className, escape(value), `${rect(x, y, width, height)} pointer-events: none; z-index-offset: 3; ${style}`);
  const image = (source: string, x: number, y: number, width: number, height: number, elementId?: string, opacity = 1): string => `<img${elementId ? id(elementId) : ''} src="..${escape(source)}" style="${rect(x, y, width, height)} object-fit: fill; opacity: ${opacity}; z-index-offset: ${source.includes('/decorations/') ? 1 : 0}; pointer-events: none;" />`;
  const deco = (name: string, x: number, y: number, width: number, height: number, elementId?: string): string => image(`/assets/decorations/${name}.svg`, x, y, width, height, elementId);

  const dimensions = new Map<string, readonly [number, number]>();
  const sources = new Set([
    ...ARENAS.map((item) => item.source), ...HOME_CONTENT.map((item) => item.imageSrc!).filter(Boolean),
    ...CHAPTERS.map((item) => item.imageSrc),
    ...Object.values(BATTLEFIELD_PREVIEWS).flatMap(item => [item.preview, item.overview]),
  ]);
  for (const source of sources) {
    const bytes = await readFile(resolve(projectRoot, 'main game/public', source.replace(/^\//u, '')));
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') dimensions.set(source, [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1]);
    else if (format === 'VP8 ') dimensions.set(source, [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]);
    else if (format === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      dimensions.set(source, [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]);
    } else throw new Error(`Expected an approved WebP artwork source: ${source}`);
  }
  const art = (source: string, width: number, height: number, elementId?: string, position = '50% 50%', fit: 'cover' | 'contain' = 'cover', opacity = 1): string => {
    const size = dimensions.get(source);
    if (!size) throw new Error(`Missing artwork metadata: ${source}`);
    const scale = (fit === 'contain' ? Math.min : Math.max)(width / size[0], height / size[1]);
    const [px, py] = position.split(' ').map((value) => parseFloat(value) / 100);
    const imageWidth = size[0] * scale;
    const imageHeight = size[1] * scale;
    // Layout comes from the supplied image; the panel loads its Quest-size copy when there is one (Q-03).
    return image(questMenuArt(source), (width - imageWidth) * px, (height - imageHeight) * py, imageWidth, imageHeight, elementId, opacity);
  };
  const view = (elementId: string, contents: string, className = ''): string => node('div', elementId, `view ${className}`, contents, `display: ${elementId === 'View_Home' ? 'flex' : 'none'};`);
  const button = (elementId: string, x: number, y: number, width: number, height: number, contents: string, className = 'card', style = ''): string => node('button', elementId, className, contents, `${rect(x, y, width, height)} ${style}`);
  const title = (elementId: string, label: string, x: number, y: number, width: number, height = 24, style = ''): string => text(label, x, y, width, height, 'card-title', `${elementId}_Title`, style);
  // Keep an actual hand-sized interaction surface behind visually unboxed text.
  const hitSurface = (width: number, height: number): string => node('div', undefined, '', '', `${rect(0, 0, width, height)} background-color: #100d08; opacity: 0.001; pointer-events: auto;`);
  const plainAction = (elementId: string, label: string, x: number, y: number, width: number, visible = true): string => button(elementId, x, y, width, 50, hitSurface(width, 50) + text(label, 0, 15, width, 22, 'footer-label', `${elementId}_Label`), 'footer-action', `display: ${visible ? 'flex' : 'none'};`);
  const modalAction = (elementId: string, label: string, x: number, y: number): string => button(elementId, x, y - 9, 128, 50,
    hitSurface(128, 50) + node('div', `${elementId}_Plate`, 'modal-plate', '', `${rect(0, 9, 128, 32)} pointer-events: none;`) + text(label, 0, 13, 128, 24, 'modal-action-label', `${elementId}_Label`), 'modal-action');
  const centerCopy = (prefix: string, heading: string, body: string, note = ''): string => text(heading.toUpperCase(), 170, 160, 940, 30, 'modal-title', `${prefix}_Title`) + text(body, 260, 226, 760, 70, 'modal-body', `${prefix}_Description`) + (prefix === 'Modal' ? text(note, 260, 268, 760, 60, 'modal-note', 'Modal_Note') : '');

  const styles = `
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E3p-kc4A.ttf'); font-weight: 300; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHpv4kjgoGqM7EPCw.ttf'); font-weight: 400; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E3_-gc4A.ttf'); font-weight: 500; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E30-8c4A.ttf'); font-weight: 600; }
    .root { width: 1280; height: 720; position-type: relative; font-family: 'Barlow'; color: ${c.text}; }
    .view { position-type: absolute; position-left: 0; position-top: 0; width: 1280; height: 720; }
    .card { position-type: relative; overflow: hidden; padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 0; border-color: #39352a; border-width: 1; background-color: #1b1914; color: ${c.inactiveHeading}; cursor: pointer; }
    .card:hover { border-color: ${c.accent}; }
    .card-title { font-size: ${geometry.typography.cardHeading}; font-weight: 600; line-height: 1.1; }
    .card-subtitle { font-size: 8.704; line-height: 1.15; color: #d9d4c7; opacity: 0.83; }
    .card-description { font-size: 9.472; line-height: 1.2; color: #e8e0cc; opacity: 0.92; }
    .body { font-size: 16; font-weight: 400; color: #a19d91; line-height: 1.8; }
    .nav { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; color: #837f76; cursor: pointer; }
    .nav-label { font-size: 20; font-weight: 300; line-height: 1.2; text-align: center; }
    .nav-plate { background-color: ${c.activeTab}; }
    .modal-title { font-size: 20; font-weight: 600; color: ${c.modalHeading}; text-align: center; line-height: 1.2; }
    .modal-body { font-size: 16; font-weight: 400; color: ${c.modalText}; text-align: center; line-height: 1.5; }
    .modal-note { font-size: 16; font-weight: 400; color: ${c.modalText}; text-align: center; line-height: 1.5; }
    .modal-action { border-width: 0; cursor: pointer; }
    .modal-plate { background-color: #17140e; opacity: 0.15; border-color: #867650; border-width: 1; }
    .modal-action-label { font-size: 18; color: #aaa79c; text-align: center; line-height: 1.2; }
    .modal-action:hover { color: #d0c6b3; }
    .footer-action { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; cursor: pointer; }
    .footer-label { font-size: 15; font-weight: 300; color: #9b9588; line-height: 1.2; }
    .footer-action:hover { color: #e5d7bd; }
    .setting-row { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; color: #a19d91; cursor: pointer; }
    .setting-label { font-size: 16; line-height: 1.2; }
    .setting-value { font-size: 16; text-align: center; line-height: 1.2; }
    .section-label { font-size: 16; font-weight: 600; color: #b3b0a6; }
    .info-title { font-size: 16; font-weight: 600; color: #ccc9bf; line-height: 1.35; }
    .arena-label { font-size: 10.88; font-weight: 600; color: #b5b2ac; }
    .showcase-action { border-width: 1; border-color: #6d5834; background-color: #191710; color: #cfc6b2; cursor: pointer; padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; }
    .showcase-action:hover { border-color: #d99320; background-color: #302616; }
    .showcase-action-label { font-size: 16; font-weight: 500; color: #d3c9b3; text-align: center; line-height: 1.2; }
    .showcase-label { font-size: 15; color: #a9a18e; line-height: 1.35; }
    .showcase-heading { font-size: 22; font-weight: 600; color: #d99320; line-height: 1.15; }
    .archive-body { font-size: 12.16; color: #999d88; line-height: 1.45; }
    .chronicles-title { font-size: 20; font-weight: 600; color: ${c.modalHeading}; line-height: 1.2; }
    .hotspot-mark { background-color: ${c.activeTab}; z-index-offset: 2; pointer-events: none; }
    .nation-ring { display: flex; align-items: center; justify-content: center; border-radius: 10; border-width: 2; border-color: ${c.accent}; z-index-offset: 2; pointer-events: none; }
    .nation-title { font-size: 22; font-weight: 600; color: ${c.inactiveHeading}; line-height: 1.2; }
    .chronicle-option { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 1; border-color: #39352a; background-color: #1b1914; cursor: pointer; }
    .chronicle-option:hover { border-color: ${c.accent}; }
    .option-title { font-size: 24; font-weight: 600; color: ${c.inactiveHeading}; line-height: 1.2; }
    .option-subtitle { font-size: 16; font-weight: 400; color: #a19d91; line-height: 1.3; text-align: center; }
    .record-panel { display: flex; flex-direction: column; gap: 16; padding-top: 28; padding-right: 28; padding-bottom: 30; padding-left: 28; border-width: 1; border-color: #39352a; background-color: #1b1914; }
    .record-meta { display: flex; flex-direction: row; align-items: center; gap: 14; }
    .record-chip { display: flex; justify-content: center; padding-top: 5; padding-bottom: 5; border-width: 1; border-color: #867650; background-color: #17140e; }
    .record-label { font-size: 16; font-weight: 600; color: ${c.modalHeading}; line-height: 1.2; }
    .record-meaning { font-size: 16; font-weight: 400; color: ${c.modalText}; line-height: 1.35; }
    .record-title { font-size: 26; font-weight: 600; color: #dfd2b6; line-height: 1.25; }
    .record-body { font-size: 18; font-weight: 400; color: ${c.text}; line-height: 1.55; }
    .record-marker { font-size: 16; font-weight: 600; color: ${c.accent}; line-height: 1.2; }
  `;

  const home = view('View_Home', HOME_CONTENT.map((tile, index) => {
    const tileId = `Home_${tile.action}`;
    const left = geometry.home.x + (index ? geometry.home.leftWidth + geometry.home.gap : 0);
    const top = geometry.home.y + (index === 2 ? geometry.home.rightHeight + geometry.home.gap : 0);
    const width = index ? geometry.home.rightWidth : geometry.home.leftWidth;
    const height = index ? geometry.home.rightHeight : geometry.home.height;
    return button(tileId, left, top, width, height,
      hitSurface(width, height)
      + art(tile.imageSrc!, width, height, `${tileId}_Art`, tile.imagePosition || '50% 50%', tile.imageFit || 'cover', index === 0 ? 1 : 0.82)
      + deco('home-scrim', 0, 0, width, height)
      + title(tileId, (tile.title || '').toUpperCase(), 20, 24, width - 34), 'card');
  }).join('\n'));

  const play = view('View_Play', PLAY_CARDS.map((card, index) => {
    const cardId = `Play_${card.id}`;
    const width = geometry.play.cardWidth;
    const height = geometry.play.cardHeight;
    return button(cardId, geometry.play.x + index * (width + geometry.play.gap), geometry.play.y, width, height,
      art(`/assets/environments/card-${card.artwork}.webp`, width, height, `${cardId}_Art`, CARD_ART_POSITIONS[card.artwork], 'cover', 0.82)
      + deco('play-scrim', 0, 0, width, height)
      + title(cardId, card.title, 11.008, 12.96, width - 18.688)
      + text(card.subtitle, 11.008, 34.8, width - 18.688, 30, 'card-subtitle', `${cardId}_Subtitle`)
      + (card.description ? text(card.description, 11.008, height - 45, width - 19.712, 34.2, 'card-description', `${cardId}_Description`) : ''), 'card');
  }).join('\n'));

  // A stationary adaptation of desktop's map-selection layout. Its actions
  // remain on the existing reachable panel; no new immersive chess is claimed.
  const playSetup = view('View_PlaySetup',
    node('div', 'PlaySetup_Scrim', '', '', `${rect(90, 184, 1100, 420)} background-color: #0a1015; opacity: .96; pointer-events: none;`)
    + text('Arena selection', 105, 142, 650, 36, 'showcase-heading', 'PlaySetup_Title')
    + text('Classic', 880, 145, 295, 30, 'info-title', 'PlaySetup_Mode')
    + BATTLEFIELDS.map((field, index) => button(`PlaySetup_Setting_${field.id}`, 105, 210 + index * 124, 290, 112,
      node('div', undefined, '', art(BATTLEFIELD_PREVIEWS[field.id].preview, 112, 84), `${rect(11, 13, 112, 84)} overflow: hidden; pointer-events: none;`)
      + text(field.title, 137, 23, 144, 24, 'info-title', `PlaySetup_Setting_${field.id}_Title`)
      + text(field.subtitle, 137, 54, 144, 40, 'showcase-label', `PlaySetup_Setting_${field.id}_Subtitle`), 'card')).join('')
    + text('Select an arena', 105, 471, 280, 40, 'showcase-label', 'PlaySetup_SelectionHint')
    + text('Battlefield preview', 414, 185, 450, 23, 'showcase-label', 'PlaySetup_PreviewHeading')
    + node('div', 'PlaySetup_PreviewFrame', 'card', image(BATTLEFIELD_PREVIEWS['scene-01'].preview, 0, 0, 450, 253, 'PlaySetup_PreviewImage'), `${rect(414, 214, 450, 253)} pointer-events: none;`)
    + text('Setting 1', 414, 479, 450, 26, 'info-title', 'PlaySetup_PreviewTitle')
    + text('Eclipse', 414, 509, 450, 24, 'showcase-label', 'PlaySetup_PreviewSubtitle')
    + button('PlaySetup_PreviewToggle', 414, 547, 450, 50,
      text('Board view', 0, 14, 450, 25, 'showcase-action-label', 'PlaySetup_PreviewToggle_Label'), 'showcase-action')
    + text('Match terms', 880, 185, 295, 24, 'showcase-label', 'PlaySetup_TermsHeading')
    + button('PlaySetup_Clock', 880, 214, 295, 58, text('Clock', 13, 8, 270, 18, 'showcase-label', 'PlaySetup_Clock_Label') + text('No clock', 13, 29, 270, 23, 'info-title', 'PlaySetup_ClockValue'), 'card')
    + button('PlaySetup_Side', 880, 280, 295, 58, text('Your side', 13, 8, 270, 18, 'showcase-label', 'PlaySetup_Side_Label') + text('Ivory', 13, 29, 270, 23, 'info-title', 'PlaySetup_SideValue'), 'card')
    + button('PlaySetup_Difficulty', 880, 346, 295, 58, text('Computer strength', 13, 8, 270, 18, 'showcase-label', 'PlaySetup_Difficulty_Label') + text('Medium', 13, 29, 270, 23, 'info-title', 'PlaySetup_DifficultyValue'), 'card')
    + text('Immersive chess is not available in this build.', 880, 420, 295, 80, 'showcase-label', 'PlaySetup_Notice')
    + button('PlaySetup_Start', 880, 539, 295, 58, text('Desktop play only', 0, 17, 295, 26, 'showcase-action-label', 'PlaySetup_Start_Label'), 'showcase-action'));

  const showcaseWidths = [(800 - 8) * 1.18 / 3.18, (800 - 8) / 3.18, (800 - 8) / 3.18];
  let showcaseLeft = geometry.play.x;
  const showcase = view('View_Showcase', SHOWCASE_CATEGORIES.map((item, index) => {
    const tileId = `Showcase_${item.id}`;
    const width = showcaseWidths[index];
    const x = showcaseLeft;
    showcaseLeft += width + 4;
    const background = item.art ? art(item.art, width, 298, `${tileId}_Art`, item.id === 'arenas' ? '60% 50%' : '35% 50%', 'cover', 0.82) : deco('showcase-archive-background', 0, 0, width, 298, `${tileId}_Art`) + deco('showcase-archive-seal', width / 2 - 83.2, 79.2, 166.4, 166.4);
    return button(tileId, x, 211, width, 298, background + deco('showcase-scrim', 0, 0, width, 298)
      + text(item.status.toUpperCase(), 16, 15.12, width - 30.08, 16, 'card-subtitle', `${tileId}_Subtitle`, 'font-size: 8.96;')
      + title(tileId, item.title, 16, 34.5, width - 30.08)
      + text(item.description, 16, 247, width - 30.08, 36, 'card-description', `${tileId}_Description`, 'font-size: 11.52; line-height: 1.4;')
      + (item.id !== 'replays' ? deco(`showcase-${item.id}-inactive`, width - 69.76, 172.24, 53.76, 53.76, `${tileId}_Icon`) : ''), 'card');
  }).join('\n'));

  const showcaseAction = (elementId: string, label: string, x: number, y: number, width: number, style = ''): string => button(elementId, x, y, width, 50,
    text(label, 3, 15, width - 6, 23, 'showcase-action-label', `${elementId}_Label`), 'showcase-action', style);
  const stageFrame = (elementId: string, height: number): string => node('div', elementId, '', '', `${rect(105, 188, 720, height)} border-width: 1; border-color: #776246; opacity: .72; pointer-events: none;`);
  const arenas = view('View_Arenas', stageFrame('Arena_StageFrame', 334)
    + text(SHOWCASE_COPY.arenas, 105, 145, 720, 30, 'showcase-heading', 'Arena_Title')
    + text('01 / 04', 1080, 145, 95, 30, 'showcase-label', 'Arena_Count', 'text-align: right;')
    + ARENAS.map((arena, index) => button(`Arena_${index}`, 847, 188 + index * 98, 328, 92,
      art(arena.source, 328, 92, `Arena_${index}_Art`, '50% 50%', 'cover', .62)
      + deco('showcase-scrim', 0, 0, 328, 92)
      + text(arena.label.toUpperCase(), 17, 32, 290, 25, 'section-label'), 'card')).join(''));

  const chapters = view('View_Chapters', CHAPTERS.map((chapter, index) => {
    const tileId = `Chapter_${chapter.id}`;
    const width = geometry.chapters.width / 5;
    const height = geometry.chapters.height / 3;
    return button(tileId, geometry.chapters.x + (index % 5) * width, geometry.chapters.y + Math.floor(index / 5) * height, width, height,
      art(chapter.imageSrc, width, height, `${tileId}_Art`, chapter.imagePosition, 'cover', chapter.locked ? 0.1166 : 0.4896)
      + deco(chapter.locked ? 'chapter-locked-scrim' : 'chapter-scrim', 0, 0, width, height, `${tileId}_Shade`)
      + title(tileId, chapter.title.toUpperCase(), 20, 22.32, width - 30.24, 24, chapter.locked ? 'color: #80796b; opacity: 0.65;' : '')
      + (chapter.id === 'chapter-01' ? text('COMING SOON', 20, height - 30, width - 30, 18, 'footer-label', `${tileId}_Availability`, 'display: none;') : '')
      + (chapter.locked ? deco('chapter-lock-inactive', width / 2 - 6.72, height / 2 - 9, 13.44, 18, `${tileId}_Lock`) : ''), 'card');
  }).join('\n'));

  const settings = view('View_Settings', SETTINGS_CATEGORIES.map((category, index) => {
    const tileId = `Settings_${category}`;
    return button(tileId, 106 + (index % 3) * 300, 158 + Math.floor(index / 3) * 219, 300, 219,
      deco('settings-pattern', 0, 0, 300, 219, `${tileId}_Art`)
      + title(tileId, category.toUpperCase(), 19, 23, 268)
      + deco(`settings-${category}-inactive`, 96, 60.12, 108, 108, `${tileId}_Icon`), 'card', 'background-color: #17150f;');
  }).join('\n'));
  const detailRows = Array.from({ length: QUEST_SETTING_ROWS }, (_, index) => node('div', `Setting_Row_${index}`, '',
    node('div', `Setting_${index}_Surface`, '', '', `${rect(0, 0, 544, 35)} background-color: ${index % 2 ? '#231f19' : '#1b1813'}; opacity: ${index % 2 ? 0.45 : 0.52}; pointer-events: none;`)
    + button(`Setting_${index}`, 0, 0, 286, 35, text('Preference', 9, 7, 276, 22, 'setting-label', `Setting_Label_${index}`), 'setting-row')
    + button(`Setting_Decrease_${index}`, 286, 0, 36, 35, text('<', 0, 7, 36, 22, 'setting-value'), 'setting-row', 'display: none;')
    + text('Value', 317, 7, 194, 22, 'setting-value', `Setting_Value_${index}`)
    + button(`Setting_Increase_${index}`, 508, 0, 36, 35, text('>', 0, 7, 36, 22, 'setting-value'), 'setting-row', 'display: none;'), rect(0, index * 37, 544, 35))).join('\n');
  const details = view('View_SettingsDetail', text('GENERAL SETTINGS', 106, 126, 544, 22, 'section-label', 'Settings_Category', 'display: none;')
    + node('div', undefined, '', detailRows, rect(106, 150, 544, 396))
    + text('Language', 787.2, 150, 294.4, 44, 'info-title', 'Settings_Title')
    + text('Pinch or touch a preference to change it.', 787.2, 209, 294.4, 336, 'body', 'Settings_Description')
    + text(SETTINGS_STORAGE_COPY.saved, 106, 556, 544, 28, 'body', 'Settings_Status', 'font-size: 14;'));

  const initialModal = getModalContent('classic');
  const modal = view('View_Modal', centerCopy('Modal', initialModal.title, initialModal.description, initialModal.note || '') + modalAction('Btn_Confirm', 'Confirm', 480, 348) + modalAction('Btn_Cancel', 'Cancel', 672, 348));
  const player = node('div', 'Showcase_Player', '',
    node('div', undefined, '', '', `${rect(847, 188, 328, 412)} background-color: #17150f; opacity: .94; pointer-events: none;`)
    + text(SHOWCASE_COPY.local.toUpperCase(), 865, 205, 292, 30, 'showcase-label', 'Showcase_State')
    + text(SHOWCASE_COPY.opening, 865, 242, 292, 37, 'showcase-heading', 'Showcase_Move', 'font-size: 28; color: #e4d9c0;')
    + text(SHOWCASE_COPY.white, 865, 288, 292, 26, 'showcase-label', 'Showcase_Turn')
    + text('0 / 0 moves', 865, 322, 292, 25, 'showcase-label', 'Showcase_Count')
    + text('', 865, 350, 292, 24, 'showcase-label', 'Showcase_Result')
    + showcaseAction('Showcase_Save', SHOWCASE_COPY.save, 863, 386, 296)
    + showcaseAction('Showcase_Generate', SHOWCASE_COPY.newBattle, 863, 440, 296)
    + showcaseAction('Showcase_Archive', SHOWCASE_COPY.replays, 863, 494, 296)
    + ARENAS.map((_, index) => showcaseAction(`Showcase_Arena_${index}`, `${index + 1}`.padStart(2, '0'), 863 + index * 75, 548, 71)).join('')
    + showcaseAction('Showcase_First', SHOWCASE_COPY.first, 105, 498, 74)
    + showcaseAction('Showcase_Previous', '<', 185, 498, 74)
    + showcaseAction('Showcase_Play', SHOWCASE_COPY.play, 265, 498, 236, 'border-color: #bd821f; background-color: #342614;')
    + showcaseAction('Showcase_Next', '>', 507, 498, 74)
    + showcaseAction('Showcase_Last', SHOWCASE_COPY.last, 587, 498, 74)
    + showcaseAction('Showcase_Speed', '1x speed', 667, 498, 158)
    + Array.from({ length: 5 }, (_, index) => showcaseAction(`Showcase_Seek_${index}`, `${index * 25}%`, 105 + index * 145, 550, 140)).join('')
    + node('div', 'Showcase_Loading', '',
      node('div', undefined, '', '', `${rect(105, 188, 720, 296)} background-color: #17150f; opacity: .96; pointer-events: none;`)
      + text(SHOWCASE_COPY.generating, 150, 290, 630, 54, 'modal-title', 'Showcase_Progress')
      + showcaseAction('Showcase_Retry', SHOWCASE_COPY.retry, 365, 376, 200), 'display: none;')
  );
  const archive = node('div', 'Showcase_ArchiveView', '',
    Array.from({ length: 3 }, (_, index) => node('div', `Showcase_ReplayRow_${index}`, '',
      button(`Showcase_Replay_${index}`, 847, 320 + index * 76, 256, 72,
        text(SHOWCASE_COPY.exhibition, 14, 10, 228, 29, 'info-title', `Showcase_ReplayTitle_${index}`, 'font-size: 16;')
        + text(SHOWCASE_COPY.localArchive, 14, 42, 228, 22, 'showcase-label', `Showcase_ReplayDetail_${index}`, 'font-size: 13;'), 'card')
      + showcaseAction(`Showcase_Delete_${index}`, SHOWCASE_COPY.delete, 1109, 331 + index * 76, 66), 'display: none;')).join('')
    + node('div', 'Showcase_Empty', '', text(SHOWCASE_COPY.emptyTitle, 863, 330, 296, 46, 'modal-title', 'Showcase_EmptyTitle', 'font-size: 18; text-align: left;')
      + text(SHOWCASE_COPY.emptyBody, 863, 386, 296, 82, 'modal-body', 'Showcase_EmptyBody', 'font-size: 15; text-align: left;')
      + showcaseAction('Showcase_Create', SHOWCASE_COPY.newBattle, 863, 478, 296))
    + showcaseAction('Showcase_PagePrevious', '<', 847, 550, 60)
    + text('Page 1 / 1', 913, 565, 196, 25, 'showcase-label', 'Showcase_Page', 'text-align: center;')
    + showcaseAction('Showcase_PageNext', '>', 1115, 550, 60)
    + showcaseAction('Showcase_Reload', SHOWCASE_COPY.reloadArchive, 214, 610, 250), 'display: none;');
  const deleteReplay = node('div', 'Showcase_DeleteView', '',
    text(SHOWCASE_COPY.deleteTitle.toUpperCase(), 170, 160, 940, 30, 'modal-title', 'Showcase_DeleteTitle')
    + text(SHOWCASE_COPY.deleteBody, 260, 226, 760, 90, 'modal-body', 'Showcase_DeleteBody')
    + showcaseAction('Showcase_DeleteCancel', SHOWCASE_COPY.cancel, 480, 348, 128)
    + showcaseAction('Showcase_DeleteConfirm', SHOWCASE_COPY.delete, 672, 348, 128), 'display: none;');
  const library = view('View_Library', stageFrame('Showcase_StageFrame', 296)
    + text(SHOWCASE_COPY.battles, 105, 145, 1070, 30, 'showcase-heading', 'Showcase_Title')
    + player + archive + deleteReplay
    + text('', 105, 664, 1070, 38, 'showcase-label', 'Showcase_Notice', 'color: #d0b47a; font-size: 14;'));

  const onboarding = view('View_Onboarding', text('WELCOME TO CROWNFALL', 170, 160, 940, 30, 'modal-title', 'Onboarding_Title')
    + text('Point and pinch, or touch a button. Watch a computer exhibition, explore four arenas, and save a replay. This Showcase does not start a player match.', 260, 226, 760, 76, 'modal-body', 'Onboarding_Body')
    + modalAction('Btn_StartVisit', 'Start visit', 480, 348) + modalAction('Btn_SkipVisit', 'Skip visit', 672, 348));
  const visit = view('View_Visit', node('div', 'Visit_Scrim', '', '', `${rect(0, 0, 1280, 720)} background-color: #39270c; opacity: 0; pointer-events: none;`)
    + text('ARENA VISIT', 139, 118, 600, 30, 'modal-title', 'Visit_Title', 'text-align: left;')
    + text('1 / 3', 727, 118, 90, 30, 'body', 'Visit_Count', 'text-align: right;')
    + node('div', undefined, 'card', art(ARENAS[0].source, 640, 357.1875, 'Visit_Image', '50% 50%', 'contain'), rect(139, 160, 640, 357.1875))
    + text('Explore the supplied arena artwork. This visit does not start a match or change campaign progress.', 826, 211, 326, 120, 'body', 'Visit_Body')
    + modalAction('Btn_VisitBack', 'Previous', 826, 348) + modalAction('Btn_VisitNext', 'Next', 1018, 348)
    + button('Btn_VisitFinish', 826, 339, 192, 50, text('Finish visit', 0, 13, 192, 24, 'modal-action-label', 'Btn_VisitFinish_Label'), 'modal-action', 'display: none;'));
  // The film screen (the end credits, or the opening): the runtime draws the video
  // on a world-space plane over this black, framed screen; the caption row and the
  // footer stay in reach below. The runtime sets the title and status per film.
  // While the opening waits for its pinch the plane is hidden and the screen shows
  // the prompt with Begin and Skip, the size of the dialog actions.
  const film = QUEST_FILM_LAYOUT;
  const openingWaiting = node('div', 'Opening_Waiting', '',
    text(OPENING_FILM_COPY.begin.questPrompt, film.screen.x, film.prompt.y, film.screen.width, film.prompt.height, 'modal-title', 'Opening_Prompt')
    + text(OPENING_FILM_COPY.begin.note, film.screen.x, film.prompt.noteY, film.screen.width, film.prompt.height, 'modal-body', 'Opening_Note')
    + modalAction('Btn_OpeningBegin', OPENING_FILM_COPY.begin.button, 480, film.prompt.actionY)
    + modalAction('Btn_OpeningSkip', OPENING_FILM_COPY.skip, 672, film.prompt.actionY), 'display: none;');
  const filmView = view('View_Film', node('div', 'Film_Screen', '', '', `${rect(film.screen.x - 3, film.screen.y - 3, film.screen.width + 6, film.screen.height + 6)} border-width: 1; border-color: #776246; background-color: #000000; pointer-events: none;`)
    + text(CREDITS_FILM_COPY.title.toUpperCase(), film.caption.x, film.caption.y, film.caption.width * .55, film.caption.height, 'info-title', 'Film_Title')
    + text(CREDITS_FILM_COPY.questHint, film.caption.x + film.caption.width * .55, film.caption.y, film.caption.width * .45, film.caption.height, 'body', 'Film_Status', 'text-align: right; font-size: 15; line-height: 1.35;')
    + openingWaiting);
  const pause = view('View_Pause', text('PAUSED', 170, 160, 940, 30, 'modal-title', 'Pause_Title')
    + text('Take your time. Resume the menu, recenter the panel, or return Home.', 260, 226, 760, 76, 'modal-body', 'Pause_Body')
    + modalAction('Btn_Resume', 'Resume', 480, 348) + modalAction('Btn_PauseHome', 'Home', 672, 348));

  // Chronicles: the Atlas map is the relief diorama on the table below this
  // panel, so the panel keeps to the band above it. Exhibit tabs take the
  // navigation row. On the Atlas a button per nation stands in its quadrant of
  // the map either side of the record panel; the timeline and the articles sit
  // above the record panel on their own exhibits. The runtime sets the open
  // record's copy and moves the record panel to its exhibit's place.
  const copy = (value: string, className: string, elementId?: string, style = ''): string => node('span', elementId, className, escape(value), `${style} pointer-events: none; z-index-offset: 3;`);
  const chronicleLayout = QUEST_CHRONICLE_LAYOUT;
  const chronicleTitleWidth = 150;
  const band = { x: 105, width: 1280 - 210 };
  let tabLeft = 128 + chronicleTitleWidth;
  const exhibitTabs = CHRONICLE_EXHIBITS.map((exhibit, index) => {
    const tabId = QUEST_CHRONICLE_IDS.tab(exhibit.id);
    // Sized like the navigation tabs: label width plus the same side padding.
    const width = Math.round(exhibit.title.length * 10 + 48);
    const x = tabLeft;
    tabLeft += width + geometry.navigation.gap;
    return button(tabId, x, 68.616, width, 50, hitSurface(width, 50) + node('div', `${tabId}_Plate`, 'nav-plate', '', `${rect(0, 9, width, 32.256)} opacity: ${index === 0 ? 1 : 0}; pointer-events: none;`)
      + text(exhibit.title, 0, 13.128, width, 24, 'nav-label', `${tabId}_Title`, index === 0 ? `color: #19120a;` : 'color: #c1bbac; opacity: 0.54;'), 'nav');
  }).join('');
  const option = (elementId: string, width: number, height: number, contents: string): string => hitSurface(width, height)
    + node('div', `${elementId}_Plate`, '', '', `${rect(0, 0, width, height)} background-color: #c5bca9; opacity: 0; pointer-events: none;`) + contents;
  const nation = { width: chronicleLayout.record.x - 24 - band.x, height: 64, gap: 20 };
  const atlas = node('div', QUEST_CHRONICLE_IDS.pane('atlas'), '', getHotspotRecords().map((item) => {
    const nationId = QUEST_CHRONICLE_IDS.control(item);
    const x = item.hotspot.x < 0.5 ? band.x : band.x + band.width - nation.width;
    const y = chronicleLayout.recordTop.atlas + (item.hotspot.y < 0.5 ? 0 : nation.height + nation.gap);
    // The ring echoes the brass ring of its marker on the table.
    return button(nationId, x, y, nation.width, nation.height, option(nationId, nation.width, nation.height,
      node('div', undefined, 'nation-ring', node('div', `${nationId}_Mark`, 'hotspot-mark', '', 'width: 8; height: 8; border-radius: 4; opacity: 0;'), rect(22, nation.height / 2 - 10, 20, 20))
      + text(getChronicleShortTitle(item), 58, nation.height / 2 - 13, nation.width - 74, 26, 'nation-title', `${nationId}_Title`)), 'chronicle-option');
  }).join(''), rect(0, 0, 1280, 720));
  const stops = getChronicleRecords('interregnum');
  const stop = { gap: 16, height: 140 };
  const stopWidth = (band.width - stop.gap * (stops.length - 1)) / stops.length;
  const interregnum = node('div', QUEST_CHRONICLE_IDS.pane('interregnum'), '',
    node('div', undefined, '', '', `${rect(band.x + stopWidth / 2, chronicleLayout.recordTop.atlas + 33, band.width - stopWidth, 2)} background-color: ${c.accent}; opacity: 0.55; pointer-events: none;`)
    + stops.map((item, index) => {
      const stopId = QUEST_CHRONICLE_IDS.control(item);
      const years = getChronicleShortTitle(item);
      return button(stopId, band.x + index * (stopWidth + stop.gap), chronicleLayout.recordTop.atlas, stopWidth, stop.height, option(stopId, stopWidth, stop.height,
        node('div', undefined, '', '', `${rect(stopWidth / 2 - 13, 20, 26, 26)} border-radius: 13; border-width: 2.5; border-color: ${c.accent}; background-color: #1b1914; pointer-events: none;`)
        + node('div', `${stopId}_Mark`, 'hotspot-mark', '', `${rect(stopWidth / 2 - 6, 27, 12, 12)} border-radius: 6; opacity: 0;`)
        + text(years, 0, 60, stopWidth, 30, 'option-title', `${stopId}_Title`, 'text-align: center;')
        + text(item.title.slice(years.length + 3), 10, 94, stopWidth - 20, 40, 'option-subtitle')), 'chronicle-option');
    }).join(''), rect(0, 0, 1280, 720));
  const articles = getChronicleRecords('laws');
  const article = { gap: 16, height: 96 };
  const articleWidth = (band.width - article.gap * (articles.length - 1)) / articles.length;
  const laws = node('div', QUEST_CHRONICLE_IDS.pane('laws'), '', articles.map((item, index) => {
    const articleId = QUEST_CHRONICLE_IDS.control(item);
    return button(articleId, band.x + index * (articleWidth + article.gap), chronicleLayout.recordTop.atlas, articleWidth, article.height, option(articleId, articleWidth, article.height,
      node('div', `${articleId}_Mark`, 'hotspot-mark', '', `${rect(0, article.height - 4, articleWidth, 4)} opacity: 0;`)
      + text(item.title, 16, article.height / 2 - 15, articleWidth - 32, 30, 'option-title', `${articleId}_Title`, 'text-align: center;')), 'chronicle-option');
  }).join(''), rect(0, 0, 1280, 720));
  // Generated with the first record; the runtime sets the open record's copy.
  // The marker chip is generated empty: the runtime fills it from the content
  // policy beside unapproved words, so no marker text is ever baked in here.
  const firstRecord = CHRONICLE_RECORDS[0];
  const recordInner = chronicleLayout.record.width - 56;
  const record = node('div', QUEST_CHRONICLE_IDS.record, 'record-panel',
    copy('', 'record-marker', QUEST_CHRONICLE_IDS.recordMarker, `width: ${recordInner}; display: none;`)
    + node('div', undefined, 'record-meta', node('div', undefined, 'record-chip', copy(CHRONICLE_LABELS[firstRecord.label].name, 'record-label', 'Record_Label'), 'width: 116;')
      + copy(CHRONICLE_LABELS[firstRecord.label].meaning, 'record-meaning', 'Record_Meaning', `width: ${recordInner - 130};`))
    + copy(firstRecord.title, 'record-title', 'Record_Title', `width: ${recordInner};`)
    + node('div', undefined, '', '', `width: ${recordInner}; height: 1; background-color: #39352a;`)
    + copy(firstRecord.body, 'record-body', 'Record_Body', `width: ${recordInner};`),
    `position-type: absolute; position-left: ${chronicleLayout.record.x}; position-top: ${chronicleLayout.recordTop.atlas}; width: ${chronicleLayout.record.width}; display: none;`);
  // A wordless loading bar under the tabs while the archive builds: the runtime
  // shows it and drives its fill from the room's progress, or sweeps it.
  const loading = chronicleLayout.loading;
  const loadingBar = node('div', QUEST_CHRONICLE_IDS.loading, '',
    node('div', QUEST_CHRONICLE_IDS.loadingFill, '', '', `position-type: absolute; position-left: 0; position-top: 0; width: ${loading.width / 4}; height: ${loading.height}; border-radius: ${loading.height / 2}; background-color: ${c.accent}; pointer-events: none;`),
    `${rect(loading.x, loading.y, loading.width, loading.height)} border-radius: ${loading.height / 2}; background-color: #39352a; display: none; pointer-events: none;`);
  const chronicles = view('View_Chronicles', text(CHRONICLES_TITLE, 128, 81.744, chronicleTitleWidth - 24, 24, 'chronicles-title', 'Chronicles_Title')
    + node('div', undefined, '', '', `${rect(128 + chronicleTitleWidth - 13, 82, 1, 24)} background-color: #39352a; pointer-events: none;`)
    + exhibitTabs + loadingBar
    + text(CHRONICLES_LOAD_FAILURE, 128, 120, 1024, 24, 'body', QUEST_CHRONICLE_IDS.failure, 'display: none; font-size: 16; line-height: 1.2; color: #dfd2b6; pointer-events: none;')
    + atlas + interregnum + laws + record);

  let navLeft = 128;
  const nav = NAV_TABS.map((tab, index) => {
    const navId = `Nav_${tab.aria}`;
    const width = geometry.navigation.widths[index];
    const x = navLeft;
    navLeft += width + geometry.navigation.gap;
    return button(navId, x, 68.616, width, 50, hitSurface(width, 50) + node('div', `${navId}_Plate`, 'nav-plate', '', `${rect(0, 9, width, 32.256)} opacity: ${index === 0 ? 1 : 0}; pointer-events: none;`)
      + text(tab.label, 0, 13.128, width, 24, 'nav-label', `${navId}_Title`), 'nav', index === 0 ? `color: ${c.background};` : '');
  }).join('\n');
  const footer = plainAction('Btn_Back', 'Back', 105, 610, 90)
    + plainAction('Btn_StorySkip', STORY_CINEMATIC_COPY.skip, 105, 610, 220, false)
    + plainAction('Btn_ResetSettings', SETTINGS_RESET_COPY.action, 214, 610, 170, false)
    + plainAction('Btn_Pause', 'Pause', 580, 610, 70, false)
    + plainAction('Btn_Recenter', 'Recenter', 668, 610, 90, false)
    + plainAction('Btn_Exit', 'Exit VR', 776, 610, 70, false)
    + plainAction('Btn_VisitReplay', 'Short visit', 862, 610, 95, false)
    + plainAction('Btn_RetryCreature', 'Retry creature', 975, 610, 115, false)
    + plainAction('Btn_EnterVR', 'Enter VR', 1100, 610, 95)
    + text('Pinch or touch to select.', 105, 680, 640, 24, 'card-description', 'Status_Hint', 'display: none;')
    + text('Hands-first preview', 105, 680, 640, 24, 'card-description', 'Status_Tracking', 'display: none;')
    + text('Menu preview / gameplay unavailable', 105, 680, 1000, 24, 'card-description', 'Status_Boot', 'display: none;');
  const source = `<!-- Generated by scripts/generate-quest-ui.ts. Native live controls, supplied artwork and desktop reference geometry. -->\n<style>${styles}</style>\n<div${id('Crownfall_UI')} class="root">${node('div', 'Scene_Scrim', '', '', `${rect(0, 0, 1280, 720)} background-color: #0a0805; opacity: 0; pointer-events: none;`)}${nav}${[home, play, playSetup, showcase, chapters, settings, arenas, library, chronicles, modal, onboarding, visit, pause, details, filmView].join('\n')}${footer}</div>\n`;
  const required = [
    ...QUEST_VIEW_IDS, ...QUEST_FIXED_ACTION_IDS, ...QUEST_FIXED_TEXT_IDS, ...QUEST_SHOWCASE_ACTION_IDS, ...QUEST_SHOWCASE_TEXT_IDS, 'Visit_Image', 'Settings_Category', 'Scene_Scrim', 'Visit_Scrim', 'Showcase_StageFrame', 'Arena_StageFrame', 'Opening_Waiting',
    ...HOME_CONTENT.map((item) => `Home_${item.action}`), ...PLAY_CARDS.map((item) => `Play_${item.id}`),
    ...CHAPTERS.map((item) => `Chapter_${item.id}`), ...SHOWCASE_CATEGORIES.map((item) => `Showcase_${item.id}`),
    ...ARENAS.map((_, index) => `Arena_${index}`), ...SETTINGS_CATEGORIES.map((item) => `Settings_${item}`),
    ...Array.from({ length: QUEST_SETTING_ROWS }, (_, index) => [`Setting_${index}`, `Setting_Label_${index}`, `Setting_Value_${index}`, `Setting_Decrease_${index}`, `Setting_Increase_${index}`]).flat(),
    QUEST_CHRONICLE_IDS.record, QUEST_CHRONICLE_IDS.recordMarker, QUEST_CHRONICLE_IDS.loading, QUEST_CHRONICLE_IDS.loadingFill,
    ...CHRONICLE_EXHIBITS.flatMap((item) => [QUEST_CHRONICLE_IDS.tab(item.id), QUEST_CHRONICLE_IDS.pane(item.id)]),
    ...QUEST_CHRONICLE_CONTROLS.flatMap((item) => [QUEST_CHRONICLE_IDS.control(item), `${QUEST_CHRONICLE_IDS.control(item)}_Mark`]),
  ];
  for (const elementId of required) if (!ids.has(elementId)) throw new Error(`Missing required Quest UI ID: ${elementId}`);
  const output = destination ? resolve(destination) : resolve(projectRoot, 'main-game-vr/public/ui/menu.uikitml');
  await mkdir(dirname(output), { recursive: true });
  let previous = '';
  try { previous = await readFile(output, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (previous !== source) await writeFile(output, source);
  console.log(`Generated ${output}: ${ids.size} stable native elements, exact1280x720 desktop geometry.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void generateQuestUI().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
