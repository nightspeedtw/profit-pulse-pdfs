// Backward-compat shim. New code should use resolveTrack() from track-registry.ts.
// This file is retained so existing edge functions continue to compile while
// the track-registry rollout finishes.
import { resolveTrack, wrongTrackResponse } from "./track-registry.ts";

export function isKidsBook(ebook: Record<string, unknown> | null | undefined): boolean {
  return resolveTrack(ebook as any) === "kids";
}

export function kidsGuardResponse(ebookId: string, corsHeaders: Record<string, string>) {
  // The old contract only guarded adult pipelines against kids books.
  // Preserve that shape while pointing callers at the new registry.
  return wrongTrackResponse(ebookId, "adult", "kids", corsHeaders, "adult-pipeline");
}

export { resolveTrack, wrongTrackResponse };
