import { useState, useRef, useEffect } from "react";
import { getToken } from "../lib/auth";

export default function ExecuteScriptModal({ projectId, projectName, onClose }) {
    const [command, setCommand] = useState("");
    const [logs, setLogs] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [hasRun, setHasRun] = useState(false);
    const logsEndRef = useRef(null);
    const eventSourceRef = useRef(null);

    // Auto-scroll to bottom when logs update
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const executeCommand = async () => {
        if (!command.trim()) return;

        setIsRunning(true);
        setHasRun(true);
        setLogs([{ type: "info", message: `$ ${command}` }]);

        try {
            const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";
            const response = await fetch(`${apiBase}/projects/${projectId}/exec`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${getToken()}`
                },
                body: JSON.stringify({ command })
            });

            if (!response.ok) {
                const err = await response.json();
                setLogs(prev => [...prev, { type: "error", message: err.error || "Failed to execute command" }]);
                setIsRunning(false);
                return;
            }

            // Handle SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === "done") {
                                setIsRunning(false);
                            } else if (data.type === "exit") {
                                const exitType = data.code === 0 ? "success" : "error";
                                setLogs(prev => [...prev, { type: exitType, message: data.message }]);
                            } else if (data.message) {
                                setLogs(prev => [...prev, { type: data.type, message: data.message }]);
                            }
                        } catch (e) {
                            console.error("Failed to parse SSE data:", e);
                        }
                    }
                }
            }
        } catch (err) {
            setLogs(prev => [...prev, { type: "error", message: `Connection error: ${err.message}` }]);
            setIsRunning(false);
        }
    };

    const getLogColor = (type) => {
        switch (type) {
            case "stdout": return "#e0e0e0";
            case "stderr": return "#ff6b6b";
            case "error": return "#ff6b6b";
            case "success": return "#69db7c";
            case "info": return "#74c0fc";
            case "start": return "#ffd43b";
            default: return "#e0e0e0";
        }
    };

    return (
        <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
        }}>
            <div style={{
                background: "white",
                borderRadius: 12,
                width: "90%",
                maxWidth: 700,
                maxHeight: "80vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
            }}>
                {/* Header */}
                <div style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid #eee",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: "1.2em" }}>Execute Script</h2>
                        <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "0.9em" }}>
                            {projectName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isRunning}
                        style={{
                            background: "none",
                            border: "none",
                            fontSize: "1.5em",
                            cursor: isRunning ? "not-allowed" : "pointer",
                            color: isRunning ? "#ccc" : "#666"
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Command Input */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee" }}>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: "0.9em" }}>
                        Command to execute:
                    </label>
                    <div style={{ display: "flex", gap: 10 }}>
                        <input
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !isRunning && executeCommand()}
                            placeholder="e.g., npx prisma db seed, npm run migrate, node scripts/seed.js"
                            disabled={isRunning}
                            style={{
                                flex: 1,
                                padding: "10px 12px",
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                fontSize: "0.95em",
                                fontFamily: "monospace"
                            }}
                        />
                        <button
                            onClick={executeCommand}
                            disabled={isRunning || !command.trim()}
                            style={{
                                background: isRunning ? "#ccc" : "#2196F3",
                                color: "white",
                                border: "none",
                                padding: "10px 20px",
                                borderRadius: 6,
                                cursor: isRunning || !command.trim() ? "not-allowed" : "pointer",
                                fontWeight: 500
                            }}
                        >
                            {isRunning ? "Running..." : "Execute"}
                        </button>
                    </div>
                    <p style={{ margin: "8px 0 0 0", color: "#888", fontSize: "0.8em" }}>
                        Commands run inside your deployed container. Common uses: database seeding, migrations, cache clearing.
                    </p>
                </div>

                {/* Logs Output */}
                <div style={{
                    flex: 1,
                    background: "#1e1e1e",
                    padding: 16,
                    overflowY: "auto",
                    minHeight: 200,
                    maxHeight: 350
                }}>
                    {!hasRun ? (
                        <div style={{ color: "#666", textAlign: "center", padding: 40 }}>
                            Enter a command above and click Execute to run it in your container.
                        </div>
                    ) : logs.length === 0 ? (
                        <div style={{ color: "#666", textAlign: "center", padding: 40 }}>
                            Waiting for output...
                        </div>
                    ) : (
                        <div style={{ fontFamily: "monospace", fontSize: "0.85em", lineHeight: 1.6 }}>
                            {logs.map((log, i) => (
                                <div key={i} style={{ color: getLogColor(log.type), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                                    {log.message}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: "12px 20px",
                    borderTop: "1px solid #eee",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10
                }}>
                    <button
                        onClick={onClose}
                        disabled={isRunning}
                        style={{
                            background: isRunning ? "#eee" : "#f5f5f5",
                            color: isRunning ? "#999" : "#333",
                            border: "none",
                            padding: "10px 20px",
                            borderRadius: 6,
                            cursor: isRunning ? "not-allowed" : "pointer"
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
