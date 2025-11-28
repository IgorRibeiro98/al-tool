import { SidebarTrigger } from "@/components/ui/sidebar";
import { FileCheck } from "lucide-react";
import ThemeToggle from './ThemeToggle';

export function AppHeader() {
    return (
        <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
            <div className="flex h-14 items-center px-4 gap-4">
                <SidebarTrigger />
                <div className="flex items-center gap-2">
                    <FileCheck className="h-5 w-5 text-primary" />
                    <span className="font-semibold text-lg">Conciliação Fiscal</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <ThemeToggle />
                </div>
            </div>
        </header>
    );
}
