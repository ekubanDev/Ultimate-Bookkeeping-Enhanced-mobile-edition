import { useEffect } from "react";
import "@/App.css";

function App() {
  useEffect(() => {
    if (!window.location.pathname.startsWith("/bookkeeping")) {
      window.location.replace("/bookkeeping/");
    }
  }, []);

  return (
    <div className="App">
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f1419",
        color: "#e1e8ed",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <p>Loading Ultimate Bookkeeping...</p>
      </div>
    </div>
  );
}

export default App;
