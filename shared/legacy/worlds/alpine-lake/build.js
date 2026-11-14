/** Original Crownfall alpine world. No unlicensed upstream code, shaders or art.
 * A U-shaped glacial trough closed by a cirque, pyramidal peaks, a mirror-calm lake, conifer stands
 * and twin falls dropping from a hanging valley on the east shore; not the former Bannerhold with
 * cone-shaped backdrop props. Everything is generated here, deterministically, from noise. */
import { createTerrainHubs, createSourceClearance } from '../exploration';
import { MeshBVH } from 'crownfall-world-bvh';
export async function buildWorld(ctx) {
  const T=ctx.THREE, root=new T.Group();root.name='Crownfall / Alpine valley';
  const quest=ctx.profile==='quest';
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  const hash=(x,z)=>{let h=Math.imul(x,374761393)+Math.imul(z,668265263)|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
  function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz,a=u*u*(3-2*u),b=v*v*(3-2*v);return (hash(ix,iz)*(1-a)+hash(ix+1,iz)*a)*(1-b)+(hash(ix,iz+1)*(1-a)+hash(ix+1,iz+1)*a)*b;}
  function fbm(x,z,octaves=5){let n=0,a=.5;for(let i=0;i<octaves;i++){n+=a*noise(x,z);const px=.8*x-.6*z;z=(.6*x+.8*z)*2.03+11.4;x=px*2.03-4.2;a*=.5;}return n;}
  function ridged(x,z,octaves=6){let n=0,a=.5,w=1;for(let i=0;i<octaves;i++){let s=1-Math.abs(noise(x,z)*2-1);s*=s;n+=s*a*w;w=clamp(s*1.7);const px=.8*x-.6*z;z=(.6*x+.8*z)*2.03-7.7;x=px*2.03+13.1;a*=.5;}return n;}

  // ---- the valley: everything below reads this one height function
  const LAKE=.2,SHORE=1.016,SHORE_RISE=1.2;// the waterline is the lake's outline, not the terrain grid's
  const lakeWidth=z=>125+28*Math.sin(z*.008)+14*Math.sin(z*.019);
  const lakeRadius=(x,z)=>Math.hypot(x/lakeWidth(z),(z+180)/470)+.022*Math.sin(x*.031+z*.017)+.013*Math.sin(x*.073-z*.041);
  const peaks=[[-800,-520,620,420,500],[-600,-1120,760,400,380],[-210,-1420,780,370,320],[215,-1360,880,350,300],[620,-1120,750,400,380],[840,-500,640,420,500],[-860,300,430,380,430],[880,220,460,380,430]];
  // East shore: a rock step facing the lake and the viewer, the front of a hanging valley.
  const STEP={x:170,z:-486,top:238,falls:[-32,38]};
  const stepCoords=(x,z)=>{const dx=x-STEP.x,dz=z-STEP.z;return [dx*.91+dz*.42,dz*.91-dx*.42];};
  const stepPoint=(s,d)=>[STEP.x+s*.91-d*.42,STEP.z+s*.42+d*.91];
  function hangingValley(x,z,ground){
    const [s,d0]=stepCoords(x,z);
    // Tapers away west into the lake and merges with the valley wall east of it.
    const side=smooth(-190,-62,s)*(1-smooth(150,300,s)),back=1-smooth(250,430,-d0);
    if(side<=0||back<=0)return ground;
    let d=d0+(fbm(s*.021+3,d0*.012+1,4)-.5)*48;
    for(const f of STEP.falls)d+=15*Math.exp(-(((s-f)/17)**2));
    // Two tiers with a ledge between, not a single wall.
    const face=.57*(1-smooth(-14,5,d))+.43*(1-smooth(4,33,d));
    const shelf=STEP.top+Math.max(0,-d0)*.14+(ridged(x*.0105+4,z*.0105,4)-.4)*74;
    return Math.max(ground,shelf*face*side*back);
  }
  function height(x,z){
    const valley=Math.abs(x+25*Math.sin(z*.004)),edge=lakeWidth(z);
    // A forested skirt, then rock: the U of a glacial trough.
    const t=clamp((valley-edge-22)/620),wall=430*(.3*smooth(0,.38,t)+.7*Math.pow(smooth(.16,1,t),1.15));
    let envelope=Math.max(wall,smooth(-700,-1130,z)*480*(.6+.4*smooth(0,320,valley)));
    for(const[px,pz,h,rx,rz]of peaks){
      const dx=Math.abs(x-px)/rx,dz=Math.abs(z-pz)/rz,d=mix(Math.hypot(dx,dz),(dx+dz)*.74,.55),q=1-d;
      if(q>0)envelope=Math.max(envelope,h*Math.pow(q,1.02));
    }
    const wx=x+(fbm(x*.004+7,z*.004+2,2)-.5)*170,wz=z+(fbm(x*.004-3,z*.004+9,2)-.5)*170;
    const rock=smooth(50,290,envelope),r=ridged(wx*.0038,wz*.0038);
    const gully=1-Math.abs(noise(wz*.021+wx*.002,valley*.0026)*2-1);
    const mountain=envelope*mix(1,.56+.82*r,rock)+gully*gully*44*rock+ridged(wx*.0165+2,wz*.0165,4)*42*rock;
    const radius=lakeRadius(x,z);
    const basin=-12+14*smooth(.9,1.06,radius)+6*smooth(1,1.7,radius);
    const hills=(fbm(x*.017,z*.017,3)-.44)*14*smooth(1.02,1.5,radius);
    return hangingValley(x,z,basin+mountain+hills);
  }

  // Tileable noise shared by rock, water, falls and sky: two texture reads replace per-pixel noise.
  ctx.onProgress?.('Shaping the glacial valley');
  const tileSize=256,tileData=new Uint8Array(tileSize*tileSize*4);
  {
    const lattice=(x,y,period,seed)=>{const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy,a=u*u*(3-2*u),b=v*v*(3-2*v),h=(p,q)=>hash(((p%period)+period)%period+seed,((q%period)+period)%period-seed);return (h(ix,iy)*(1-a)+h(ix+1,iy)*a)*(1-b)+(h(ix,iy+1)*(1-a)+h(ix+1,iy+1)*a)*b;};
    const channel=(x,y,seed,ridge)=>{let n=0,a=.5,period=6,w=1;for(let o=0;o<5;o++){const f=period/tileSize;let s=lattice(x*f,y*f,period,seed+o*17);if(ridge){s=1-Math.abs(s*2-1);s*=s;n+=s*a*w;w=clamp(s*1.8);}else n+=s*a;a*=.5;period*=2;}return n;};
    for(let y=0,k=0;y<tileSize;y++){if(y%48===47)await pause();for(let x=0;x<tileSize;x++,k+=4){
      tileData[k]=clamp((channel(x,y,1)-.47)*1.9+.5)*255;tileData[k+1]=clamp((channel(x,y,37)-.47)*1.9+.5)*255;
      tileData[k+2]=clamp(channel(x,y,91,true)*1.5)*255;tileData[k+3]=clamp((channel(x,y,140)-.47)*1.9+.5)*255;
    }}
  }
  const tile=new T.DataTexture(tileData,tileSize,tileSize,T.RGBAFormat);
  tile.wrapS=tile.wrapT=T.RepeatWrapping;tile.minFilter=T.LinearMipmapLinearFilter;tile.magFilter=T.LinearFilter;tile.generateMipmaps=true;
  tile.anisotropy=Math.min(quest?2:8,ctx.renderer?.capabilities?.getMaxAnisotropy?.()??1);tile.needsUpdate=true;
  await pause();

  // Uniform height samples, for the sun march, occlusion, tree placement and the lake reflection.
  const hx=quest?150:240,hz=quest?180:290,field=new Float32Array((hx+1)*(hz+1));
  for(let j=0;j<=hz;j++){for(let i=0;i<=hx;i++)field[j*(hx+1)+i]=height(-900+i/hx*1800,-1500+j/hz*2150);if(j%48===47)await pause();}
  const groundAt=(x,z)=>{
    const u=clamp((x+900)/1800)*hx,v=clamp((z+1500)/2150)*hz,i=Math.min(hx-1,Math.floor(u)),j=Math.min(hz-1,Math.floor(v)),a=u-i,b=v-j,k=j*(hx+1)+i;
    return (field[k]*(1-a)+field[k+1]*a)*(1-b)+(field[k+hx+1]*(1-a)+field[k+hx+2]*a)*b;
  };
  const sunDirection=[-.72,.62,.3],sun=new T.Vector3(...sunDirection).normalize();
  const sunVisibility=(x,y,z)=>{let vis=1,t=11;for(let i=0;i<18;i++){t*=1.28;const px=x+sun.x*t,pz=z+sun.z*t;if(Math.abs(px)>900||pz<-1500||pz>650)break;const clearance=y+sun.y*t-groundAt(px,pz);if(clearance<0){vis=Math.min(vis,clamp(1+clearance/(t*.09+5)));if(vis<=0)break;}}return vis;};
  const openness=(x,y,z)=>{let occluded=0;for(let i=0;i<8;i++){const a=i*.7854,c=Math.cos(a),s=Math.sin(a);occluded+=Math.max(0,groundAt(x+c*55,z+s*55)-y)/55+Math.max(0,groundAt(x+c*190,z+s*190)-y)/190;}return clamp(1/(1+occluded*.19),.42,1);};
  const forestDensity=(x,z,y,slope)=>{
    const stands=smooth(.3,.46,fbm(x*.0062+5,z*.0062-2,3));
    const chutes=1-.85*smooth(.72,.86,noise(z*.024+fbm(x*.0035+1,z*.0035-4,2)*6,Math.abs(x)*.003+2))*smooth(60,160,y);
    return stands*chutes*(1-smooth(245,345,y))*(1-smooth(.95,1.35,slope))*smooth(1.05,1.14,lakeRadius(x,z))*smooth(205,270,Math.hypot(x-24,z-365));
  };

  // ---- terrain: the grid packs its vertices around the lake and the falls
  const warp=(u,a)=>a*u+(1-a)*u*u*u;
  const nx=quest?160:290,nz=quest?180:330,positions=new Float32Array((nx+1)*(nz+1)*3),colors=new Float32Array((nx+1)*(nz+1)*3),shade=new Float32Array((nx+1)*(nz+1)*2);
  for(let j=0,k=0;j<=nz;j++){for(let i=0;i<=nx;i++,k+=3){const x=900*warp(i/nx*2-1,.5),v=j/nz*2-1,z=-200+(v<0?1300:850)*warp(v,.6);positions[k]=x;positions[k+1]=height(x,z);positions[k+2]=z;}if(j%48===47)await pause();}
  const ground=new T.BufferGeometry();
  ground.setAttribute('position',new T.BufferAttribute(positions,3));
  const allIndices=[];for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,d=a+nx+1;allIndices.push(a,d,b,b,d,d+1);}
  ground.setIndex(allIndices);ground.computeVertexNormals();
  const normalAttribute=ground.getAttribute('normal');
  const meadow=new T.Color('#667a38'),straw=new T.Color('#8d8650'),understory=new T.Color('#27361f'),talus=new T.Color('#7b786d'),gravel=new T.Color('#6f6d60');
  const fallWet=(x,z)=>{const[s,d]=stepCoords(x,z);if(d<-40||d>70)return 0;let wet=0;for(const f of STEP.falls)wet=Math.max(wet,Math.exp(-(((s-f)/24)**2)));return wet*(1-smooth(20,70,d));};
  const c=new T.Color();
  for(let v=0;v<(nx+1)*(nz+1);v++){
    const x=positions[v*3],y=positions[v*3+1],z=positions[v*3+2],slope=Math.sqrt(Math.max(0,1-normalAttribute.getY(v)**2))/Math.max(.05,normalAttribute.getY(v));
    c.copy(meadow).lerp(straw,smooth(.47,.68,fbm(x*.013,z*.013,3))*.55);
    c.lerp(understory,clamp(forestDensity(x,z,y,slope)*1.15));
    c.lerp(talus,smooth(.55,1.05,slope)*.85);
    c.lerp(gravel,1-smooth(.5,1.7,y));
    colors[v*3]=c.r;colors[v*3+1]=c.g;colors[v*3+2]=c.b;
    shade[v*2]=sunVisibility(x,y+1.5,z);shade[v*2+1]=openness(x,y,z)*(1-.42*fallWet(x,z));
    if(v%6000===5999)await pause();
  }
  ground.setAttribute('color',new T.BufferAttribute(colors,3));ground.setAttribute('aShade',new T.BufferAttribute(shade,2));
  // Nothing is drawn under the water, so the reflection below reaches right to the shoreline.
  await pause();
  const dryIndices=[],shoreIndices=[];
  const radiusAt=v=>lakeRadius(positions[v*3],positions[v*3+2]);
  for(let t=0;t<allIndices.length;t+=3){
    const[A,B,E]=[allIndices[t],allIndices[t+1],allIndices[t+2]],ya=positions[A*3+1],yb=positions[B*3+1],ye=positions[E*3+1],low=Math.min(ya,yb,ye),high=Math.max(ya,yb,ye);
    const inner=Math.min(radiusAt(A),radiusAt(B),radiusAt(E)),outer=Math.max(radiusAt(A),radiusAt(B),radiusAt(E));
    if(high<LAKE&&outer<SHORE)continue;
    (low<LAKE+SHORE_RISE&&inner<SHORE+.01?shoreIndices:dryIndices).push(A,B,E);
  }
  ground.setIndex(dryIndices);ground.computeBoundingSphere();
  const shoreGround=new T.BufferGeometry();for(const name of ['position','normal','color','aShade'])shoreGround.setAttribute(name,ground.getAttribute(name));shoreGround.setIndex(shoreIndices);

  // Aerial perspective, in source metres so it holds at both the desktop and the miniature scale.
  const shared={time:{value:0},eye:{value:new T.Vector3(24,18,365)},tile:{value:tile},haze:{value:new T.Color(.56,.70,.88)},hazeK:{value:.00015},sun:{value:sun}};
  const HAZE_VERTEX=`vec4 hzp=vec4(position,1.);
#ifdef USE_INSTANCING
hzp=instanceMatrix*hzp;
#endif
vHaze=(1.-exp(-length(hzp.xyz-uEye)*uHazeK))*exp(-max(hzp.y,0.)*.00045);`;
  const hazed=(material,{key,vertexHead='',vertexBody='',fragmentHead='',colorBody='',normalBody=''})=>{
    material.fog=false;
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{uEye:shared.eye,uHazeK:shared.hazeK,uHaze:shared.haze,uTile:shared.tile,uSun:shared.sun,uSnow:{value:405}});
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform vec3 uEye;uniform float uHazeK;varying float vHaze;${vertexHead}`).replace('#include <begin_vertex>',`#include <begin_vertex>\n${HAZE_VERTEX}\n${vertexBody}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform vec3 uHaze;uniform vec3 uSun;uniform sampler2D uTile;uniform float uSnow;varying float vHaze;${fragmentHead}`).replace('#include <color_fragment>',`#include <color_fragment>\n${colorBody}`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${normalBody}`).replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.rgb=mix(gl_FragColor.rgb,uHaze,vHaze);');
    };
    material.customProgramCacheKey=()=>`crownfall-alpine-${key}`;
    return material;
  };
  const terrainPatch={
    vertexHead:'attribute vec2 aShade;varying vec3 vSrc;varying vec3 vSrcN;varying vec2 vShade;varying mat3 vToView;',
    vertexBody:'vSrc=position;vSrcN=normal;vShade=aShade;vToView=normalMatrix;',
    fragmentHead:'varying vec3 vSrc;varying vec3 vSrcN;varying vec2 vShade;varying mat3 vToView;',
    colorBody:`#ifdef CLIP_TO_SHORE
{float inside=(length(vec2(vSrc.x/(125.+28.*sin(vSrc.z*.008)+14.*sin(vSrc.z*.019)),(vSrc.z+180.)/470.))+.022*sin(vSrc.x*.031+vSrc.z*.017)+.013*sin(vSrc.x*.073-vSrc.z*.041));if(inside<${(SHORE-.004).toFixed(3)}&&vSrc.y<${(LAKE+SHORE_RISE).toFixed(2)})discard;}
#endif
vec3 Ng=normalize(vSrcN);float steep=1.-Ng.y;
vec4 t1=texture2D(uTile,vSrc.xz*.0052);vec2 warped=(t1.rg-.5)*.28;vec4 t2=texture2D(uTile,vSrc.xz*.037+(t1.rg-.5)*.9);
vec4 t3=texture2D(uTile,vec2(vSrc.x*.87+vSrc.z*.5,vSrc.y*.2)*.052+warped);
float rockW=smoothstep(.17,.36,steep+(t1.r-.5)*.2+(t2.g-.5)*.1)+smoothstep(320.,430.,vSrc.y+(t1.g-.5)*120.)*.8;
float band=.5+.5*sin(vSrc.y*.07+t1.a*6.+t3.g*2.);
vec3 rock=mix(vec3(.13,.13,.145),vec3(.43,.40,.36),clamp(t3.r*.62+band*.24+t2.a*.3-.08,0.,1.));
rock*=(.78+.44*t1.a)*(1.-.55*smoothstep(.5,.82,t3.b));
vec3 ground=diffuseColor.rgb*(.72+.56*t2.r)*(.86+.28*t1.b);
vec3 albedo=mix(ground,rock,clamp(rockW,0.,1.));
float snow=smoothstep(uSnow-14.,uSnow+18.,vSrc.y+(t1.b-.5)*210.+(t2.b-.5)*70.)*(1.-smoothstep(.40,.66,steep+(t2.r-.5)*.3));
albedo=mix(albedo,vec3(.84,.87,.92)*(.92+.14*t2.g),snow);
// the renderer's sun ignores the valley's shadows: take back the direct share the march says is blocked
float sunFacing=max(0.,dot(Ng,uSun));
albedo*=(.36+1.02*sunFacing*vShade.x)/(.36+1.02*sunFacing)*mix(vec3(.88,.95,1.14),vec3(1.),vShade.x)*vShade.y;
diffuseColor.rgb=albedo;`,
    normalBody:'normal=normalize(normal+vToView*(vec3(t1.a-.5,0.,t1.r-.5)*.5+vec3(t2.r-.5,(t3.r-.5)*smoothstep(.15,.5,steep),t2.g-.5)*.5+vec3(t3.g-.5,0.,t3.a-.5)*.42*smoothstep(.15,.5,steep))*(1.-snow*.7));',
  };
  const terrainMaterial=hazed(new T.MeshStandardMaterial({vertexColors:true,roughness:.95}),{key:'terrain',...terrainPatch});
  const terrain=new T.Mesh(ground,terrainMaterial);terrain.name='Alpine / continuous mountain basin';root.add(terrain);
  const shoreMaterial=hazed(new T.MeshStandardMaterial({vertexColors:true,roughness:.95}),{key:'shore',...terrainPatch});shoreMaterial.defines={...shoreMaterial.defines,CLIP_TO_SHORE:1};
  const shore=new T.Mesh(shoreGround,shoreMaterial);shore.name='Alpine / lake shore';root.add(shore);
  await pause();ctx.onProgress?.('Growing the lakeside forest');

  // ---- forest: layered bough tiers, drawn coarser beyond the distance they can be told apart
  const conifer=(tiers,sides)=>{
    const p=[],n=[],k=[];
    for(let t=0;t<tiers;t++){
      const f=t/tiers,y0=.09+.86*f,y1=Math.min(1,y0+(1.75/tiers)*(.9-.3*f)),r=1-f*.87;
      for(let i=0;i<sides;i++){
        const a0=(i+t*.5)/sides*Math.PI*2,a1=(i+1+t*.5)/sides*Math.PI*2,am=(a0+a1)/2;
        const r0=r*(1+.2*hash(t*7+i,3)-.1),r1=r*(1+.2*hash(t*7+(i+1)%sides,3)-.1);
        p.push(0,y1,0,Math.cos(a1)*r1,y0,Math.sin(a1)*r1,Math.cos(a0)*r0,y0,Math.sin(a0)*r0);
        n.push(Math.cos(am)*.45,.89,Math.sin(am)*.45,Math.cos(a1)*.82,.57,Math.sin(a1)*.82,Math.cos(a0)*.82,.57,Math.sin(a0)*.82);
        const dark=.5+.25*f;k.push(dark,dark,dark,1,1,1,1,1,1);
      }
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('color',new T.Float32BufferAttribute(k,3));return g;
  };
  let seed=19271;const rnd=()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
  const [fallA,fallB]=STEP.falls;
  const anchors=[['banner-hall',-164,45],['muster-grounds',-160,170],['war-record',160,-190],['heralds-station',-140,340]];
  const want=quest?11000:22000,sites=[];
  for(let k=0;k<want*14&&sites.length<want;k++){
    if(k%6000===5999)await pause();
    const x=-720+rnd()*1440,z=-1240+rnd()*1810,y=groundAt(x,z);
    if(y<1.6||y>345||Math.hypot(x-24,z-365)<205)continue;
    const slope=Math.hypot(groundAt(x+9,z)-groundAt(x-9,z),groundAt(x,z+9)-groundAt(x,z-9))/18;
    if(rnd()>forestDensity(x,z,y,slope))continue;
    const[s,d]=stepCoords(x,z);
    if(d>-260&&d<130&&(Math.abs(s-fallA)<26||Math.abs(s-fallB)<26))continue;
    if(d>-60&&d<90&&s>-200&&s<300)continue;// nothing grows on the rock step's face
    if(anchors.some(([,ax,az])=>Math.hypot(x-ax,z-az)<26))continue;
    const h=(17+rnd()*21)*(1-.55*smooth(190,335,y));
    sites.push({x,y,z,h,w:h*(.19+rnd()*.06),yaw:rnd()*6.283,reach:Math.hypot(x-24,z-365),shore:lakeRadius(x,z)<1.32});
  }
  await pause();
  const treeMaterial=hazed(new T.MeshStandardMaterial({vertexColors:true,roughness:.95,name:'tree-foliage'}),{key:'tree'});
  const trunkMaterial=hazed(new T.MeshStandardMaterial({color:'#40362b',roughness:1,name:'tree-bark'}),{key:'trunk'});
  const matrix=new T.Matrix4(),q=new T.Quaternion(),up=new T.Vector3(0,1,0),v=new T.Vector3(),scale=new T.Vector3(),treeColor=new T.Color();
  const standsFrom=(list,geometry,name)=>{
    const mesh=new T.InstancedMesh(geometry,treeMaterial,list.length);mesh.name=name;
    list.forEach((site,i)=>{
      q.setFromAxisAngle(up,site.yaw);matrix.compose(v.set(site.x,site.y-.5,site.z),q,scale.set(site.w,site.h,site.w));mesh.setMatrixAt(i,matrix);
      const stand=noise(site.x*.012+9,site.z*.012);
      treeColor.setHSL(.27+stand*.07+rnd()*.018,.26+rnd()*.14,.03+rnd()*.03+stand*.014);
      if(stand>.74&&site.y>120)treeColor.lerp(new T.Color('#6f7b34'),.5);
      treeColor.multiplyScalar(mix(.42,1,sunVisibility(site.x,site.y+site.h*.5,site.z)));
      mesh.setColorAt(i,treeColor);
    });
    root.add(mesh);return mesh;
  };
  standsFrom(quest?sites:sites.filter(site=>site.reach>=580),conifer(3,4),'Alpine / conifer stands');
  if(!quest){standsFrom(sites.filter(site=>site.reach<580&&site.reach>=330),conifer(5,5),'Alpine / middle conifer stands');standsFrom(sites.filter(site=>site.reach<330),conifer(8,7),'Alpine / near conifer stands');}
  const trunkSites=quest?sites.filter(site=>site.shore).slice(0,1200):sites.filter(site=>site.reach<580);
  const trunkGeometry=new T.CylinderGeometry(.13,.2,1,quest?3:5,1,true);trunkGeometry.translate(0,.5,0);
  const trunks=new T.InstancedMesh(trunkGeometry,trunkMaterial,trunkSites.length);trunks.name='Alpine / forest trunks';
  trunkSites.forEach((site,i)=>{q.setFromAxisAngle(up,site.yaw);matrix.compose(v.set(site.x,site.y-.8,site.z),q,scale.set(site.w,site.h*.42,site.w));trunks.setMatrixAt(i,matrix);});
  root.add(trunks);
  await pause();ctx.onProgress?.('Filling the lake and waterfalls');

  // ---- lake: sky, depth colour and ripples here; the mirrored valley is drawn straight over it
  const radiusGlsl=p=>`(length(vec2(${p}.x/(125.+28.*sin(${p}.z*.008)+14.*sin(${p}.z*.019)),(${p}.z+180.)/470.))+.022*sin(${p}.x*.031+${p}.z*.017)+.013*sin(${p}.x*.073-${p}.z*.041))`,lakeRadiusGlsl=radiusGlsl('p');
  const lakeGeometry=new T.BufferGeometry();
  lakeGeometry.setAttribute('position',new T.Float32BufferAttribute([-320,0,-780,-320,0,340,320,0,340,320,0,-780],3));lakeGeometry.setIndex([0,1,2,0,2,3]);
  const lakeMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:shared.time,eye:shared.eye,tile:shared.tile,sun:shared.sun},
    vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 p;uniform float time;uniform vec3 eye;uniform vec3 sun;uniform sampler2D tile;
void main(){
  vec2 a=texture2D(tile,p.xz*.019+vec2(time*.0035,time*.002)).rg-.5,b=texture2D(tile,p.xz*.071-vec2(time*.006,-time*.0028)).gb-.5;
  vec3 N=normalize(vec3((a.x+b.x*.6)*.13,1.,(a.y+b.y*.6)*.13)),V=normalize(eye-p);
  float F=.02+.98*pow(1.-max(0.,dot(N,V)),5.);vec3 R=reflect(-V,N);
  vec3 sky=mix(vec3(.42,.58,.76),vec3(.05,.15,.38),clamp(R.y*1.9,0.,1.));
  float radius=${lakeRadiusGlsl};
  vec3 col=mix(vec3(.006,.052,.07),vec3(.022,.115,.12),smoothstep(.6,1.03,radius));
  col=mix(col,sky,F);col+=vec3(1.,.92,.78)*pow(max(0.,dot(R,sun)),260.)*2.4;
  gl_FragColor=vec4(col,1.-smoothstep(${(SHORE-.002).toFixed(3)},${(SHORE+.002).toFixed(3)},radius));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
  const lake=new T.Mesh(lakeGeometry,lakeMaterial);lake.name='Alpine / glacial lake';lake.position.y=LAKE;lake.renderOrder=1;root.add(lake);

  // The reflection is the real valley mirrored at the water plane, coarser, with lighting and the
  // forest canopy baked in. Nothing is drawn under the water, so ordinary depth testing confines it
  // to the lake; the radius test keeps it from showing below the edge of the Quest miniature.
  {
    const rx=quest?64:150,rz=quest?52:116,mp=new Float32Array((rx+1)*(rz+1)*3),mc=new Float32Array((rx+1)*(rz+1)*3),keep=new Uint8Array((rx+1)*(rz+1));
    const skyLight=new T.Color('#b4c8d5'),groundLight=new T.Color('#354332'),sunLight=new T.Color('#fff1d6'),canopy=new T.Color('#1d3020'),rockTone=new T.Color('#7f7c74'),snowTone=new T.Color('#e4e8ee'),grass=new T.Color('#667a38');
    const lit=new T.Color(),n=new T.Vector3();
    for(let j=0,k=0;j<=rz;j++)for(let i=0;i<=rx;i++,k++){
      const x=900*warp(i/rx*2-1,.45),z=300-1800*(j/rz);
      const y=groundAt(x,z),e=14;n.set(groundAt(x-e,z)-groundAt(x+e,z),2*e,groundAt(x,z-e)-groundAt(x,z+e)).normalize();
      const slope=Math.sqrt(1-n.y*n.y)/Math.max(.05,n.y),trees=clamp(forestDensity(x,z,y,slope)*1.3);
      lit.copy(grass).lerp(canopy,trees).lerp(rockTone,smooth(.6,1.1,slope)*.9).lerp(snowTone,smooth(395,470,y+(noise(x*.02,z*.02)-.5)*150)*(1-smooth(1,1.8,slope)));
      const irradiance=Math.max(0,n.dot(sun))*sunVisibility(x,y+2,z)*1.02,mixSky=.5+.5*n.y,ao=openness(x,y,z);
      mc[k*3]=lit.r*(mix(groundLight.r,skyLight.r,mixSky)*.7+sunLight.r*irradiance)*ao;mc[k*3+1]=lit.g*(mix(groundLight.g,skyLight.g,mixSky)*.7+sunLight.g*irradiance)*ao;mc[k*3+2]=lit.b*(mix(groundLight.b,skyLight.b,mixSky)*.7+sunLight.b*irradiance)*ao;
      mp[k*3]=x;mp[k*3+1]=2*LAKE-(y+trees*22);mp[k*3+2]=z;keep[k]=y>LAKE?1:0;
      if(k%5000===4999)await pause();
    }
    const mi=[];
    for(let j=0;j<rz;j++)for(let i=0;i<rx;i++){const a=j*(rx+1)+i,b=a+1,d=a+rx+1,e=d+1;if(!keep[a]&&!keep[b]&&!keep[d]&&!keep[e])continue;mi.push(a,d,b,b,d,e);}
    const mirrorGeometry=new T.BufferGeometry();mirrorGeometry.setAttribute('position',new T.BufferAttribute(mp,3));mirrorGeometry.setAttribute('aLit',new T.BufferAttribute(mc,3));mirrorGeometry.setIndex(mi);
    const mirrorMaterial=new T.ShaderMaterial({transparent:true,uniforms:{time:shared.time,eye:shared.eye,tile:shared.tile,haze:shared.haze,hazeK:shared.hazeK},
      vertexShader:'attribute vec3 aLit;varying vec3 q;varying vec3 vLit;void main(){q=position;vLit=aLit;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 q;varying vec3 vLit;uniform float time;uniform vec3 eye;uniform vec3 haze;uniform float hazeK;uniform sampler2D tile;
void main(){
  vec3 ray=q-eye;float hitT=(${LAKE.toFixed(2)}-eye.y)/ray.y;vec3 p=eye+ray*hitT;
  float radius=${lakeRadiusGlsl};
  vec2 ripple=texture2D(tile,p.xz*.023+vec2(time*.004,0.)).rg-.5;
  float streak=texture2D(tile,vec2(p.x*.0065,p.z*.06+time*.003)).b;
  float cosV=clamp(abs(ray.y)/length(ray),0.,1.),F=.02+.98*pow(1.-cosV,5.);
  float alpha=clamp(mix(.62,.98,F)+ripple.x*.14-streak*.1,0.,1.)*(1.-smoothstep(${(SHORE-.002).toFixed(3)},${(SHORE+.002).toFixed(3)},radius));
  vec3 col=vLit*(1.+ripple.y*.26)*(1.12-.34*streak);
  col=mix(col*.84,haze,(1.-exp(-length(ray)*hazeK))*.42);
  gl_FragColor=vec4(col,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    const mirror=new T.Mesh(mirrorGeometry,mirrorMaterial);mirror.name='Alpine / lake reflection';mirror.renderOrder=2;mirror.frustumCulled=false;root.add(mirror);
  }
  await pause();

  // ---- twin falls: ribbons of original geometry down the rock step, with their source streams,
  // run-out to the lake and spray in one draw. Each ribbon is checked against the terrain below it.
  {
    const fp=[],fq=[],fi=[];
    const ribbon=(points,kind,across)=>{
      const start=fp.length/3;let run=0;
      points.forEach(([x,y,z,w],i)=>{
        if(i){const[a,b,e]=points[i-1];run+=Math.hypot(x-a,y-b,z-e);}
        fp.push(x-across[0]*w/2,y,z-across[1]*w/2,x+across[0]*w/2,y,z+across[1]*w/2);
        fq.push(0,run,kind,1,run,kind);
        if(i){const k=start+(i-1)*2;fi.push(k,k+2,k+1,k+1,k+2,k+3);}
      });
    };
    const spray=(x,y,z,r)=>{for(const a of [.6,2.2]){const cx=Math.cos(a)*r,cz=Math.sin(a)*r,k=fp.length/3;fp.push(x-cx,y-r*.25,z-cz,x+cx,y-r*.25,z+cz,x+cx,y+r*1.1,z+cz,x-cx,y+r*1.1,z-cz);fq.push(0,0,2,1,0,2,1,1,2,0,1,2);fi.push(k,k+1,k+2,k,k+2,k+3);}};
    const tangent=[.91,.42];
    STEP.falls.forEach((s,index)=>{
      const fall=[],steps=quest?20:34,wide=index===0?[17,30]:[13,25];
      let last=null;
      for(let k=0;k<=steps;k++){
        const f=k/steps,y=mix(STEP.top+6,LAKE+1.5,f);
        let d=-30+Math.sqrt(f)*40,sNow=s+Math.sin(f*7+index)*1.6;
        let[x,z]=stepPoint(sNow,d);
        for(let tries=0;tries<40&&height(x,z)+4.5>y;tries++){d+=1.5;[x,z]=stepPoint(sNow,d);}
        d+=quest?8:4;[x,z]=stepPoint(sNow,d);// clear of the coarser terrain mesh, not only of the height function
        fall.push([x,y,z,mix(wide[0],wide[1],Math.pow(f,.8))]);last=[x,y,z];
      }
      // upstream on the shelf, from the far end of the hanging valley down to the lip
      const stream=[];for(let k=0;k<=10;k++){const f=k/10,d=-250*(1-f)-14,sNow=s*(.25+.75*f)+Math.sin(f*5+index*2)*9,[x,z]=stepPoint(sNow,d);stream.push([x,height(x,z)+3.2,z,4+f*9]);}
      ribbon(stream,1,tangent);ribbon(fall,0,tangent);ribbon(fall.map(([x,y,z,w])=>[x,2*LAKE-y,z,w]),0,tangent);
      // run-out across the talus to the water, always heading down to the shoreline
      const run=[];const[bx,,bz]=last;let x=bx,z=bz;for(let k=0;k<=9;k++){const y=height(x,z);run.push([x,Math.max(y,LAKE)+2,z,16-k*.6]);if(y<LAKE)break;const toward=Math.hypot(x,z+180)||1;x-=x/toward*14;z-=(z+180)/toward*14;}
      if(run.length>1)ribbon(run,1,tangent);
      spray(bx,Math.max(height(bx,bz),LAKE)+1,bz,index===0?30:24);
    });
    const fallGeometry=new T.BufferGeometry();fallGeometry.setAttribute('position',new T.Float32BufferAttribute(fp,3));fallGeometry.setAttribute('aFlow',new T.Float32BufferAttribute(fq,3));fallGeometry.setIndex(fi);
    const fallMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,uniforms:{time:shared.time,tile:shared.tile,haze:shared.haze,hazeK:shared.hazeK,eye:shared.eye},
      vertexShader:'attribute vec3 aFlow;uniform vec3 eye;uniform float hazeK;varying vec3 vFlow;varying float vHaze;varying float vSeen;void main(){vFlow=aFlow;vSeen=position.y<0.?.6:1.;vHaze=1.-exp(-length(position-eye)*hazeK);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 vFlow;varying float vHaze;varying float vSeen;uniform float time;uniform vec3 haze;uniform sampler2D tile;
void main(){
  float u=vFlow.x,v=vFlow.y;vec3 col;float a;
  if(vFlow.z<1.5){
    float fallKind=1.-step(.5,vFlow.z);
    float s=texture2D(tile,vec2(u*.42+.13,v*.0048-time*mix(.05,.13,fallKind))).r,w=texture2D(tile,vec2(u*1.05+.4,v*.014-time*mix(.09,.27,fallKind))).g;
    float streak=s*.62+w*.62;
    float edge=smoothstep(0.,.13+w*.2,u)*smoothstep(1.,.87-s*.2,u);
    a=edge*smoothstep(.3,.68,streak+.1*fallKind)*mix(.72,1.,fallKind);
    col=mix(vec3(.62,.72,.76),vec3(1.5,1.54,1.56),smoothstep(.34,.82,streak));
  }else{
    vec2 c=vec2(u*2.-1.,v*2.-1.);
    a=(1.-smoothstep(.05,1.,dot(c,c)))*.5*(.55+.8*texture2D(tile,vec2(u*.5,v*.5-time*.04)).r);
    col=vec3(1.3,1.33,1.36);
  }
  gl_FragColor=vec4(mix(col,haze,vHaze*.75),a*vSeen);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    const falls=new T.Mesh(fallGeometry,fallMaterial);falls.name='Alpine / twin east-shore falls';falls.renderOrder=3;root.add(falls);
  }

  // ---- shore stones
  const boulderMaterial=new T.MeshStandardMaterial({color:'#ffffff',roughness:.95,flatShading:true});
  const boulders=new T.InstancedMesh(new T.DodecahedronGeometry(1,quest?0:1),boulderMaterial,quest?70:150);boulders.name='Alpine / shore granite';
  for(let i=0;i<boulders.count;i++){
    let a,z,x,near,tries=0;
    do{a=rnd()*Math.PI*2;z=-180+Math.sin(a)*(486+rnd()*22);x=Math.cos(a)*(lakeWidth(z)*1.03+rnd()*18);near=Math.hypot(x-24,z-365)<220;tries++;}while(tries<30&&(groundAt(x,z)>7||(near&&rnd()<.6)));
    const s=(near?.7+rnd()*1.5:1.5+rnd()*4)*(rnd()<.1?1.5:1);
    matrix.compose(v.set(x,Math.max(groundAt(x,z),LAKE)+s*.18,z),q.setFromAxisAngle(up,rnd()*6.28),scale.set(s,s*.62,s*.82));boulders.setMatrixAt(i,matrix);
    boulders.setColorAt(i,treeColor.setHSL(.09+rnd()*.05,.05+rnd()*.05,.13+rnd()*.11));
  }
  root.add(boulders);

  // Small Crownfall shore buildings belong to the scene, not an imported castle.
  const landmarks=anchors.map(([id,x,z])=>({id,position:[x,height(x,z)+3,z]}));
  const wallColor=ctx.nationId==='solforiz'?'#c5aa78':ctx.nationId==='kwind-09'?'#566d77':'#858b82';
  for(const {id,position:[x,y,z]}of landmarks){
    const group=new T.Group();group.name=`Alpine / ${id}`;group.position.set(x,y-3,z);
    const wall=new T.Mesh(new T.BoxGeometry(13,8,10),new T.MeshStandardMaterial({color:wallColor,roughness:.85}));wall.position.y=4;group.add(wall);
    const roof=new T.Mesh(new T.ConeGeometry(10,5,4),new T.MeshStandardMaterial({color:ctx.nationId==='aethelgard'?'#3a4936':'#3e4145',roughness:.9}));roof.rotation.y=Math.PI/4;roof.scale.z=.8;roof.position.y=10;group.add(roof);root.add(group);
  }

  const sky=new T.Mesh(new T.SphereGeometry(7000,quest?20:32,quest?12:18),new T.ShaderMaterial({uniforms:{tile:shared.tile,time:shared.time},side:T.BackSide,depthWrite:false,
    vertexShader:'varying vec3 dir;void main(){dir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 dir;uniform sampler2D tile;uniform float time;
void main(){
  vec3 d=normalize(dir);vec3 col=mix(vec3(.74,.83,.90),vec3(.20,.42,.72),pow(smoothstep(-.03,.8,d.y),.62));
  vec2 p=d.xz/max(.14,d.y+.08);
  float clouds=texture2D(tile,p*.062+vec2(time*.0006,0.)).r+.55*texture2D(tile,p*.19).g;
  col=mix(col,vec3(.97,.97,.95),smoothstep(.86,1.16,clouds)*smoothstep(.015,.17,d.y)*.92);
  gl_FragColor=vec4(col,1.);
}`}));sky.name='Alpine / atmosphere and cumulus';sky.renderOrder=1e6;root.add(sky);
  ctx.scene.add(root);
  ctx.onProgress?.('Validating lakeshore walking areas');
  const clearAt=createSourceClearance(T,root,landmarks,MeshBVH);
  const exploration=createTerrainHubs({groundAt,dryAt:(x,z)=>lakeRadius(x,z)>1.055&&groundAt(x,z)>LAKE+.3,clearAt,cameraColliders:clearAt.colliders,landmarks});
  return {sourceWorld:false,root,exploration,view:{position:[24,18,365],target:[0,105,-620],fov:48},landmarks,extent:{center:[0,110,-300],width:1800,depth:2150,height:720},lighting:{sunDirection,sunColor:'#fff1d6',skyColor:'#b4c8d5',groundColor:'#354332',exposure:1.12},update(time){shared.time.value=time;},setSourceTransform(_matrix,eye){shared.eye.value.copy(eye);shared.hazeK.value=.00003+.00012*(1-smooth(160,700,eye.y));},dispose(){tile.dispose();}};
}
