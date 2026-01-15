import { useMemo, useState } from "react";

export default function DangerConfirmModal({
  title,
  description,
  expectedName,
  expectedPhrase,
  confirmText = "Confirm",
  loading = false,
  onConfirm,
  onClose,
}) {
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");

  const canConfirm = useMemo(() => {
    return (
      String(name).trim() === String(expectedName).trim() &&
      String(phrase).trim() === String(expectedPhrase).trim()
    );
  }, [name, phrase, expectedName, expectedPhrase]);

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
          maxWidth: 540,
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, color: "#c62828" }}>{title}</h2>
            {description ? (
              <p style={{ margin: "8px 0 0 0", color: "#666", fontSize: "0.9em" }}>{description}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "1.5em", cursor: "pointer", color: "#999" }}
            aria-label="Close"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: 12, margin: "16px 0" }}>
          <strong style={{ color: "#c62828" }}>This action is destructive</strong>
          <div style={{ marginTop: 6, color: "#c62828", fontSize: "0.9em" }}>
            Type the database name and the confirmation phrase to continue.
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>
            Type database name: <span style={{ fontFamily: "monospace" }}>{expectedName}</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ddd", fontFamily: "monospace" }}
            disabled={loading}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>
            Type phrase: <span style={{ fontFamily: "monospace" }}>{expectedPhrase}</span>
          </label>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ddd", fontFamily: "monospace" }}
            disabled={loading}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ background: "#f0f0f0", color: "#333", padding: "10px 16px", borderRadius: 6, border: "none", cursor: "pointer" }}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            style={{
              background: !canConfirm || loading ? "#f0b4b4" : "#f44336",
              color: "white",
              padding: "10px 16px",
              borderRadius: 6,
              border: "none",
              cursor: !canConfirm || loading ? "not-allowed" : "pointer",
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

