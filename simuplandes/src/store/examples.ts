/**
 * `buildExampleFourBar`: a Grashof crank-rocker (s=40, l~100.78, p=100,
 * q~80.62) built ONLY through store actions. Reused by 02-03's UI and later
 * phases as the default example.
 */

import { poseFromWorldPoints, worldToLinkLocal, type Id } from "../model";
import { vec2 } from "../geom";
import type { MechanismStore } from "./mechanismStore";

export interface ExampleFourBarIds {
  groundId: Id;
  crankId: Id;
  couplerId: Id;
  rockerId: Id;
  motorId: Id;
  markerId: Id;
}

/** Builds a four-bar crank-rocker in `store`, entirely through its command actions. */
export function buildExampleFourBar(store: MechanismStore): ExampleFourBarIds {
  const state = store.getState();

  // World joint positions (mm).
  const O2 = vec2(0, 0);
  const O4 = vec2(100, 0);
  const A = vec2(20, 20 * Math.sqrt(3)); // crank length 40 at 60 degrees
  const B = vec2(110, 80);

  const ground = state.addLink({
    name: "ground",
    isGround: true,
    sites: [{ local: [O2.x, O2.y] }, { local: [O4.x, O4.y] }],
  });
  const [siteO2Ground, siteO4Ground] = ground.siteIds;

  const crankPose = poseFromWorldPoints(O2, A);
  const crank = state.addLink({
    name: "crank",
    pose: crankPose,
    sites: [{ local: [0, 0] }, { local: worldToLinkLocal(crankPose, A) }],
  });
  const [siteO2Crank, siteACrank] = crank.siteIds;

  const abLength = Math.hypot(B.x - A.x, B.y - A.y);
  const couplerPose = poseFromWorldPoints(A, B);
  const coupler = state.addLink({
    name: "coupler",
    pose: couplerPose,
    shape: {
      kind: "plate",
      outline: [
        [0, 0],
        [abLength, 0],
        [abLength / 2, 30],
      ],
    },
    sites: [{ local: [0, 0] }, { local: worldToLinkLocal(couplerPose, B) }],
  });
  const [siteACoupler, siteBCoupler] = coupler.siteIds;

  const rockerPose = poseFromWorldPoints(O4, B);
  const rocker = state.addLink({
    name: "rocker",
    pose: rockerPose,
    sites: [{ local: [0, 0] }, { local: worldToLinkLocal(rockerPose, B) }],
  });
  const [siteO4Rocker, siteBRocker] = rocker.siteIds;

  const jointO2 = state.addJoint({
    type: "R",
    siteA: siteO2Ground,
    siteB: siteO2Crank,
    name: "O2",
  });
  state.addJoint({ type: "R", siteA: siteACrank, siteB: siteACoupler, name: "A" });
  state.addJoint({ type: "R", siteA: siteBCoupler, siteB: siteBRocker, name: "B" });
  state.addJoint({ type: "R", siteA: siteO4Rocker, siteB: siteO4Ground, name: "O4" });

  const motorId = state.addMotor({ jointId: jointO2, drive: { mode: "constant", speed: 1 } });

  const markerId = state.addMarker({
    linkId: coupler.linkId,
    local: [abLength / 2, 30],
  });

  return {
    groundId: ground.linkId,
    crankId: crank.linkId,
    couplerId: coupler.linkId,
    rockerId: rocker.linkId,
    motorId,
    markerId,
  };
}
