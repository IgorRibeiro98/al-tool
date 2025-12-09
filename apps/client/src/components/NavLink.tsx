import React, { forwardRef } from 'react';
import { NavLink as RouterNavLink, NavLinkProps } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Props for the compatible NavLink wrapper.
 * - preserves `NavLinkProps` from react-router-dom but provides
 *   legacy `activeClassName`/`pendingClassName` convenience props.
 */
export interface NavLinkCompatProps extends Omit<NavLinkProps, 'className'> {
    className?: string;
    activeClassName?: string;
    pendingClassName?: string;
}

/**
 * Simple wrapper around react-router's `NavLink` to support project
 * conventions for conditional class names. Keeps component small
 * and easy to test.
 */
const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(function NavLink(
    { className, activeClassName, pendingClassName, to, ...rest },
    ref
) {
    return (
        <RouterNavLink
            ref={ref}
            to={to}
            className={({ isActive, isPending }) =>
                cn(className, isActive && activeClassName, isPending && pendingClassName)
            }
            {...(rest as any)}
        />
    );
});

NavLink.displayName = 'NavLink';

export { NavLink as NamedNavLink };
export default NavLink;
