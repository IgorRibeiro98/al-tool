import {
    LayoutDashboard,
    Database,
    Settings,
    XCircle,
    RotateCcw,
    CheckSquare,
    PlayCircle,
    Link2
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

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
} from "@/components/ui/sidebar";

const mainItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Bases", url: "/bases", icon: Database },
    { title: "Conciliações", url: "/conciliacoes", icon: PlayCircle },
];

const configItems = [
    { title: "Cancelamento", url: "/configs/cancelamento", icon: XCircle },
    { title: "Estorno", url: "/configs/estorno", icon: RotateCcw },
    { title: "Conciliação", url: "/configs/conciliacao", icon: CheckSquare },
    { title: "Mapeamento", url: "/configs/mapeamento", icon: Link2 },
];

export function AppSidebar() {
    const { open } = useSidebar();
    const location = useLocation();

    const isActive = (path: string) => {
        if (path === "/") return location.pathname === "/";
        return location.pathname.startsWith(path);
    };

    return (
        <Sidebar collapsible="icon">
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Menu Principal</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {mainItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                                        <NavLink to={item.url} end={item.url === "/"}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel>Configurações</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {configItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                                        <NavLink to={item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}
