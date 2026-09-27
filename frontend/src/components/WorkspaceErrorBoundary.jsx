import { Component } from "react";

export class WorkspaceErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="canvas-empty" style={{ minHeight: "70vh" }} role="alert">
        <h1>Unable to display the workspace</h1>
        <p>
          Reload to try again. Inputs saved in this browser will be restored.
        </p>
        <button
          className="button button--primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </main>
    );
  }
}
