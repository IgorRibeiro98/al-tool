import React, { FC } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { Outlet } from 'react-router-dom';

type LayoutProps = {
    children?: React.ReactNode;
    className?: string;
};

const LAYOUT_WRAPPER = 'min-h-screen flex w-full';
const CONTENT_COLUMN = 'flex-1 flex flex-col';
const MAIN_CLASS = 'flex-1 p-6';

export const Layout: FC<LayoutProps> = ({ children, className }) => {
    const content = (
        <div className={LAYOUT_WRAPPER + (className ? ` ${className}` : '')}>
            <AppSidebar />
            <div className={CONTENT_COLUMN}>
                <AppHeader />
                <main className={MAIN_CLASS} role="main">
                    {children ?? <Outlet />}
                </main>
            </div>
        </div>
    );

    return <SidebarProvider>{content}</SidebarProvider>;
};

export default Layout;
