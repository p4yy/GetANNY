import React from "react";

export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* the failed panel is isolated; no sensitive data is logged */
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
