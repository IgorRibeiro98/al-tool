import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
    loading?: boolean;
    children: React.ReactNode;
};

export default function PageSkeletonWrapper({ loading, children }: Props) {
    if (!loading) return <>{children}</>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-4 w-48" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-10 rounded-full" />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-36 w-full" />
            </div>

            <div className="rounded-md border overflow-hidden">
                <div className="p-4">
                    <Skeleton className="h-6 w-48 mb-4" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                    </div>
                </div>
                <div className="p-4">
                    <Skeleton className="h-6 w-32 mb-3" />
                    <div className="grid gap-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex gap-2">
                                <Skeleton className="h-6 w-20" />
                                <Skeleton className="h-6 w-full" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
