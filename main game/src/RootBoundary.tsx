import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last line of defence for the menu. A throw anywhere in App, its screens,
 * the films or the stage would otherwise unmount everything and leave an empty
 * dark page (the boot markup is already gone). Reload starts the menu again.
 */
export default class RootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Crownfall stopped after an unexpected error.", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section
      role="alert"
      aria-labelledby="crownfall-failure-title"
      data-root-failure=""
      style={{ position: "fixed", inset: 0, display: "grid", placeContent: "center", justifyItems: "center", gap: "18px", padding: "24px", textAlign: "center", background: "radial-gradient(ellipse at 70% 40%, #253126, #100d08 75%)", color: "#d7c59c", fontFamily: "Barlow, Arial, sans-serif" }}
    >
      <h1 id="crownfall-failure-title" style={{ margin: 0, fontSize: "clamp(22px, 2.6vw, 34px)", fontWeight: 500, letterSpacing: ".04em", color: "#d69d43" }}>Crownfall stopped unexpectedly</h1>
      <p style={{ margin: 0, maxWidth: "36em", color: "#bcb9a7", fontSize: "15px", lineHeight: 1.5 }}>Something went wrong in the menu. Reload to open it again.</p>
      <button
        type="button"
        autoFocus
        onClick={() => window.location.reload()}
        style={{ minHeight: "36px", padding: "8px 22px", border: "1px solid #a88a4580", background: "#6b4b1f66", color: "#e1c387", font: "inherit", fontSize: "15px", cursor: "pointer" }}
      >Reload</button>
    </section>;
  }
}
