// Development-only native UI. Generated from shared copy; never hand-edit output.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { EALDHOLT_PREVIEW_COPY as C } from '../shared/legacy/aethelgard/copy';
import { EALDHOLT_INHERITED_COPY as I } from '../shared/legacy/aethelgard/inherited-copy';
import { EALDHOLT_PEOPLE_DRAFT } from '../shared/legacy/aethelgard/people-draft';
import { HOUSEHOLD_ACTIVITY_COPY as A } from '../shared/legacy/aethelgard/household-runtime-copy';
import { EALDHOLT_VILLAGE_VIEWS } from '../shared/legacy/aethelgard/village-views';
import { EALDHOLT_TYPOGRAPHY as T } from '../shared/legacy/aethelgard/typography';
import { EALDHOLT_INTERFACE_COPY as UI } from '../shared/legacy/aethelgard/interface-copy';
import { EALDHOLT_NATIVE_RECOVERY_COPY as R } from '../shared/legacy/aethelgard/native-recovery-copy';
import { EALDHOLT_PREVIEW_ACTIONS } from '../main-game-vr/src/legacy/aethelgard/preview-contract';
import { EALDHOLT_UI_THEME as U } from '../shared/legacy/aethelgard/ui-theme';
import { INHERITED_BANNER_PARTS } from '../shared/legacy/aethelgard/banner-editor';
import { EALDHOLT_PRESETS } from '../main-game-vr/src/legacy/aethelgard/preview-flow';
import { EALDHOLT_PANEL as L, EALDHOLT_TOUCH, EALDHOLT_TOUCH_TARGETS, previewId as id } from '../main-game-vr/src/legacy/aethelgard/preview-contract';
import { QUEST_LEGACY_COPY as Q } from '../main-game-vr/src/legacy/quest-legacy-copy';
import { spatialText } from '../main-game-vr/src/legacy/spatial-text';

function pixel(): string {
  const crc=(b:Buffer)=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(type:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([head,body,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
/** UIKit equivalent of ThreeUI Community's SectionButton inset surface. These
 * static non-interactive layers stay inside the existing real target rectangle;
 * no CSS blur, animated shader, extra canvas or hit proxy is introduced. */
function controlBevel(width: number, height: number): string {
  return `<div class="control-rim" style="position-type: absolute; position-left: 3; position-top: 3; width: ${width-6}; height: ${height-6}; pointer-events: none;"></div><div class="control-light" style="position-type: absolute; position-left: 8; position-top: 4; width: ${width-16}; height: 1; pointer-events: none;"></div>`;
}
const bevelStyle = `.control-rim { border-color: ${U.palette.accent}; border-width: 0.75; border-radius: ${Math.max(0,U.controlRadius-3)}; opacity: 0.14; pointer-events: none; }
.control-light { background-color: ${U.palette.ink}; opacity: 0.16; pointer-events: none; }`;

export async function generateEaldholtPreviewUI(destination?: string) {
  const ids=new Set<string>();let targets=0;
  const e=(s:string)=>spatialText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const identify=(s:string)=>{if(ids.has(s))throw Error('Duplicate Ealdholt element: '+s);ids.add(s);return ` id="${s}"`;};
  const rect=(x:number,y:number,w:number,h:number)=>`position-type: absolute; position-left: ${x}; position-top: ${y}; width: ${w}; height: ${h};`;
  const text=(s:string,x:number,y:number,w:number,h:number,name?:string,cls='body')=>`<span${name?identify(id(name)):''} class="${cls}" style="${rect(x,y,w,h)} pointer-events: none; z-index-offset: 3;">${e(s||'-')}</span>`;
  const button=(name:string,label:string,x:number,y:number,w:number,h=56)=>{if(h<L.minHit||w<L.minHit)throw Error('Small hand target: '+name);targets++;return `<div${identify(id(name))} class="button" style="${rect(x,y,w,h)}">${controlBevel(w,h)}${text(label,6,12,w-12,h-18,name+'_Label','button-label')}</div>`;};
  const image=(name:string,x:number,y:number,w:number,h:number)=>`<img${identify(id(name))} src="${pixel()}" style="${rect(x,y,w,h)} object-fit: fill; pointer-events: none;"/>`;
  const card=(x:number,y:number,w:number,h:number,body:string)=>`<div class="band" style="${rect(x,y,w,h)}"></div>${body}`;
  const view=(name:string,body:string)=>`<div${identify(id('View_'+name))} class="view" style="display: none;">${body}</div>`;
  const header=`<div class="header-band" style="${rect(0,0,L.width,72)}">${text(UI.house,24,8,550,44,'HouseTitle','house-title')}${text(UI.context,24,52,350,20,'HouseContext','meta')}${button('Info',UI.info,596,6,86)}</div>`;
  const intro=view('intro',card(70,300,560,134,text(UI.introSpeaker,92,316,516,22,undefined,'eyebrow')+text(UI.introBody,92,349,516,72,'IntroBody','dialogue')));
  const rail=EALDHOLT_PRESETS.map((preset,index)=>image('PresetBadge_'+index,160+index*110,340,40,64)+text(preset.label,125+index*110,406,110,36,undefined,'rail-label')).join('');
  // Original, unmarked cloth: a presentation placeholder, never a heraldry choice.
  const neutralBanner=`<div${identify(id('BannerPlaceholder'))} style="${rect(277,106,146,234)} background-color: #687365; border-color: #a2ab98; border-width: 1; opacity: 0.55; pointer-events: none;"><div style="${rect(0,0,146,4)} background-color: #b7b297; pointer-events: none;"></div></div>`;
  const banner=view('banner',text(UI.bannerHeading,190,76,320,32,'BannerHeading','title')+neutralBanner+image('BannerImage',277,106,146,234)+`<div${identify(id('PresetRail'))}>${rail}</div>`+`<div${identify(id('Editor'))} style="display: none;">${card(50,188,600,190,text('-',200,208,430,32,'EditorFieldLabel','eyebrow')+text('-',200,253,430,62,'EditorFieldValue','dialogue')+text('-',200,326,430,28,'EditorFieldCount','meta'))}</div>`+text(UI.commitConsequence,70,444,560,24,'CommitConsequence','notice')+text(C.banner.unchosen,190,82,320,30,'BannerStatus','notice'));
  const village=view('village',image('VillageBannerImage',24,88,40,66)+text(C.loading.body,190,382,420,38,'Status','notice'));
  const confirm=view('confirm',card(70,276,560,150,text(UI.bannerHeading,92,292,516,38,undefined,'title')+text(UI.commitConsequence,92,342,516,66,'ConfirmationConsequence','dialogue'))+text(I.saving,92,424,516,28,'ConfirmMessage','notice'));
  const people=view('people',card(70,316,560,106,text(UI.people,92,332,516,34,undefined,'title')+text(I.choosePerson,92,378,516,44,'PeoplePrompt','notice')));
  const household=view('household',card(50,178,600,252,text('-',74,198,552,140,'HouseholdGreeting','dialogue')+text('-',74,347,552,54,'HouseholdPrompt','question')+text(I.recorded,74,410,552,24,'HouseholdRecorded','notice'))+text('-',74,144,552,54,'HouseholdQuestion','question')+text('-',74,104,552,32,'HouseholdSpeaker','eyebrow')+text(I.entryError,74,350,552,54,'HouseholdMessage','notice')+text(I.responseLabel,74,350,552,62,'HouseholdResponse','body'));
  const activity=view('activity',card(26,176,648,260,text('-',74,192,552,38,'ActivityResident','dialogue')+text('-',74,236,552,50,'ActivityRole','question')+text('-',74,292,456,26,'ActivityField','eyebrow')+text('-',530,292,96,26,'ActivityPage','meta')+text('-',30,326,640,108,'ActivityBody','activity-body'))+text(UI.activityNote,50,444,600,24,'ActivityNote','notice'));
  const info=view('info',card(50,170,600,266,text(UI.info,74,192,552,38,undefined,'title')+text(UI.fullInfo,74,244,552,168,'InfoBody','body')));
  const sessionError=view('session-error',card(70,274,560,150,text(UI.retry,92,292,516,38,undefined,'title')+text(I.unavailable,92,342,516,76,'SessionError','body')));
  const pause=view('pause',card(190,338,320,86,text(UI.pause,214,362,272,44,undefined,'title')));
  // Old IDs remain inert for host/script compatibility. Every actual action is
  // on the near tray; this non-rendered group cannot create hidden hit areas.
  const oldActions=[...EALDHOLT_PREVIEW_ACTIONS,...EALDHOLT_PRESETS.map((_,i)=>'Preset_'+i),...[0,1,2].map(i=>'EditorPage_'+i),...INHERITED_BANNER_PARTS.flatMap(part=>['PartPrev_'+part,'PartNext_'+part]),...EALDHOLT_VILLAGE_VIEWS.map(entry=>'Inspect_'+entry.id)];
  const compatibility=`<div${identify(id('CompatibilityControls'))} style="display: none;">${oldActions.map(name=>button(name,'-',0,0,56)).join('')}${INHERITED_BANNER_PARTS.map(part=>text('-',0,0,56,28,'Value_'+part)).join('')}${text('-',0,0,56,28,'HeaderMode')}${text('-',0,0,56,28,'VisitNote')}${text('-',0,0,56,28,'Navigation')}</div>`;
  const source=`<!-- Generated by scripts/generate-ealdholt-preview-ui.ts. World-first Native Ealdholt UI. -->
<style>
@font-face { font-family: 'Barlow'; src: url('../fonts/7cHpv4kjgoGqM7EPCw.ttf'); font-weight: 400; }
@font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E30-8c4A.ttf'); font-weight: 600; }
@font-face { font-family: '${T.displayFamily}'; src: url('../${T.displayAsset}'); font-weight: ${T.displayWeight}; }
@font-face { font-family: '${T.heroFamily}'; src: url('../${T.heroAsset}'); font-weight: ${T.heroWeight}; }
.root { width: ${L.width}; height: ${L.height}; position-type: relative; font-family: 'Barlow'; color: ${U.palette.body}; }
.view { position-type: absolute; position-left: 0; position-top: 0; width: ${L.width}; height: 470; }
.band { background-color: ${U.palette.panel}; border-color: ${U.palette.border}; border-width: 1; border-radius: 4; pointer-events: none; }
.header-band { background-color: #101713; border-color: ${U.palette.border}; border-width: 1; pointer-events: none; }
.title { font-size: 26; line-height: 1.2; font-weight: 600; color: ${U.palette.ink}; text-align: center; }
.house-title { font-family: '${T.heroFamily}'; font-size: 32; font-weight: ${T.heroWeight}; color: ${U.palette.ink}; }
.eyebrow { font-size: 18; line-height: 1.2; font-weight: 600; color: ${U.palette.accent}; }
.meta { font-size: 16; color: ${U.palette.muted}; }
.rail-label { font-size: 16; line-height: 1.1; color: ${U.palette.body}; text-align: center; }
.body { font-size: 21; line-height: 1.25; color: ${U.palette.body}; }
.dialogue { font-size: 25; line-height: 1.25; color: ${U.palette.ink}; }
.question { font-size: 20; line-height: 1.2; color: ${U.palette.muted}; }
.activity-body { font-size: 23; line-height: 1.15; color: ${U.palette.ink}; }
.notice { font-size: 16; line-height: 1.2; color: ${U.palette.muted}; text-align: center; }
.button { background-color: ${U.palette.raised}; border-color: ${U.palette.border}; border-width: 1.5; border-radius: 4; pointer-events: auto; cursor: pointer; }
${bevelStyle}
.button-label { font-size: 17; font-weight: 600; line-height: 1.1; color: ${U.palette.ink}; text-align: center; }
</style>
<div${identify(id('Root'))} class="root">${header}${intro}${banner}${village}${confirm}${people}${household}${activity}${info}${sessionError}${pause}${compatibility}</div>\n`;
  const path=destination??resolve(dirname(fileURLToPath(import.meta.url)),'../main-game-vr/public/ui/ealdholt-preview.uikitml');
  await mkdir(dirname(path),{recursive:true});await writeFile(path,source);
  return {path,elements:ids.size,targets,minimumHitMetres:L.minHit/100*L.scale};
}

export async function generateEaldholtTouchUI(destination?: string) {
  const e=(s:string)=>spatialText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const labels: Record<string,string> = {
    TouchHome:UI.home,TouchPlay:UI.play,TouchPause:UI.pause,TouchBack:UI.back,
    TouchIntroContinue:UI.chooseBanner,TouchIntroSkip:UI.visitVillage,TouchCustomize:UI.edit,TouchBannerContinue:UI.begin,
    TouchFieldPrevious:UI.previousField,TouchFieldNext:UI.nextField,TouchPartPrevious:UI.previousValue,TouchPartNext:UI.nextValue,TouchEditClose:UI.done,
    TouchViews:UI.views,TouchPeople:UI.people,TouchCamera:UI.camera,TouchResetView:UI.reset,TouchRebuild:R.rebuild,
    TouchRepairPrevious:R.previous,TouchRepairNext:R.next,TouchRepairStart:R.rebuild,
    TouchOrbitLeft:C.controls.orbitLeft,TouchOrbitRight:C.controls.orbitRight,TouchTiltUp:C.controls.tiltUp,TouchTiltDown:C.controls.tiltDown,TouchZoomIn:C.controls.zoomIn,TouchZoomOut:C.controls.zoomOut,
    TouchConfirmEntry:UI.begin,TouchConfirmBack:UI.back,TouchFollowup:UI.details,TouchActivityOpen:UI.activity,
    TouchActivityPrevious:A.previous,TouchActivityDetail:UI.details,TouchActivityNext:A.next,
    TouchResume:UI.resume,TouchInfo:UI.info,TouchRecenter:Q.dock.recenter,TouchExit:Q.dock.exit,TouchSessionRetry:UI.retry,TouchRetry:UI.retry,TouchEditBanner:UI.chooseBanner,
    ...Object.fromEntries(EALDHOLT_PRESETS.map((preset,index)=>['TouchPreset_'+index,preset.label])),
    ...Object.fromEntries(EALDHOLT_PEOPLE_DRAFT.map((person,index)=>['TouchPerson_'+index,person.roleLabel])),
    ...Object.fromEntries(EALDHOLT_VILLAGE_VIEWS.map(entry=>['TouchInspect_'+entry.id,entry.label])),
  };
  const buttons=EALDHOLT_TOUCH_TARGETS.map(target=>{
    if(Math.min(target.width,target.height)<EALDHOLT_TOUCH.minHit) throw Error('Small Ealdholt near target: '+target.name);
    const role=['TouchHome','TouchPlay','TouchPause','TouchBack'].includes(target.name)?'global'
      :['TouchViews','TouchPeople','TouchCamera','TouchRebuild'].includes(target.name)?'context'
      :['TouchIntroContinue','TouchBannerContinue','TouchConfirmEntry','TouchResume','TouchSessionRetry'].includes(target.name)?'primary':'secondary';
    return `<div id="${id(target.name)}" class="touch-button touch-${role}" style="position-type: absolute; position-left: ${target.x}; position-top: ${target.y}; width: ${target.width}; height: ${target.height}; display: none;">${controlBevel(target.width,target.height)}<span id="${id(target.name+'_Label')}" class="touch-label-${role}" style="position-type: absolute; position-left: 6; position-top: 12; width: ${target.width-12}; height: ${target.height-18}; pointer-events: none;">${e(labels[target.name]??'-')}</span></div>`;
  }).join('');
  const source=`<!-- Generated by scripts/generate-ealdholt-preview-ui.ts. Contextual near-hand dock. -->
<style>
@font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E30-8c4A.ttf'); font-weight: 600; }
.touch-root { width: ${EALDHOLT_TOUCH.width}; height: ${EALDHOLT_TOUCH.height}; position-type: relative; pointer-events: none; font-family: 'Barlow'; font-size: 17; font-weight: 600; line-height: 1.1; text-align: center; color: ${U.palette.ink}; }
${bevelStyle}
.touch-button { background-color: ${U.palette.raised}; border-color: ${U.palette.border}; border-width: 1.5; border-radius: 4; pointer-events: auto; cursor: pointer; }
.touch-context { background-color: ${U.palette.primary}; border-color: ${U.palette.accent}; border-width: 2; color: ${U.palette.accent}; }
.touch-global { background-color: ${U.palette.panel}; border-color: ${U.palette.raised}; border-width: 1; color: ${U.palette.body}; }
.touch-primary { background-color: ${U.palette.accent}; border-color: ${U.palette.accent}; color: ${U.palette.accentInk}; }
.touch-label-context { font-size: 20; }
.touch-label-primary { font-size: 18; }
</style>
<div id="${id('TouchRoot')}" class="touch-root">${buttons}<span id="${id('TouchRecoveryStatus')}" style="position-type: absolute; position-left: 8; position-top: 8; width: 544; height: 56; font-size: 17; display: none; pointer-events: none;">${e(R.noDamage)}</span></div>\n`;
  const path=destination??resolve(dirname(fileURLToPath(import.meta.url)),'../main-game-vr/public/ui/ealdholt-inherited-touch.uikitml');
  await mkdir(dirname(path),{recursive:true});await writeFile(path,source);
  return {path,elements:2+EALDHOLT_TOUCH_TARGETS.length*2,targets:EALDHOLT_TOUCH_TARGETS.length,minimumTouchMetres:EALDHOLT_TOUCH.minHit/100*EALDHOLT_TOUCH.scale};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) Promise.all([generateEaldholtPreviewUI(process.argv[2]),generateEaldholtTouchUI()]).then(report=>console.log(JSON.stringify(report)));
