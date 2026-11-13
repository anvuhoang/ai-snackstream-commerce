/**
 * Each product group gets its own colour on the shop: a soft stage behind the photo and a matching label colour. The colour is
 * picked from the group's slug, so a group keeps its colour forever and a new group needs no code change.
 */
const STYLES = [
  { stage: "bg-accent-soft", label: "text-accent" },
  { stage: "bg-turmeric-soft", label: "text-warn" },
  { stage: "bg-leaf-soft", label: "text-leaf" },
  { stage: "bg-canvas", label: "text-warn" },
] as const;

export function categoryStyle(slug: string | null | undefined) {
  if (!slug) return STYLES[3];
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STYLES[h % STYLES.length];
}
