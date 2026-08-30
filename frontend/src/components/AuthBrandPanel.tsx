/**
 * AuthBrandPanel — the green branding column beside the Login / Register form
 * on desktop (Figma BrandPanel 7:3 / 7:25). Rendered as real DOM (not CSS
 * generated content) so it is queryable in tests and reliably exposed to
 * assistive tech.
 *
 * Always rendered; `display: none` below the 1024px breakpoint (see
 * styles/desktop.css), where the auth pages keep their existing centered
 * mobile card — same visibility gate the split-panel layout already used.
 */

export function AuthBrandPanel() {
  return (
    <aside className="auth-brand-panel">
      <span className="auth-brand-name">แบ่งจ่าย</span>
    </aside>
  )
}
