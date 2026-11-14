import { Component, type KeyboardEvent, type ReactNode } from "react";

interface ShowcaseBoundaryProps {
  children: ReactNode;
  onBack(): void;
  /** What could not be opened; defaults to the Showcase viewer. */
  title?: string;
  message?: string;
}

/** A failed optional chunk (the Showcase viewer or the match) must leave the rest of the menu usable. */
export default class ShowcaseBoundary extends Component<ShowcaseBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  // Escape leaves too: over a match the menu's own key handler stands aside.
  private readonly keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.props.onBack();
  };
  render() {
    if (!this.state.failed) return this.props.children;
    const { title = "Showcase could not be opened", message = "The rest of the menu is available. Reload to try the Showcase viewer again." } = this.props;
    return <section role="alert" onKeyDown={this.keyDown} style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center", gap: "1rem", color: "#d8c79f" }}>
      <h1 style={{ fontWeight: 500, color: "#d69d43" }}>{title}</h1>
      <p>{message}</p>
      {/* Focus lands on Back, so Enter, Space or Escape leave without a mouse. */}
      <div style={{ display: "flex", justifyContent: "center", gap: "2rem" }}><button type="button" onClick={() => window.location.reload()}>Reload</button><button type="button" autoFocus onClick={this.props.onBack}>Back</button></div>
    </section>;
  }
}
