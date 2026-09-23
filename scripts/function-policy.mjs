export const FINAL_FUNCTIONS = [
  "sanitize-gear-image",
  "draft-gear-listing",
  "deliver-transactional-notifications",
  "receive-ses-feedback",
  "invite-preapproved-member",
  "delete-deactivated-member",
];

// Expand only when the corresponding reviewed implementation milestone lands.
export const IMPLEMENTED_FUNCTIONS = [
  "sanitize-gear-image",
  "draft-gear-listing",
  "deliver-transactional-notifications",
  "receive-ses-feedback",
  "invite-preapproved-member",
  "delete-deactivated-member",
];

export const CLIENT_INVOKABLE_FUNCTIONS = ["sanitize-gear-image", "draft-gear-listing", "invite-preapproved-member", "delete-deactivated-member"];

export const CORE_HOSTED_FUNCTIONS = ["sanitize-gear-image", "invite-preapproved-member", "delete-deactivated-member"];
export const SES_FUNCTION_PAIR = ["deliver-transactional-notifications", "receive-ses-feedback"];

export const REVIEWED_HOSTED_INVENTORIES = [
  [],
  CORE_HOSTED_FUNCTIONS,
  [...CORE_HOSTED_FUNCTIONS, "draft-gear-listing"],
  [...CORE_HOSTED_FUNCTIONS, ...SES_FUNCTION_PAIR],
  FINAL_FUNCTIONS,
];

export function validateHostedFunctionInventory(names) {
  const inventory = [...new Set(names)].sort();
  const sesCount = SES_FUNCTION_PAIR.filter((name) => inventory.includes(name)).length;
  if (sesCount === 1) throw new Error("hosted function inventory contains a partial SES pair");
  const reviewed = REVIEWED_HOSTED_INVENTORIES.some((allowed) => JSON.stringify([...allowed].sort()) === JSON.stringify(inventory));
  if (!reviewed) throw new Error(`hosted function inventory is unknown: ${inventory.join(", ")}`);
}

export const DENIED_ROOT_FUNCTIONS = [
  "batch-generate-illustrations",
  "bulk-create-users",
  "create-community",
  "cross-community-search",
  "draft-item-from-image",
  "generate-illustration",
  "get-app-icon",
  "migrate-base64-to-storage",
  "scan-bookshelf",
  "search-public-catalog",
  "send-bulk-supply-notification",
  "send-bulk-update",
  "send-community-request-notification",
  "send-contact-message",
  "send-join-notification",
  "send-request-fulfilled",
  "send-steward-welcome",
  "send-supply-notification",
  "send-welcome-email",
];
