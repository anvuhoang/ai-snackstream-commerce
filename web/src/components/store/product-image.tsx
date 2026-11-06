import Image from "next/image";
import { cn } from "@/lib/cn";
import type { ImageOut } from "@/lib/catalog";

const GRADIENTS = [
  "from-orange-400 to-red-600",
  "from-amber-300 to-orange-600",
  "from-lime-400 to-emerald-600",
  "from-rose-400 to-fuchsia-700",
];

/** The product photo, or a coloured tile with the first letter when there is none yet. Fills its parent box. */
export function ProductImage({
  image,
  name,
  seed = 0,
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
        <div
          aria-hidden
          className={cn("grid size-full place-items-center bg-gradient-to-br text-6xl font-extrabold text-white/90", GRADIENTS[seed % GRADIENTS.length])}
        >
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}
