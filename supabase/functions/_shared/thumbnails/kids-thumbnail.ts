// Kids-track thumbnail style hint. Passes the front cover through unchanged
// (see generate-store-thumbnail's "kids_cover_passthrough" branch).

export const KIDS_THUMBNAIL_STYLE = {
  mode: "cover-passthrough",
  targetSize: { width: 1200, height: 1200 },
  reason:
    "Kids picture-book covers are already illustration-forward and consistent with the visual bible; wrapping them in a 3D mockup hurts click appeal and breaks style continuity.",
} as const;
