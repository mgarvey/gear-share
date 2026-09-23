import type { BulkDraftStageResult } from "@/lib/gearShareApi";

type ProcessingPatch = {
  result: BulkDraftStageResult;
  mediaReady?: boolean;
  include?: boolean;
  rowError?: string;
};

export async function processStagedBulkRows(input: {
  results: BulkDraftStageResult[];
  rows: Array<{ photos: File[] }>;
  indices: number[];
  paused: () => boolean;
  upload: (result: BulkDraftStageResult, photos: File[]) => Promise<unknown>;
  update: (index: number, patch: ProcessingPatch) => void;
  progress: (message: string) => void;
}) {
  for (let resultIndex = 0; resultIndex < input.results.length; resultIndex += 1) {
    const result = input.results[resultIndex]; const candidate = input.rows[resultIndex]; const candidateIndex = input.indices[resultIndex];
    if (result.status !== "staged" || !result.supplyId || !result.communityId) continue;
    if (input.paused()) { input.update(candidateIndex, { result, rowError: "Saving stopped before this item. You can come back and finish it later." }); continue; }
    input.progress(`Saving photos for item ${resultIndex + 1} of ${input.results.length}…`);
    try { await input.upload(result, candidate.photos); input.update(candidateIndex, { result, mediaReady: true, include: false, rowError: undefined }); }
    catch { input.update(candidateIndex, { result, mediaReady: false, rowError: "The photos for this item could not be saved. Check the saved draft, then try this item again." }); }
  }
}
