/**
 * AuthBrandPanel — the green branding column beside the Login / Register form
 * on desktop (Figma BrandPanel 7:3 / 7:25). Rendered as real DOM (not CSS
 * generated content) so every line is queryable in tests and reliably exposed
 * to assistive tech.
 *
 * Three lines: the wordmark, the marketing headline (Figma headline slot 7:5,
 * two lines, each its own <span> so both are individually queryable), and a
 * one-line description. The headline is a <p>, not an <h1> — the auth card
 * already owns the page <h1>.
 *
 * Always rendered; `display: none` below the 1024px breakpoint (see
 * styles/desktop.css), where the auth pages keep their existing centered
 * mobile card — same visibility gate the split-panel layout already used.
 */

export function AuthBrandPanel() {
  return (
    <aside className="auth-brand-panel">
      <span className="auth-brand-name">แบ่งจ่าย</span>
      <p className="auth-brand-headline">
        <span>แบ่งจ่ายให้ลงตัว</span>
        <span>ไม่ต้องคิดเลขเอง</span>
      </p>
      <p className="auth-brand-desc">
        บันทึกค่าใช้จ่ายกลุ่ม แบ่งยอดอัตโนมัติ และเคลียร์หนี้กันได้ง่าย ๆ
      </p>
    </aside>
  )
}
