import React, { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Root error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fafafa",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something broke</h1>
          <p style={{ color: "#666", marginBottom: 16 }}>
            Open the browser devtools console (F12 → Console) for details. Common fixes: use{" "}
            <code>http://localhost:3000</code> (not a file:// URL), set{" "}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{" "}
            <code>.env</code>, then restart <code>npm run dev</code>.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 16,
              fontSize: 13,
            }}
          >
            {e.message}
            {e.stack ? `\n\n${e.stack}` : ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
