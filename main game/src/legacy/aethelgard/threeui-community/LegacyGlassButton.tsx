/* Adapted from ThreeUI Community SectionButton, copyright (c) 2026 Meng To,
 * MIT licensed. Pinned upstream: 68802d5428071ada5c20db8094b1649e6bb770ed.
 * Changes: native button props/ref, Crownfall content, accessible decoration.
 * See LICENSE in this directory. */
import { forwardRef, type ButtonHTMLAttributes } from 'react';

export const LegacyGlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function LegacyGlassButton({ children, className = '', type = 'button', ...props }, ref) {
    return <button {...props} ref={ref} type={type} className={`ealdholt-threeui-button ${className}`.trim()}>
      <span className="ealdholt-threeui-button__title">{children}</span>
      <span className="ealdholt-threeui-button__circle" aria-hidden="true" />
    </button>;
  },
);
