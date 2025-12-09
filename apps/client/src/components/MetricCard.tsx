import React, { FC, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

export type MetricCardProps = {
    title: string;
    value: string | number;
    icon: LucideIcon;
    description?: string;
    className?: string;
};

const CARD_BASE = 'hover:shadow-md transition-shadow';
const HEADER_CLASS = 'flex flex-row items-center justify-between space-y-0 pb-2';
const TITLE_CLASS = 'text-sm font-medium text-muted-foreground';
const ICON_CLASS = 'h-4 w-4 text-muted-foreground';
const VALUE_CLASS = 'text-2xl font-bold';
const DESCRIPTION_CLASS = 'text-xs text-muted-foreground mt-1';

const MetricCardHeader: FC<{ title: string; Icon: LucideIcon }> = ({ title, Icon }) => (
    <CardHeader className={HEADER_CLASS}>
        <CardTitle className={TITLE_CLASS}>{title}</CardTitle>
        <Icon className={ICON_CLASS} aria-hidden />
    </CardHeader>
);

export const MetricCard: FC<MetricCardProps> = memo(function MetricCard({ title, value, icon: Icon, description, className }) {
    const containerClass = `${CARD_BASE}${className ? ` ${className}` : ''}`;

    return (
        <Card className={containerClass} role="region" aria-label={`Metric: ${title}`}>
            <MetricCardHeader title={title} Icon={Icon} />
            <CardContent>
                <div className={VALUE_CLASS}>{value}</div>
                {description ? <p className={DESCRIPTION_CLASS}>{description}</p> : null}
            </CardContent>
        </Card>
    );
});

export default MetricCard;
