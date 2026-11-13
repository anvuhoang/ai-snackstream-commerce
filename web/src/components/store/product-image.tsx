import Image from "next/image";
import { cn } from "@/lib/cn";
import type { ImageOut } from "@/lib/catalog";

/** The product photo on a soft grey stage, or a plain tile with the first letter when there is none yet. Fills its parent box. */
export function ProductImage({
  image,
  name,
  priority = false,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw",
  className,
}: {
  image: ImageOut | null | undefined;
  name: string;
  seed?: number;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square overflow-hidden bg-canvas", className)}>
      {image ? (
        // Uploads are served by our own API; they are not sent through the Next.js image optimizer.
        <Image src={image.url} alt={image.alt || name} fill sizes={sizes} priority={priority} unoptimized className="object-cover" />
      ) : (
        <div aria-hidden className="grid size-full place-items-center text-8xl font-light tracking-[-0.05em] text-white">
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}
