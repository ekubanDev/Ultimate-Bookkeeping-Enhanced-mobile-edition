import { useEffect } from "react";
import "@/App.css";

function App() {
  useEffect(() => {
    const alreadyOnBookkeeping =
      window.location.pathname.startsWith("/bookkeeping");

    if (!alreadyOnBookkeeping) {
      const base = window.location.origin || "";
      // Force-load the bookkeeping SPA entry file so we leave the shell screen
      window.location.href = `${base}/bookkeeping/index.html`;
    }
  }, []);

  return (
    <div className="App">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#0f1419",
          color: "#e1e8ed",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <p>Loading Ultimate Bookkeeping...</p>
      </div>
    </div>
  );
}

export default App;
