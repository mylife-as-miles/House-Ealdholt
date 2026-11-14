import type { VillageResidentAvailability } from '../../../../../shared/legacy/aethelgard/characters/village-resident-availability';

/** A snapshot of the completed normal Desktop canvas pass. This consumes the
 * adapter's actual skinned-body observation; it never grants presentation. */
export function describeResidentFollowTrace(residentId: string | null,
  availability: VillageResidentAvailability | null, rendererFrame: number, canvasFrame: number) {
  const current = residentId && availability?.residentId === residentId ? availability : null;
  const frame = Number.isSafeInteger(rendererFrame) && rendererFrame >= 0 ? rendererFrame : null;
  const submitted = frame !== null && current?.body === 'qualified' && current.bodyReady
    && current.renderFrame === frame && current.drawnFrame === frame;
  return Object.freeze({ version: 'selected-resident-submission-v1' as const,
    residentId, body: current?.body ?? (residentId ? 'pending' : null), reason: current?.reason ?? null,
    sourcePosition: current?.position ?? null, bodyReady: current?.bodyReady ?? false,
    rendererFrame: frame, canvasFrame, availabilityFrame: current?.renderFrame ?? null,
    submittedResidentId: submitted ? residentId : null, submittedFrame: submitted ? frame : null,
    submissionCamera: submitted ? 'main' as const : null });
}
