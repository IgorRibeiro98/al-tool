import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    // Use a stronger background in light mode for better contrast.
    // Keep `dark:bg-muted` so dark theme remains unchanged.
    return <div className={cn("animate-pulse rounded-md bg-slate-200 dark:bg-muted", className)} {...props} />;
}

export { Skeleton };
