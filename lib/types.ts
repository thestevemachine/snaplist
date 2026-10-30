import type { AspectMeta } from "./ebay/taxonomy";
import type { AiUsage } from "./ai-usage";
import type { ShippingSelection } from "./validation";
// Shape of a generated listing. Mirrors the JSON the model returns in the
// Python script's analyze_photos(), plus the routed profile.

export interface ListingResult {
  eyewear_kind?: "optical" | "sunglasses" | "uncertain" | "not_eyewear";
  classification_note?: string;
  content_rules_version?: number;
  title_manually_edited?: boolean;
  eyewear?: import("./eyewear-inscriptions").EyewearData;
  glasses_rules_version?: number;
  category_fields_version?: number;
  feature_defaults_version?: number;
  style_tags_version?: number;
  title: string;
  category?: string;
  category_hint?: string;
  category_id?: string;
  secondary_category_id?: string;
  ebay_condition?: string;
  evidence?: Record<string, number[]>;
  // Confidence (60–100) for specifics the AI estimated rather than read off a label.
  estimates?: Record<string, number>;
  brand?: string;
  item_type?: string;
  color?: string[] | string;
  size?: string;
  material?: string;
  condition?: string;
  condition_notes?: string;
  measurements?: string;
  manual_measurement_values?: Record<string,string>;
  manual_measurement_fields?: string[];
  frontMeasurement?: import("./front-measurements").FrontMeasurement;
  description: string;
  best_offer_enabled?: boolean;
  suggested_price?: number | string;
  search_terms?: string[];
  seo_keywords?: string[];
  key_features?: string[];
  item_specifics?: Record<string, string>;
  item_profile?: string;
}

export interface AnalyzeRequestBody {
  hint?: string;
  // Browser-resized JPEG data URLs or raw base64 strings.
  images: { mediaType: string; data: string }[];
  profile: string;
  // Optional model overrides; server falls back to its defaults when omitted.
  analysisModel?: string;
  routerModel?: string;
}

export interface AnalyzeResponse {
  usage?: AiUsage[];
  ok: boolean;
  listing?: ListingResult;
  error?: string;
}

export interface SortResponse {
  usage?: AiUsage[];
  ok: boolean;
  groups?: { name: string; photoIndices: number[] }[];
  orphanIndices?: number[];
  error?: string;
}

// ── Client-side working model for the bulk flow ──────────────────────────────

export interface Photo {
  separator?: boolean;
  separatorManual?: boolean;
  id: string;
  previewUrl: string;
  mediaType: string;
  original?: Blob;
  uploadData?: string;
  analysisSelected?: boolean;
  data: string; // base64, no prefix
}

export type ItemStatus = "idle" | "writing" | "done" | "error";

export type PostStatus = "idle" | "posting" | "posted" | "error";

// Market price check from active eBay comps (see lib/ebay/comps.ts). Advisory:
// shown beside the AI's estimate so the seller prices with real data in view.
export interface CompsSummary {
  recommendedPrice?: number;
  recommendationBasis?: string;
  ok: boolean;
  sources?: {
    id: string;
    title: string;
    url: string;
    price: number;
    shipping?: number;
    total?: number;
    condition: string;
  }[];
  checkedAt?: string;
  matchBasis?: string;
  query: string;
  count: number;
  median?: number;
  trimmedMean?: number;
  low?: number;
  high?: number;
  confidence: number;
  basis: string;
  // Median with the deployment's PRICE_MARKUP_PERCENT applied — what the
  // "use median" button should set. Absent when no markup is configured.
  listPrice?: number;
}

export interface ItemGroup {
  analysisModel?: string;
  comparisons?: {
    id: string;
    model: string;
    createdAt: number;
    photoIds: string[];
    listing?: ListingResult;
    usage: AiUsage[];
    error?: string;
  }[];
  shopBaseDescription?: string;
  cloudBatchId?: string;
  id: string;
  sku: string; // Exact seller value, e.g. "65-23537"; blank until listing review.
  name: string;
  photoIds: string[];
  listing?: ListingResult;
  status: ItemStatus;
  error?: string;
  analysisPhotoIds?: string[];
  preparation?: PreparedCategory;
  preparationError?: string;
  usage?: AiUsage[];
  compsStatus?: "loading" | "unavailable" | "ready" | "stale";
  shipping?: Partial<ShippingSelection>;
  imageUrls?: string[];
  uploadedPhotoIds?: string[];
  photoUploadUrls?: Record<string,string>;
  publicationAttemptSku?: string;
  publicationId?: string;
  publicationConflict?: { listingId: string; sku: string; title: string };
  publicationRepair?: {
    previousId: string;
    previousSku: string;
    conflictItemId: string;
    repairedAt: number;
  };
  evidencePhotoIds?: string[];
  // Market price check (fetched right after the listing is written)
  comps?: CompsSummary;
  // eBay posting state (Phase 2)
  postStatus?: PostStatus;
  listingId?: string;
  postError?: string;
  // Non-fatal quality warnings from the last publish (e.g. schema unavailable)
  postWarnings?: string[];
  verificationMessage?: string;
}

export interface PreparedCategory {
  secondaryCategoryId?: string;
  secondaryCategoryName?: string;
  suggestions?: import("./ebay/taxonomy").CategorySuggestion[];
  categoryId: string;
  categoryName: string;
  aspects: AspectMeta[];
  conditions: { value: string; label: string }[];
  expiresAt: number;
  signature: string;
  issues: string[];
}
