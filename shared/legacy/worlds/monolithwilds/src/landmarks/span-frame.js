// The Vertebral Span's backbone curve: a sagging, slightly twisting deck line across the canyon.
//
// Local coordinates: s = metres along the bridge axis (west -> east, through the site centre),
// off = metres to the side (+ = south-west). The axis is rotated 33 deg from east: the crossing is
// a little skewed to the canyon, so that the low western sun rakes across the broad faces of the
// fins instead of running straight down the spine (where every fin would shade the next).
// The deck line hangs like a catenary between the two rims (found by sampling heightAt) and
// rolls a few degrees about its own axis.

import * as THREE from 'crownfall-world-three';

const Y = new THREE.Vector3(0, 1, 0);

export function createSpineFrame(ctx, site) {
  const { heightAt } = ctx;
  const ang = (33 * Math.PI) / 180;
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  const axis = new THREE.Vector3(ux, 0, uz);
  const side = new THREE.Vector3(-uz, 0, ux); // axis x up

  const toXZ = (s, off = 0) => [site.x + ux * s - uz * off, site.z + uz * s + ux * off];
  const world = (s, off = 0, y = 0) => {
    const [x, z] = toXZ(s, off);
    return new THREE.Vector3(x, y, z);
  };
  const groundAt = (s, off = 0) => {
    const [x, z] = toXZ(s, off);
    return heightAt(x, z);
  };

  // Rim = first station (walking outward from the middle) where the ground across the whole
  // footprint is back up near plateau level.
  function findRim(dir) {
    for (let s = 0; Math.abs(s) < 420; s += dir * 2) {
      const g = Math.min(groundAt(s, -28), groundAt(s, 0), groundAt(s, 28));
      if (g > 142) return s;
    }
    return dir * 180;
  }
  const rimW = findRim(-1);
  const rimE = findRim(1);

  // deck ends sit a little inland of each rim, where the skull / sacrum take over
  const sW = rimW - 22;
  const sE = rimE + 20;
  const yW = Math.max(groundAt(sW, -12), groundAt(sW, 0), groundAt(sW, 12)) + 5.5;
  const yE = Math.max(groundAt(sE, -12), groundAt(sE, 0), groundAt(sE, 12)) + 5.5;
  const sag = 27;
  const len = sE - sW;

  const tOf = (s) => (s - sW) / len;
  function deckY(s) {
    const t = tOf(s);
    const tc = Math.min(1, Math.max(0, t));
    // slightly asymmetric catenary: the heavy lumbar end pulls the low point east of centre
    const q = tc < 0.54 ? tc / 0.54 : (1 - tc) / 0.46;
    const hang = sag * (1 - Math.pow(1 - q, 2.1));
    return yW + (yE - yW) * tc - hang;
  }
  function twistAt(s) {
    const t = Math.min(1, Math.max(0, tOf(s)));
    return 0.15 * Math.sin(Math.PI * t) + 0.055 * Math.sin(2 * Math.PI * t);
  }

  /** Full frame at station s. U/S include the twist. Writes into `out` if given. */
  function frameAt(s, out = {}) {
    const d = 0.5;
    const dy = (deckY(s + d) - deckY(s - d)) / (2 * d);
    const T = (out.T || new THREE.Vector3()).set(ux, dy, uz).normalize();
    const S0 = new THREE.Vector3().crossVectors(T, Y).normalize();
    const U0 = new THREE.Vector3().crossVectors(S0, T).normalize();
    const phi = twistAt(s);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const U = (out.U || new THREE.Vector3()).copy(U0).multiplyScalar(c).addScaledVector(S0, -sn);
    const S = (out.S || new THREE.Vector3()).copy(S0).multiplyScalar(c).addScaledVector(U0, sn);
    const P = (out.P || new THREE.Vector3()).copy(world(s, 0, deckY(s)));
    out.T = T;
    out.U = U;
    out.S = S;
    out.P = P;
    return out;
  }

  /** Matrix whose basis is (T, U, S) at station s, origin at deck point + U*dy. */
  function matrixAt(s, dy = 0, dx = 0) {
    const f = frameAt(s);
    const m = new THREE.Matrix4().makeBasis(f.T, f.U, f.S);
    const p = f.P.clone().addScaledVector(f.U, dy).addScaledVector(f.T, dx);
    m.setPosition(p);
    return m;
  }

  return { axis, side, toXZ, world, groundAt, rimW, rimE, sW, sE, yW, yE, len, tOf, deckY, twistAt, frameAt, matrixAt };
}
