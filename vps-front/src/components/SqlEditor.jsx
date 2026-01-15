import React, { useState, useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';

const STORAGE_KEY_LIMIT = 'vps_sql_limit';
const STORAGE_KEY_HISTORY = 'vps_sql_history';

function getStatementAtCursor(text, cursorPosition) {
    const statements = [];
    let current = '';
    let start = 0;
    
    // Simple state machine to ignore semicolons inside quotes
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (inQuote) {
            if (char === quoteChar) {
                // Check for escaped quote (e.g. 'It\'s') - minimal check
                if (i > 0 && text[i-1] !== '\\') {
                    inQuote = false;
                }
            }
        } else {
            if (char === "'" || char === '"' || char === '`') {
                inQuote = true;
                quoteChar = char;
            } else if (char === ';') {
                statements.push({
                    text: current.trim(),
                    start,
                    end: i + 1
                });
                current = '';
                start = i + 1;
                continue; // Don't add semicolon to next current
            }
        }
        current += char;
    }
    
    // Handle statement without trailing semicolon
    if (current.trim()) {
        statements.push({ text: current.trim(), start, end: text.length });
    }

    // Find which statement contains cursor
    // If cursor is at the very end (text.length), it might belong to the last statement
    return statements.find(s => cursorPosition >= s.start && cursorPosition <= s.end);
}

export default function SqlEditor({ defaultValue = "", onExecute, onExecuteAll, isLoading }) {
    const [value, setValue] = useState(defaultValue);
    const [limit, setLimit] = useState(() => localStorage.getItem(STORAGE_KEY_LIMIT) || "1000");
    const [history, setHistory] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || "[]");
        } catch {
            return [];
        }
    });
    const editorRef = useRef(null);
    const monacoRef = useRef(null);

    // Persist limit
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_LIMIT, limit);
    }, [limit]);

    // Persist history
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    }, [history]);

    const addToHistory = (query) => {
        if (!query) return;
        setHistory(prev => {
            const newHistory = [query, ...prev.filter(q => q !== query)].slice(0, 20);
            return newHistory;
        });
    };

    const handleEditorDidMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Add custom keybinding for Ctrl+Enter
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            handleExecute();
        });
    };

    const getQueryWithLimit = (sql) => {
        if (limit === "No limit") return sql;
        
        const limitVal = parseInt(limit, 10);
        if (isNaN(limitVal)) return sql;

        // Simple check if LIMIT already exists (case insensitive)
        // This is a naive check; a robust one would require a parser, but sufficient for this prototype
        if (!/\bLIMIT\s+\d+/i.test(sql)) {
            // Remove trailing semicolon if present
            const trimmed = sql.trim();
            if (trimmed.endsWith(';')) {
                return trimmed.slice(0, -1) + ` LIMIT ${limitVal};`;
            }
            return trimmed + ` LIMIT ${limitVal}`;
        }
        return sql;
    };

    const handleExecute = () => {
        if (!editorRef.current || !onExecute) return;
        
        const model = editorRef.current.getModel();
        const position = editorRef.current.getPosition(); // lineNumber, column
        const offset = model.getOffsetAt(position);
        const text = model.getValue();

        const statement = getStatementAtCursor(text, offset);
        
        if (statement && statement.text) {
            const finalQuery = getQueryWithLimit(statement.text);
            addToHistory(finalQuery);
            onExecute(finalQuery);
        } else {
             // Fallback if no specific statement found (e.g. empty file), try running everything or warn
             if (text.trim()) {
                 const finalQuery = getQueryWithLimit(text.trim());
                 addToHistory(finalQuery);
                 onExecute(finalQuery);
             }
        }
    };

    const handleExecuteAll = () => {
        if (!editorRef.current || !onExecute) return; // Note: onExecute can handle multiple or we use onExecuteAll prop
        
        const text = editorRef.current.getValue();
        if (!text.trim()) return;

        // Split by semicolon properly
        const statements = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inQuote) {
                if (char === quoteChar && (i === 0 || text[i-1] !== '\\')) inQuote = false;
            } else {
                if (char === "'" || char === '"' || char === '`') {
                    inQuote = true;
                    quoteChar = char;
                } else if (char === ';') {
                    statements.push(current.trim());
                    current = '';
                    continue;
                }
            }
            current += char;
        }
        if (current.trim()) statements.push(current.trim());

        // Filter empty
        const validStatements = statements.filter(s => s.length > 0);
        
        if (validStatements.length === 0) return;

        // Apply limit to select statements
        const finalQueries = validStatements.map(s => getQueryWithLimit(s));
        
        // If prop onExecuteAll provided, use it, otherwise call onExecute sequentially or as list?
        // The requirement says "Execute All - Run all statements sequentially"
        // And "Multiple Query Results... When executing multiple queries..."
        // We'll pass the list of queries to the parent.
        if (onExecuteAll) {
            onExecuteAll(finalQueries);
        } else {
            // Fallback: run just the first one or warn? 
            // We'll execute them one by one if parent expects single query, but that might race.
            // Let's assume onExecuteAll is preferred for bulk.
             if (finalQueries.length === 1) {
                 onExecute(finalQueries[0]);
             } else {
                 // If parent doesn't support multiple, we can't easily do it here without managing state.
                 // We will emit an event that we want to run multiple.
                 console.warn("onExecuteAll not provided, running first query only");
                 onExecute(finalQueries[0]);
             }
        }
    };

    const handleClear = () => {
        setValue("");
        if (editorRef.current) {
            editorRef.current.setValue("");
        }
    };

    const handleHistorySelect = (e) => {
        const val = e.target.value;
        if (!val) return;
        
        // Append to current value or replace? 
        // Usually history selection replaces or inserts. Let's insert at cursor or replace if empty.
        if (editorRef.current) {
             const model = editorRef.current.getModel();
             const currentVal = model.getValue();
             const newVal = currentVal ? currentVal + "\n\n" + val : val;
             editorRef.current.setValue(newVal);
             setValue(newVal); // Sync state
        }
        e.target.value = ""; // Reset select
    };

    return (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Toolbar */}
            <div style={{ background: "#f5f5f5", padding: "8px 12px", borderBottom: "1px solid #ddd", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 8 }}>
                    <button 
                        onClick={handleExecute} 
                        disabled={isLoading}
                        title="Run statement under cursor (Ctrl+Enter)"
                        style={{ background: "#4caf50", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em" }}
                    >
                        <span>▶</span> Execute
                    </button>
                    <button 
                        onClick={handleExecuteAll} 
                        disabled={isLoading}
                        style={{ background: "#2196F3", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: "0.9em" }}
                    >
                        Execute All
                    </button>
                    <button 
                        onClick={handleClear}
                        style={{ background: "white", color: "#666", border: "1px solid #ddd", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: "0.9em" }}
                    >
                        Clear
                    </button>
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em", color: "#666" }}>
                         <label>History:</label>
                         <select onChange={handleHistorySelect} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", maxWidth: 150 }}>
                             <option value="">Select...</option>
                             {history.map((h, i) => (
                                 <option key={i} value={h}>{h.length > 30 ? h.substring(0, 30) + '...' : h}</option>
                             ))}
                         </select>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em", color: "#666" }}>
                        <label>Limit:</label>
                        <select 
                            value={limit} 
                            onChange={(e) => setLimit(e.target.value)}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd" }}
                        >
                            <option value="10">10</option>
                            <option value="100">100</option>
                            <option value="500">500</option>
                            <option value="1000">1000</option>
                            <option value="No limit">No limit</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Editor */}
            <div style={{ height: 300 }}>
                <Editor
                    height="100%"
                    defaultLanguage="sql"
                    value={value}
                    onChange={(val) => {
                        setValue(val);
                        if (onChange) onChange(val);
                    }}
                    onMount={handleEditorDidMount}
                    options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 14,
                        lineNumbers: "on",
                        automaticLayout: true,
                        renderLineHighlight: "all",
                    }}
                />
            </div>
        </div>
    );
}
