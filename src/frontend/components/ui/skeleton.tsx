import { cn } from "@/frontend/lib/utils"

// Fills with `bg-muted`, not shadcn's `bg-accent`: under the v2 token layer
// `--accent` is a transparent interaction wash rather than a surface, so an
// accent-filled skeleton is invisible on the muted headers it usually sits in.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
