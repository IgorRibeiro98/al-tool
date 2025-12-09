import React, { FC, memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
    loading?: boolean;
    children?: React.ReactNode;
    className?: string;
};

const LIST_ITEM_COUNT = 6;

const HeaderSkeleton: FC = memo(() => (
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
));

const TwoColumnSkeleton: FC = memo(() => (
    <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
    </div>
));

const DetailsSkeleton: FC = memo(() => (
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
                {Array.from({ length: LIST_ITEM_COUNT }).map((_, i) => (
                    <div key={i} className="flex gap-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-6 w-full" />
                    </div>
                ))}
            </div>
        </div>
    </div>
));

export const PageSkeletonWrapper: FC<Props> = memo(function PageSkeletonWrapper({ loading = false, children, className }) {
    if (!loading) return <>{children}</>;

    return (
        <div className={['space-y-6', className].filter(Boolean).join(' ')} role="status" aria-busy="true">
            <HeaderSkeleton />
            <TwoColumnSkeleton />
            <DetailsSkeleton />
        </div>
    );
});

export default PageSkeletonWrapper;
