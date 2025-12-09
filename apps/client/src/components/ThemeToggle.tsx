import React, { useEffect, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Laptop } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

function resolveMode(raw?: string | null): ThemeMode {
    if (!raw) return 'light';
    const value = String(raw).toLowerCase();
    if (value === 'dark') return 'dark';
    if (value === 'system') return 'system';
    return 'light';
}

export default function ThemeToggle(): JSX.Element | null {
    const { theme, setTheme } = useTheme();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const current = resolveMode(theme);

    const setDark = useCallback(() => setTheme('dark'), [setTheme]);
    const setLight = useCallback(() => setTheme('light'), [setTheme]);

    if (!isMounted) return null;

    if (current === 'dark') {
        return (
            <Button variant="ghost" size="icon" onClick={setLight} aria-label="Switch to light theme">
                <Sun className="h-4 w-4" />
            </Button>
        );
    }

    if (current === 'light') {
        return (
            <Button variant="ghost" size="icon" onClick={setDark} aria-label="Switch to dark theme">
                <Moon className="h-4 w-4" />
            </Button>
        );
    }

    // system
    return (
        <Button variant="ghost" size="icon" onClick={setDark} aria-label="Switch to dark theme">
            <Laptop className="h-4 w-4" />
        </Button>
    );
}
