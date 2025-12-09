import { useEffect, useState } from 'react';

const DEFAULT_MOBILE_BREAKPOINT = 768;

function getWindowIsMobile(breakpoint: number): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
}

/**
 * Hook that returns true when viewport is narrower than the provided breakpoint.
 * Uses `matchMedia` when available and falls back to `window.innerWidth`.
 */
export function useIsMobile(breakpoint: number = DEFAULT_MOBILE_BREAKPOINT): boolean {
    const [isMobile, setIsMobile] = useState<boolean>(() => getWindowIsMobile(breakpoint));

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            // Server-side or older environment: no listeners available
            setIsMobile(getWindowIsMobile(breakpoint));
            return;
        }

        const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);

        const onChange = (ev: MediaQueryListEvent | MediaQueryList) => {
            // MediaQueryListEvent has .matches; MediaQueryList (old) may be passed directly
            const matches = 'matches' in ev ? ev.matches : mq.matches;
            setIsMobile(Boolean(matches));
        };

        // Initialize state from current match
        setIsMobile(Boolean(mq.matches));

        // Add listener with cross-browser support
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onChange as EventListener);
            return () => mq.removeEventListener('change', onChange as EventListener);
        }

        // Fallback for older browsers
        if (typeof (mq as any).addListener === 'function') {
            (mq as any).addListener(onChange);
            return () => (mq as any).removeListener(onChange);
        }

        return () => {};
    }, [breakpoint]);

    return isMobile;
}

export default useIsMobile;
