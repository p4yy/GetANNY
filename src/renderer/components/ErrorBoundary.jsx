import React from "react";

export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    // Only component *names* are logged. Never print potentially sensitive
    // error messages, download URLs, URLs in stack locations or component props.
    // A production React #130 gives no useful context without these names.
    const componentNames = String(info?.componentStack || "")
      .split("\n")
      .map((entry) => entry.trim().match(/^at\s+([A-Za-z_$][A-Za-z0-9_$.]*)/)?.[1])
      .filter(Boolean)
      .slice(0, 12);
    console.error(
      "GetANNY renderer component failure:",
      String(error?.name || "Error"),
      componentNames.join(" > ") || "component stack unavailable",
    );
  }
  render() {
    if (this.state.failed)
      return (
        <section className="error-boundary" role="alert">
          <strong>Something went wrong in this section.</strong>
          <p>
            Other GetANNY pages remain available. Reopen this page or restart
            the app if the problem continues.
          </p>
          <button
            className="button secondary"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </section>
      );
    return this.props.children;
  }
}
