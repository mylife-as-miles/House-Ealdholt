import * as THREE from 'three';
import { planContactParticles, type ContactFxInput } from '../../../../shared/play/contact-vfx';

/** Fixed-residency WebGL2 path: attributes are uploaded only at emission;
 * closed-form motion and fading run in the shader, never a JS particle loop. */
export class ContactEffects {
  readonly object: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly arrays: Record<string, Float32Array>;
  private readonly seen = new Set<string>();
  private readonly events: string[] = [];
  private cursor = 0;
  private used = 0;
  private time = 0;
  private expires = 0;
  private disposed = false;

  constructor(readonly capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 16 || capacity > 2048) throw new Error('Contact effect capacity must be 16–2048.');
    this.arrays = { position: new Float32Array(capacity * 3), aVelocity: new Float32Array(capacity * 3), aColour: new Float32Array(capacity * 3),
      aBirth: new Float32Array(capacity).fill(-1), aLife: new Float32Array(capacity), aSize: new Float32Array(capacity),
      aGravity: new Float32Array(capacity), aDrag: new Float32Array(capacity), aGround: new Float32Array(capacity), aKind: new Float32Array(capacity) };
    for (const [name, array] of Object.entries(this.arrays)) this.geometry.setAttribute(name,
      new THREE.BufferAttribute(array, ['position', 'aVelocity', 'aColour'].includes(name) ? 3 : 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: true,
      uniforms: { time: { value: 0 }, projectionScale: { value: 300 } },
      vertexShader: `attribute vec3 aVelocity; attribute vec3 aColour; attribute float aBirth; attribute float aLife;
        attribute float aSize; attribute float aGravity; attribute float aDrag; attribute float aGround; attribute float aKind;
        uniform float time; uniform float projectionScale; varying vec3 colour; varying float opacity; varying float kind;
        void main(){ float age=time-aBirth; colour=aColour; kind=aKind; opacity=0.;
          if(aBirth<0. || age<0. || age>=aLife){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;return;}
          float travel=aDrag>0.? (1.-exp(-aDrag*age))/aDrag:age;
          vec3 p=position+aVelocity*travel; p.y=max(aGround,p.y-.5*aGravity*age*age);
          vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
          gl_PointSize=clamp(aSize*projectionScale/max(.05,-view.z)*(kind==2.?1.+age/aLife:1.),1.,32.);
          opacity=pow(1.-age/aLife,1.5); }`,
      fragmentShader: `varying vec3 colour;varying float opacity;varying float kind;
        void main(){if(opacity<=0.)discard;vec2 p=gl_PointCoord*2.-1.;float mask=1.-smoothstep(.55,1.,length(p));
          if(kind==1.)mask=step(abs(p.x),.45)*step(abs(p.y),.95);
          gl_FragColor=vec4(colour,opacity*mask);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.object = new THREE.Points(this.geometry, this.material); this.object.name = 'CrownfallMaterialContactEffects'; this.object.frustumCulled = false; this.object.visible = false;
  }

  emit(input: ContactFxInput): number {
    if (this.disposed || this.seen.has(input.id)) return 0;
    const particles = planContactParticles(input);
    this.seen.add(input.id); this.events.push(input.id);
    if (this.events.length > 256) this.seen.delete(this.events.shift()!);
    for (const particle of particles) {
      const i = this.cursor, j = i * 3;
      this.arrays.position.set([particle.origin.x, particle.origin.y, particle.origin.z], j);
      this.arrays.aVelocity.set([particle.velocity.x, particle.velocity.y, particle.velocity.z], j);
      this.arrays.aColour.set(particle.colour, j);
      this.arrays.aBirth[i] = this.time; this.arrays.aLife[i] = particle.seconds; this.arrays.aSize[i] = particle.size;
      this.arrays.aGravity[i] = particle.gravity; this.arrays.aDrag[i] = particle.drag;
      this.arrays.aGround[i] = particle.groundY; this.arrays.aKind[i] = particle.kind;
      this.expires = Math.max(this.expires, this.time + particle.seconds);
      this.cursor = (this.cursor + 1) % this.capacity; this.used = Math.min(this.capacity, this.used + 1);
    }
    if (particles.length) {
      this.object.visible = true;
      for (const attribute of Object.values(this.geometry.attributes)) (attribute as THREE.BufferAttribute).needsUpdate = true;
      this.geometry.setDrawRange(0, this.used);
    }
    return particles.length;
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    this.time += delta; this.material.uniforms.time.value = this.time;
    this.object.visible = this.time < this.expires;
  }
  setProjectionScale(pixels: number): void { if (Number.isFinite(pixels) && pixels > 0) this.material.uniforms.projectionScale.value = pixels; }
  clear(): void {
    if (this.disposed) return;
    this.time = this.expires = this.cursor = this.used = 0; this.material.uniforms.time.value = 0; this.object.visible = false;
    this.arrays.aBirth.fill(-1); (this.geometry.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, 0); this.seen.clear(); this.events.length = 0;
  }
  dispose(): void { if (this.disposed) return; this.clear(); this.disposed = true; this.object.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
