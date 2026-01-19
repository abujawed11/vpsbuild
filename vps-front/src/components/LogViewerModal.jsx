import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";

export default function LogViewerModal({ deploymentId, onClose, onComplete }) {
    const [logs, setLogs] = useState("");
    const [status, setStatus] = useState("QUEUED");
    const logContainerRef = useRef(null);

    useEffect(() => {
        if (!deploymentId) return;

        // Fetch immediately
        fetchStatus();

        const pollInterval = setInterval(fetchStatus, 1000);

        async function fetchStatus() {
            try {
                const res = await apiFetch(`/deployments/status/${deploymentId}`, { token: getToken() });
                setLogs(res.logs || "");
                setStatus(res.status);

                if (res.status === "DEPLOYED" || res.status === "FAILED") {
                    clearInterval(pollInterval);
                    if (onComplete) onComplete(res.status);
                }
            } catch (e) {
                console.error("Failed to poll logs", e);
            }
        }

        return () => clearInterval(pollInterval);
    }, [deploymentId, onComplete]);

    // Auto-scroll
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const getStatusColor = () => {
        if (status === "DEPLOYED") return { bg: "#e8f5e9", text: "#2e7d32" };
        if (status === "FAILED") return { bg: "#ffebee", text: "#c62828" };
        return { bg: "#e3f2fd", text: "#1565c0" };
    };

    const colors = getStatusColor();

    return (
        <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, backdropFilter: "blur(2px)"
        }} onClick={onClose}>
            <div style={{
                background: "white", width: "90%", maxWidth: 900, height: "80vh",
                borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
            }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8f9fa" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <h3 style={{ margin: 0 }}>Deployment Logs</h3>
                        <span style={{
                            padding: "4px 12px", borderRadius: 20, fontSize: "0.85em", fontWeight: 600,
                            background: colors.bg, color: colors.text
                        }}>
                            {status}
                        </span>
                    </div>
                    <button onClick={onClose} style={{ border: "none", background: "none", fontSize: "1.5em", cursor: "pointer", color: "#666" }}>×</button>
                </div>
                <div ref={logContainerRef} style={{
                    flex: 1, padding: 20, overflowY: "auto", background: "#1e1e1e", color: "#d4d4d4",
                    fontFamily: "monospace", whiteSpace: "pre-wrap", fontSize: "0.9em", lineHeight: "1.5"
                }}>
                    {logs || "Waiting for logs..."}
                </div>
                {(status === "DEPLOYED" || status === "FAILED") && (
                     <div style={{ padding: "16px 24px", borderTop: "1px solid #eee", textAlign: "right", background: "#white" }}>
                        <button onClick={onClose} style={{
                            background: "#333", color: "white", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer"
                        }}>Close</button>
                     </div>
                )}
            </div>
        </div>
    );
}
