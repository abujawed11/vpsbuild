import { useState } from "react";

export default function OneTimeSecretModal({ title, subtitle, secrets, onClose }) {
  const [copiedKey, setCopiedKey] = useState("");

  const copy = async (text, key) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle ? (
              <p style={{ margin: "8px 0 0 0", color: "#666", fontSize: "0.9em" }}>{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "1.5em", cursor: "pointer", color: "#999" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 8,
            padding: 12,
            margin: "16px 0",
          }}
        >
          <strong style={{ color: "#856404" }}>Save this now</strong>
          <div style={{ marginTop: 6, fontSize: "0.9em", color: "#856404" }}>
            This secret is shown once and won’t be retrievable later.
          </div>
        </div>

        {secrets.map((s) => (
          <div key={s.key} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>
              {s.label}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly
                value={s.value || ""}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  fontFamily: "monospace",
                  fontSize: "0.85em",
                  background: s.highlight ? "#fff8e1" : "white",
                }}
              />
              <button
                onClick={() => copy(s.value, s.key)}
                style={{
                  background: copiedKey === s.key ? "#4caf50" : "#f0f0f0",
                  color: copiedKey === s.key ? "white" : "#333",
                  border: "none",
                  borderRadius: 6,
                  padding: "0 12px",
                  cursor: "pointer",
                }}
              >
                {copiedKey === s.key ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              background: "#2196F3",
              color: "white",
              padding: "10px 20px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

