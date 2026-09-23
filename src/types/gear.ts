export type MembershipStatus = "pending" | "active" | "rejected" | "deactivated";
export type OwnershipKind = "individual" | "group";
export type ListingStatus = "listed" | "unlisted" | "retired";
export type LoanStatus = "pending" | "approved" | "checked_out" | "returned" | "declined" | "cancelled";
export type AccessLevel = "regular" | "custodian" | "administrator";
export type GearCategory = "tents-shelters" | "sleep-systems" | "packs-storage" | "camp-kitchen" | "water-hydration" | "tools-repair" | "safety-first-aid" | "program-activity" | "uniforms-apparel" | "books-guides" | "other-gear";
export type GearCondition = "excellent" | "good" | "fair" | "needs_repair";

export interface Membership {
  id: string;
  communityId: string;
  displayName: string;
  status: MembershipStatus;
  accessLevel: AccessLevel;
}

export interface GearItem {
  id: string;
  communityId: string;
  title: string;
  description: string;
  category: GearCategory | null;
  condition: GearCondition | null;
  ownershipKind: OwnershipKind;
  ownerId: string | null;
  ownerIsActive: boolean;
  custodianId: string;
  custodianName: string;
  custodianPostalCode: string | null;
  quantityTotal: number;
  availableQuantity?: number | null;
  listingStatus: ListingStatus;
  imagePaths: string[];
  publicationAttemptId?: string | null;
  publicationExpectedImages?: number;
  needsAttention?: boolean;
  needsAttentionReason?: string | null;
  needsAttentionVersion?: number;
  guidelineVersion?: number;
  borrowingGuidelines?: string[];
}

export interface Loan {
  id: string;
  supplyId: string;
  supplyTitle: string;
  ownershipKind: OwnershipKind;
  ownerId: string | null;
  ownerIsActive: boolean;
  currentCustodianId: string;
  currentCustodianName: string;
  borrowerId: string;
  borrowerName: string;
  custodianAtRequestId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  status: LoanStatus;
  borrowerNote: string | null;
  handoffContactId?: string | null;
  handoffContactName?: string | null;
  needsAttention?: boolean;
  needsAttentionReason?: string | null;
  guidelineVersion?: number | null;
  acceptedGuidelines?: string[];
  guidelinesAcceptedAt?: string | null;
}

export type WantedRequestStatus = "open" | "fulfilled" | "closed" | "moderated";
export type WantedRequestView = WantedRequestStatus | "mine";
export type WantedOfferStatus = "active" | "selected" | "invalidated";

export interface WantedRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  title: string;
  category: GearCategory | null;
  desiredQuantity: number;
  desiredStart: string | null;
  desiredEnd: string | null;
  note: string | null;
  status: WantedRequestStatus;
  closureKind: "voluntary" | "moderation_restore" | null;
  selectedOfferId: string | null;
  transitionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WantedOffer {
  id: string;
  requestId: string;
  supplyId: string | null;
  supplyTitle: string;
  offererId: string;
  offererName: string;
  note: string | null;
  status: WantedOfferStatus;
  transitionVersion: number;
  createdAt: string;
  offerKind: "listing" | "one_off";
  offeredQuantity: number | null;
}

export interface ManageableWantedListing {
  id: string;
  title: string;
  ownershipKind: OwnershipKind;
}

export interface JoinQuestion {
  id: string;
  prompt: string;
  required: boolean;
}

export interface JoinQuestionSet {
  communityName: string;
  versionId: string;
  questions: JoinQuestion[];
}

export interface PendingMember {
  id: string;
  display_name: string;
  confirmed_email: string;
  submitted_at: string;
  answer_snapshot: Array<JoinQuestion & { answer: string }>;
}

export interface MemberAdministrationRecord {
  id: string;
  display_name: string;
  account_email: string | null;
  membership_status: "active" | "rejected" | "deactivated";
  accessLevel: AccessLevel;
}

export interface CommunitySettings {
  communityId: string;
  displayName: string;
  configurationVersion: number;
  aiDraftingEnabled: boolean;
}

export interface AiDraftingSettingResult {
  configurationVersion: number;
  aiDraftingEnabled: boolean;
  alreadyReservedRequests: number;
  statusReason: string;
}

export interface ReactivationImpact {
  targetId: string;
  displayName: string;
  membershipStatus: "deactivated";
  priorAccessLevel: AccessLevel;
  cancelledLoans: number;
  individualOwnedListings: number;
  storedWithListings: number;
  notificationConsequence: string;
  previewVersion: string;
}

export interface AdministratorOrientationItem {
  registryVersion: number;
  itemId: string;
  label: string;
  helpText: string | null;
  routeId: "administration_members" | "administration_settings" | "inventory" | "loans" | "notifications" | "privacy";
  displayOrder: number;
  required: boolean;
  applicableRole: "administrator";
  status: "completed" | "dismissed" | null;
  changedAt: string | null;
}

export interface MemberProfileSettings {
  displayName: string;
  introduction: string;
  phoneE164: string;
  coordinationNote: string;
  confirmedEmail: string;
}

export interface LoanContactDetails {
  displayName: string;
  email: string;
  phoneE164: string;
  coordinationNote: string;
}

export interface HandoffCandidate {
  id: string;
  displayName: string;
}

export interface LoanReminder {
  id: string;
  loanId: string;
  supplyTitle: string;
  kind: "due_soon" | "first_overdue" | "weekly_overdue";
  ordinal: number;
  endDate: string;
  dueAt: string;
  occurredAt: string;
}

export type NotificationEventType =
  | "membership_application_pending"
  | "membership_approved"
  | "membership_rejected"
  | "membership_reapplication_allowed"
  | "role_promoted"
  | "role_promoted_admin"
  | "role_demoted"
  | "role_demoted_admin"
  | "membership_deactivated"
  | "membership_deactivated_admin"
  | "membership_reactivated"
  | "membership_reactivated_admin"
  | "loan_requested"
  | "loan_approved"
  | "loan_declined"
  | "loan_checked_out"
  | "loan_cancelled"
  | "loan_returned"
  | "loan_due_soon"
  | "loan_first_overdue"
  | "loan_weekly_overdue"
  | "wanted_request_created"
  | "wanted_offer_created"
  | "wanted_offer_selected"
  | "wanted_offer_invalidated"
  | "wanted_request_moderated"
  | "wanted_request_restored"
  | "email_delivery_suppressed";

export interface PrivateNotification {
  id: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  appRoute: string;
  occurredAt: string;
  readAt: string | null;
}

export interface TransactionalEmailPreferences {
  loanActivity: boolean;
  loanReminders: boolean;
  wantedActivity: boolean;
}

export interface NotificationDeliveryDiagnostic {
  outboxId: string;
  recipientUserId: string;
  recipientDisplayName: string;
  eventType: NotificationEventType;
  status: string;
  attemptCount: number;
  suppressionReason: "administrator" | "immediate_permanent" | "permanent_bounce" | "complaint" | null;
  createdAt: string;
  updatedAt: string;
}
