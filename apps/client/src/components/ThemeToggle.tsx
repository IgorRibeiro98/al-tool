import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Laptop } from 'lucide-react';

const ThemeToggle = () => {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    if (!mounted) return null;

    const current = theme === 'system' ? 'system' : theme || 'light';

    return (
        <div>
            {current === 'dark' ? (
                <Button variant="ghost" size="icon" onClick={() => setTheme('light')} aria-label="Switch to light theme">
                    <Sun className="h-4 w-4" />
                </Button>
            ) : current === 'light' ? (
                <Button variant="ghost" size="icon" onClick={() => setTheme('dark')} aria-label="Switch to dark theme">
                    <Moon className="h-4 w-4" />
                </Button>
            ) : (
                <Button variant="ghost" size="icon" onClick={() => setTheme('dark')} aria-label="Switch to dark theme">
                    <Laptop className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
};

export default ThemeToggle;
