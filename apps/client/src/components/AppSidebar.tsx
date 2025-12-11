import React, { FC, memo, useMemo } from 'react';
import {
    LayoutDashboard,
    Database,
    XCircle,
    RotateCcw,
    CheckSquare,
    Tag,
    PlayCircle,
    Link2,
} from 'lucide-react';
import NavLink from '@/components/NavLink';
import { useLocation } from 'react-router-dom';

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from '@/components/ui/sidebar';

type NavItem = {
    title: string;
    url: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const MENU_LABEL_MAIN = 'Menu Principal';
const MENU_LABEL_CONFIGS = 'Configurações';

const MAIN_ITEMS: NavItem[] = [
    { title: 'Dashboard', url: '/', icon: LayoutDashboard },
    { title: 'Bases', url: '/bases', icon: Database },
    { title: 'Conciliações', url: '/conciliacoes', icon: PlayCircle },
];

const CONFIG_ITEMS: NavItem[] = [
    { title: 'Cancelamento', url: '/configs/cancelamento', icon: XCircle },
    { title: 'Estorno', url: '/configs/estorno', icon: RotateCcw },
    { title: 'Conciliação', url: '/configs/conciliacao', icon: CheckSquare },
    { title: 'Mapeamento', url: '/configs/mapeamento', icon: Link2 },
    { title: 'Subtipos', url: '/configs/subtypes', icon: Tag },
];

export function isPathActive(currentPath: string, candidate: string): boolean {
    if (candidate === '/') return currentPath === '/';
    return currentPath.startsWith(candidate);
}

const SidebarSection: FC<{ label: string; items: NavItem[]; activePath: string }> = memo(function SidebarSection({ label, items, activePath }) {
    const rendered = useMemo(
        () => (
            <SidebarGroup>
                <SidebarGroupLabel>{label}</SidebarGroupLabel>
                <SidebarGroupContent>
                    <SidebarMenu>
                        {items.map((item) => {
                            const Icon = item.icon;
                            const key = item.url;
                            const isActive = isPathActive(activePath, item.url);
                            const shouldEnd = item.url === '/';

                            return (
                                <SidebarMenuItem key={key}>
                                    <SidebarMenuButton asChild isActive={isActive}>
                                        <NavLink to={item.url} end={shouldEnd}>
                                            <Icon />
                                            <span>{item.title}</span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        ),
        [label, items, activePath]
    );

    return rendered;
});

export const AppSidebar: FC = memo(function AppSidebar() {
    // keep the sidebar open state available for UI components that need it
    useSidebar();
    const location = useLocation();
    const activePath = location.pathname;

    return (
        <Sidebar collapsible="icon" aria-label="Application sidebar">
            <SidebarContent>
                <SidebarSection label={MENU_LABEL_MAIN} items={MAIN_ITEMS} activePath={activePath} />
                <SidebarSection label={MENU_LABEL_CONFIGS} items={CONFIG_ITEMS} activePath={activePath} />
            </SidebarContent>
        </Sidebar>
    );
});

export default AppSidebar;
