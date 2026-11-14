import assert from 'node:assert/strict';
import test from 'node:test';
import { MENU_TRANSLATIONS, SUPPORTED_LOCALES, translate } from './localization';
import {
  DEFAULT_VIOLENCE_INTENSITY, VIOLENCE_COPY, VIOLENCE_INTENSITIES, cycleViolenceIntensity, normalizeViolenceIntensity, violenceIntensityRow,
} from './violence';
import { GORE_INTENSITIES, DEFAULT_GORE_INTENSITY } from '../../web/src/scene/gore/GoreTypes';
import { INITIAL_PREFERENCES, normalizePreferences } from '../../main game/src/settings-types';
import { DEFAULT_QUEST_PREFERENCES, adjustQuestPreference, getQuestSettingsRows, normalizeQuestPreferences, resetQuestPreferences } from '../../main-game-vr/src/quest-state';

test('Violence Intensity has three levels, cinematic by default, the same as the Gore Director', () => {
  assert.deepEqual([...VIOLENCE_INTENSITIES], ['minimal', 'cinematic', 'full']);
  assert.deepEqual([...VIOLENCE_INTENSITIES], [...GORE_INTENSITIES]);
  assert.equal(DEFAULT_VIOLENCE_INTENSITY, 'cinematic');
  assert.equal(DEFAULT_VIOLENCE_INTENSITY, DEFAULT_GORE_INTENSITY);
  for (const bad of [undefined, null, '', 'gory', 2, {}]) assert.equal(normalizeViolenceIntensity(bad), 'cinematic');
  for (const level of VIOLENCE_INTENSITIES) assert.equal(normalizeViolenceIntensity(level), level);
  assert.deepEqual(VIOLENCE_INTENSITIES.map(level => cycleViolenceIntensity(level, 1)), ['cinematic', 'full', 'minimal']);
  assert.deepEqual(VIOLENCE_INTENSITIES.map(level => cycleViolenceIntensity(level, -1)), ['full', 'minimal', 'cinematic']);
});

test('both menus carry the setting with the same label, values and description', () => {
  assert.equal(INITIAL_PREFERENCES.violence, 'cinematic');
  assert.equal(DEFAULT_QUEST_PREFERENCES.violence, 'cinematic');
  assert.equal(normalizePreferences({ violence: 'full' }).violence, 'full');
  assert.equal(normalizePreferences({ violence: 'extreme' }).violence, 'cinematic', 'an unknown saved level falls back');
  assert.equal(normalizePreferences({}).violence, 'cinematic', 'an old save acquires the default');
  assert.equal(normalizeQuestPreferences({ violence: 'minimal' }).violence, 'minimal');
  assert.equal(normalizeQuestPreferences({ violence: 7 }).violence, 'cinematic');

  let prefs = normalizeQuestPreferences(DEFAULT_QUEST_PREFERENCES);
  for (const level of ['cinematic', 'full', 'minimal'] as const) {
    const row = getQuestSettingsRows('general', prefs).find(item => item.id === 'violence-intensity')!;
    const desktop = violenceIntensityRow(level, { match: true });
    assert.equal(row.action, 'violence-intensity');
    assert.equal(row.label, desktop.label); assert.equal(row.value, desktop.value);
    assert.ok(row.description.startsWith(desktop.description), 'Quest adds its platform note to the shared description');
    assert.ok(row.description.endsWith(VIOLENCE_COPY.noMatch), 'and says honestly that it has no match to apply it to');
    prefs = adjustQuestPreference(prefs, 'violence-intensity');
  }
  assert.equal(prefs.violence, 'cinematic');
  assert.equal(adjustQuestPreference(prefs, 'violence-intensity', -1).violence, 'minimal');
  assert.equal(resetQuestPreferences({ ...prefs, violence: 'full' }, 'general').violence, 'cinematic');
});

test('every string of the setting is translated in every offered language', () => {
  const strings = [VIOLENCE_COPY.label, ...Object.values(VIOLENCE_COPY.values), VIOLENCE_COPY.description, VIOLENCE_COPY.noMatch];
  for (const source of strings) {
    assert.ok(source in MENU_TRANSLATIONS, source);
    for (const { value } of SUPPORTED_LOCALES) if (value !== 'en') assert.notEqual(translate(source, value), source, `${value}: ${source}`);
  }
  const french = getQuestSettingsRows('general', normalizeQuestPreferences({ locale: 'fr' })).find(item => item.id === 'violence-intensity')!;
  assert.equal(french.label, translate(VIOLENCE_COPY.label, 'fr'));
  assert.equal(french.description, `${translate(VIOLENCE_COPY.description, 'fr')}\n${translate(VIOLENCE_COPY.noMatch, 'fr')}`);
});
