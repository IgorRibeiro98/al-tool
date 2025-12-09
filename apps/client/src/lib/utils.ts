import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge and normalize CSS class lists.
 * - Accepts the same inputs as `clsx`.
 * - Uses `tailwind-merge` to resolve Tailwind class conflicts.
 *
 * Returns a safe string (empty string when no classes provided).
 */
export const cn = (...inputs: ClassValue[]): string => {
    if (!inputs || inputs.length === 0) return '';
    // let clsx produce a string then resolve Tailwind-specific conflicts
    const merged = clsx(inputs);
    return twMerge(merged);
};

export default cn;
