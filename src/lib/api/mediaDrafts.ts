import { supabase } from "@/integrations/supabase/client";
import { convertSelectedImage, readSafePrivateImage } from "@/lib/safeImage";
import type {
  GearCategory,
  GearCondition,
  ListingStatus,
  GearItem,
} from "@/types/gear";
import { db, invokeAuthenticatedFunction, recoveryRpc } from "./client";
import type { GearImageTarget } from "./contracts";
export type { GearImageTarget } from "./contracts";

export async function createOrResumeIndividualDraft(input: {
  attemptId: string;
  title: string;
  description: string;
  category: GearCategory;
  condition: GearCondition;
  quantity: number;
  expectedImages: number;
  borrowingGuidelines?: string[];
}): Promise<GearImageTarget> {
  const { data, error } = await recoveryRpc(
    input.borrowingGuidelines
      ? "create_or_resume_individual_draft_with_guidelines"
      : "create_or_resume_individual_draft",
    {
      supplied_attempt_id: input.attemptId,
      supplied_title: input.title,
      supplied_description: input.description,
      supplied_category: input.category,
      supplied_condition: input.condition,
      supplied_quantity: input.quantity,
      supplied_expected_images: input.expectedImages,
      ...(input.borrowingGuidelines
        ? { supplied_guidelines: input.borrowingGuidelines }
        : {}),
    },
  );
  if (error) throw error;
  if (!data)
    throw new Error("The draft was created without a usable response.");
  return {
    id: data.id,
    communityId: data.community_id,
    imagePaths: data.image_paths ?? [],
    guidelineVersion: Number(data.guideline_version ?? 0),
  };
}

export async function createOrResumeGroupDraft(input: {
  attemptId: string;
  title: string;
  description: string;
  category: GearCategory;
  condition: GearCondition;
  quantity: number;
  custodianId: string;
  expectedImages: number;
  borrowingGuidelines?: string[];
}): Promise<GearImageTarget> {
  const { data, error } = await recoveryRpc(input.borrowingGuidelines
    ? "create_or_resume_group_draft_with_guidelines"
    : "create_or_resume_group_draft", {
    supplied_attempt_id: input.attemptId,
    supplied_title: input.title,
    supplied_description: input.description,
    supplied_category: input.category,
    supplied_condition: input.condition,
    supplied_quantity: input.quantity,
    supplied_custodian_id: input.custodianId,
    supplied_expected_images: input.expectedImages,
    ...(input.borrowingGuidelines
      ? { supplied_guidelines: input.borrowingGuidelines }
      : {}),
  });
  if (error) throw error;
  if (!data)
    throw new Error("The draft was created without a usable response.");
  return {
    id: data.id,
    communityId: data.community_id,
    imagePaths: data.image_paths ?? [],
    guidelineVersion: Number(data.guideline_version ?? 0),
  };
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function digestGearImageFile(file: File) {
  return sha256((await convertSelectedImage(file)).blob);
}

export async function uploadGearImage(
  item: GearImageTarget,
  file: File,
  slot = item.imagePaths.length,
) {
  const converted = await convertSelectedImage(file);
  const digest = await sha256(converted.blob);
  const attemptResult = await recoveryRpc("begin_gear_media_upload", {
    target_supply_id: item.id,
    supplied_slot: slot,
    supplied_source_digest: digest,
  });
  if (attemptResult.error) throw attemptResult.error;
  const attempt = attemptResult.data;
  if (!attempt) throw new Error("The upload attempt was not created.");
  if (attempt.status === "complete") return attempt.final_path as string;
  const upload = await supabase.storage
    .from("gear-image-staging")
    .upload(attempt.staging_path, converted.blob, {
      contentType: "image/jpeg",
      upsert: false,
    });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message))
    throw upload.error;
  const sanitized = await invokeAuthenticatedFunction("sanitize-gear-image", {
    body: { attemptId: attempt.id, sourceDigest: digest },
  });
  if (sanitized.error) throw sanitized.error;
  if (!sanitized.data?.path)
    throw new Error("The sanitizer did not return a committed private photo.");
  return sanitized.data.path as string;
}

export async function uploadGearImagesSequential(
  item: GearImageTarget,
  files: File[],
  startSlot = item.imagePaths.length,
  onProgress?: (completed: number, total: number) => void,
  shouldPause?: () => boolean,
) {
  const paths: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (shouldPause?.())
      throw new Error(
        "Photo publication paused. The Unlisted draft remains recoverable.",
      );
    paths.push(
      await uploadGearImage(
        { ...item, imagePaths: [...item.imagePaths, ...paths] },
        files[index],
        startSlot + index,
      ),
    );
    onProgress?.(index + 1, files.length);
    if (shouldPause?.())
      throw new Error(
        "Photo publication paused. The Unlisted draft remains recoverable.",
      );
  }
  return paths;
}

export type AiGearDraftResult =
  | { kind: "draft"; title: string; description: string; category: GearCategory }
  | { kind: "needs_manual"; reason: "unclear_item" | "multiple_items" | "unsafe_instruction" | "unsupported" };

export async function draftGearListingsWithAi(candidates: File[][], mode: "single" | "bulk"): Promise<AiGearDraftResult[]> {
  const { createAiImageDerivative, bytesToBase64 } = await import("@/lib/aiImage");
  if (candidates.length < 1 || candidates.length > (mode === "single" ? 1 : 10)) throw new Error("Choose a bounded set of photos.");
  if (mode === "bulk" && candidates.some((images) => images.length !== 1)) throw new Error("Bulk AI drafting uses exactly one photo per candidate.");
  if (mode === "single" && (candidates[0].length < 1 || candidates[0].length > 4)) throw new Error("Single-item AI drafting uses one to four photos.");
  const prepared: string[][] = [];
  try {
    for (const candidate of candidates) { const images: string[] = []; for (const file of candidate) images.push(bytesToBase64(await createAiImageDerivative(file))); prepared.push(images); }
  } catch {
    throw new Error("We couldn't prepare the selected photo for suggestions. Choose it again or continue without suggestions.");
  }
  const requestId = crypto.randomUUID();
  const imageCount = candidates.reduce((total, images) => total + images.length, 0);
  const { data, error } = await invokeAuthenticatedFunction("draft-gear-listing", {
    headers: { "x-gear-share-request-id": requestId, "x-gear-share-draft-mode": mode, "x-gear-share-draft-count": String(candidates.length), "x-gear-share-image-count": String(imageCount) },
    body: { detail: "low", candidates: prepared.map((images) => ({ images })) },
  });
  if (error || data?.code !== "ok" || !Array.isArray(data.results)) throw new Error("AI drafting is unavailable. Continue manually.");
  return data.results as AiGearDraftResult[];
}

export async function fetchAiDraftingAvailability() {
  const { data, error } = await recoveryRpc("get_ai_drafting_availability", {});
  if (error) throw error;
  return Boolean(data?.[0]?.available);
}

export async function checkAiActivation(): Promise<void> {
  const { data, error } = await invokeAuthenticatedFunction("draft-gear-listing", {
    headers: {
      "x-gear-share-request-id": crypto.randomUUID(),
      "x-gear-share-draft-mode": "activation",
      "x-gear-share-draft-count": "1",
      "x-gear-share-image-count": "1",
    },
    body: {},
  });
  if (error) throw new Error("The AI connection could not reach the server. Try again.");
  if (data?.code === "ready") return;
  const messages: Record<string, string> = {
    configuration: "The server is missing one of its AI secrets.",
    authorization: "Your Administrator access could not be verified.",
    quota: "OpenAI rejected the request because billing, quota, or rate capacity is unavailable.",
    provider: `OpenAI rejected the connection request${Number.isInteger(data?.providerStatus) ? ` (HTTP ${data.providerStatus}` : ""}${typeof data?.providerCode === "string" ? `, ${data.providerCode}` : ""}${typeof data?.providerParam === "string" ? `, ${data.providerParam}` : ""}${Number.isInteger(data?.providerStatus) ? ")" : ""}.`,
    timeout: "OpenAI did not respond before the connection check timed out.",
    refusal: "OpenAI refused the synthetic connection test.",
    truncated: "OpenAI returned an incomplete connection-test response.",
    schema: "OpenAI returned a response the application could not validate.",
    activation: "The OpenAI test passed, but the application could not save the result.",
  };
  throw new Error(messages[data?.code] ?? "The AI connection check failed.");
}

export type BulkDraftCandidate = {
  attemptId: string; title: string; description: string; category: GearCategory;
  condition: GearCondition; quantity: number; ownershipKind: "individual" | "group";
  custodianId: string | null; expectedImages: number; guidelines: string[];
  sourceDigest: string;
};
export type BulkDraftStageResult = { index: number; attemptId: string; status: "staged" | "failed"; supplyId?: string; communityId?: string; guidelineVersion?: number; mediaAttemptId?: string; error?: string };
export type BulkDraftStatus = { attemptId: string; supplyId: string; communityId: string; listingStatus: ListingStatus; guidelineVersion: number; expectedImages: number; committedImages: number };

export async function stageBulkGearDrafts(candidates: BulkDraftCandidate[]): Promise<BulkDraftStageResult[]> {
  if (candidates.length < 1 || candidates.length > 10) throw new Error("Choose one to ten included candidates.");
  const { data, error } = await recoveryRpc("batch_stage_gear_drafts", { supplied_candidates: candidates });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ index: Number(row.index), attemptId: row.attemptId, status: row.status, supplyId: row.supplyId, communityId: row.communityId, guidelineVersion: Number(row.guidelineVersion ?? 0), mediaAttemptId: row.mediaAttemptId, error: row.error }));
}

export async function fetchBulkDraftStatuses(attemptIds: string[]): Promise<BulkDraftStatus[]> {
  const unique = [...new Set(attemptIds)];
  if (unique.length < 1 || unique.length > 10) throw new Error("Choose one to ten bulk attempts.");
  const { data, error } = await recoveryRpc("private_bulk_draft_attempt_status", { supplied_attempt_ids: unique });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    attemptId: row.attempt_id,
    supplyId: row.supply_id,
    communityId: row.community_id,
    listingStatus: row.listing_status,
    guidelineVersion: Number(row.guideline_version ?? 0),
    expectedImages: Number(row.expected_images),
    committedImages: Number(row.committed_images),
  }));
}

export async function publishSupplyDraft(supplyId: string, attemptId: string) {
  const { error } = await recoveryRpc("publish_supply_draft", {
    target_supply_id: supplyId,
    supplied_attempt_id: attemptId,
  });
  if (error) throw error;
}

export async function removeGearImage(item: GearItem, path: string) {
  const nextPaths = item.imagePaths.filter((candidate) => candidate !== path);
  const { error } = await db.rpc("set_supply_image_paths", {
    target_supply_id: item.id,
    supplied_paths: nextPaths,
  });
  if (error) throw error;
  const removal = await supabase.storage.from("gear-images").remove([path]);
  if (removal.error) throw removal.error;
}

export async function setSupplyImageOrder(supplyId: string, paths: string[]) {
  const { error } = await db.rpc("set_supply_image_paths", {
    target_supply_id: supplyId,
    supplied_paths: paths,
  });
  if (error) throw error;
}

export async function getSignedImageUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("gear-images")
    .createSignedUrl(path, 300);
  if (error) throw error;
  return readSafePrivateImage(
    await fetch(data.signedUrl, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }),
  );
}
