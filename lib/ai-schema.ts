import { PHOTO_FACT_SCHEMA } from "./photo-facts";
const string = { type: "string" };
const strings = { type: "array", items: string };
const point = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Claude does not support numeric bounds in raw output schemas.
    // Enforce 0..1 with frontObservationSchema after the response.
    x: { type: "number", description: "Image-width fraction from 0 to 1." },
    y: { type: "number", description: "Image-height fraction from 0 to 1." },
  },
  required: ["x", "y"],
};
const contour = {
  type: "object",
  additionalProperties: false,
  properties: { left: point, right: point, top: point, bottom: point },
  required: ["left", "right", "top", "bottom"],
};
const frontGeometry = {
  type: "object",
  additionalProperties: false,
  properties: {
    photoIndex: { type: "integer" },
    leftLens: contour,
    rightLens: contour,
    outerLeft: point,
    outerRight: point,
    frontal: { type: "boolean" },
    groovesVisible: { type: "boolean" },
    complete: { type: "boolean" },
    samePlane: { type: "boolean" },
    confidence: { type: "number" },
    note: string,
  },
  required: [
    "photoIndex",
    "leftLens",
    "rightLens",
    "outerLeft",
    "outerRight",
    "frontal",
    "groovesVisible",
    "complete",
    "samePlane",
    "confidence",
    "note",
  ],
};
export const AI_LISTING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    front_geometry: frontGeometry,
    eyewear_kind: {
      type: "string",
      enum: ["optical", "sunglasses", "uncertain", "not_eyewear"],
    },
    classification_note: string,
    title: string,
    description: string,
    category: string,
    category_hint: string,
    brand: string,
    item_type: string,
    color: strings,
    size: string,
    material: string,
    condition: {
      type: "string",
      enum: [
        "EXCELLENT",
        "VERY_GOOD",
        "GOOD",
        "FAIR",
        "FOR_PARTS_OR_NOT_WORKING",
      ],
    },
    condition_notes: string,
    measurements: { type: "string", enum: [""] },
    suggested_price: { type: "number" },
    search_terms: strings,
    seo_keywords: strings,
    key_features: strings,
    specifics: {
      type: "array",
      items: PHOTO_FACT_SCHEMA,
    },
  },
  required: [
    "front_geometry",
    "eyewear_kind",
    "classification_note",
    "title",
    "description",
    "category",
    "category_hint",
    "brand",
    "item_type",
    "color",
    "size",
    "material",
    "condition",
    "condition_notes",
    "measurements",
    "suggested_price",
    "search_terms",
    "seo_keywords",
    "key_features",
    "specifics",
  ],
};
