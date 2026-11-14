import * as THREE from "three";
import type { GamePortSetting } from "../../../shared/play/match";

/** Lightweight replacements for the sky and lava deliberately omitted by the export. */
export function buildBakedAtmosphere(setting: GamePortSetting): THREE.Group {
  const group = new THREE.Group();
  group.name = "gameport-atmosphere";
  const violet = setting === "scene-02";
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(violet ? 0xbc2844 : 0xff4b08) } },
    vertexShader: "varying vec2 p; void main(){p=uv*140.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `varying vec2 p; uniform vec3 glow;
      void main(){
        float cracks=pow(1.0-abs(sin(p.x+sin(p.y*1.9)*1.6)*sin(p.y*.8+sin(p.x*1.3))),18.0);
        gl_FragColor=vec4(mix(vec3(.025,.006,.004),glow*2.5,cracks),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  lava.name = "gameport-lava";
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = -9;
  group.add(lava);
  const eclipse = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(violet ? 0xaa69ff : 0xff9e35) } },
    transparent: true, depthWrite: false,
    vertexShader: "varying vec2 p; void main(){p=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `varying vec2 p; uniform vec3 glow;
      void main(){float r=length(p); float ring=exp(-abs(r-.47)*65.0); float halo=exp(-abs(r-.48)*9.0)*.18;
        float disc=1.0-smoothstep(.45,.47,r);
        gl_FragColor=vec4(glow*(ring*3.0+halo),max(disc,ring+halo));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  eclipse.name = "gameport-eclipse";
  eclipse.position.set(0, 85, -230);
  group.add(eclipse);
  return group;
}
