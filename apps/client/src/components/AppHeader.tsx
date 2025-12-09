import React, { FC, memo } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { FileCheck } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

type AppHeaderProps = {
    title?: string;
    className?: string;
    showSidebarTrigger?: boolean;
};

const DEFAULT_TITLE = 'Conciliação Fiscal';

const AppLogo: FC<{ title: string }> = ({ title }) => (
    <div className="flex items-center gap-2" aria-hidden>
        <FileCheck className="h-5 w-5 text-primary" />
        <span className="font-semibold text-lg">{title}</span>
    </div>
);

const HeaderActions: FC = () => (
    <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
    </div>
);

function buildClassName(base = ''): string {
    const defaultClasses = 'sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60';
    return `${defaultClasses} ${base}`.trim();
}

export const AppHeader: FC<AppHeaderProps> = memo(function AppHeader({
    title = DEFAULT_TITLE,
    className,
    showSidebarTrigger = true,
}) {
    return (
        <header className={buildClassName(className)} aria-label="App header">
            <div className="flex h-14 items-center px-4 gap-4">
                {showSidebarTrigger && <SidebarTrigger />}
                <AppLogo title={title} />
                <HeaderActions />
            </div>
        </header>
    );
});

export default AppHeader;
