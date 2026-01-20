import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';

const STORAGE_KEY_LIMIT = 'vps_sql_limit';
const STORAGE_KEY_HISTORY = 'vps_sql_history';
const STORAGE_KEY_AUTOLIMIT = 'vps_sql_autolimit';

function normalizeDialect(dialect) {
    if (dialect === "postgres") return "postgres";
    if (dialect === "sqlite") return "sqlite";
    return "mysql";
}

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

export default function SqlEditor({ defaultValue = "", onChange, onExecute, onExecuteAll, isLoading, dialect }) {
    const dbDialect = useMemo(() => normalizeDialect(dialect), [dialect]);
    const storageLimitKey = `${STORAGE_KEY_LIMIT}_${dbDialect}`;
    const storageHistoryKey = `${STORAGE_KEY_HISTORY}_${dbDialect}`;
    const storageAutoLimitKey = `${STORAGE_KEY_AUTOLIMIT}_${dbDialect}`;

    const [value, setValue] = useState(defaultValue);
    const [limit, setLimit] = useState(() => localStorage.getItem(storageLimitKey) || "1000");
    const [autoLimit, setAutoLimit] = useState(() => {
        const stored = localStorage.getItem(storageAutoLimitKey);
        if (stored === "true") return true;
        if (stored === "false") return false;
        // Postgres and SQLite support standard LIMIT
        return true; 
    });
    const [history, setHistory] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(storageHistoryKey) || "[]");
        } catch {
            return [];
        }
    });
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const executeRef = useRef(null);

    // Persist limit
    useEffect(() => {
        localStorage.setItem(storageLimitKey, limit);
    }, [limit, storageLimitKey]);

    // Persist autoLimit
    useEffect(() => {
        localStorage.setItem(storageAutoLimitKey, String(autoLimit));
    }, [autoLimit, storageAutoLimitKey]);

    // Persist history
    useEffect(() => {
        localStorage.setItem(storageHistoryKey, JSON.stringify(history));
    }, [history, storageHistoryKey]);

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
            executeRef.current?.();
        });
    };

    const getQueryWithLimit = (sql) => {
        if (!autoLimit) return sql;
        if (limit === "No limit") return sql;
        
        const limitVal = parseInt(limit, 10);
        if (isNaN(limitVal)) return sql;

        // Only append limit to SELECT queries
        const trimmedSql = sql.trim();
        if (!/^(SELECT|WITH)\b/i.test(trimmedSql)) {
            return sql;
        }

        // Simple check if LIMIT already exists (case insensitive)
        if (!/\bLIMIT\s+\d+/i.test(trimmedSql)) {
            if (trimmedSql.endsWith(';')) {
                return trimmedSql.slice(0, -1) + ` LIMIT ${limitVal};`;
            }
            return trimmedSql + ` LIMIT ${limitVal}`;
        }
        return sql;
    };

    const handleExecute = useCallback(() => {
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
    }, [onExecute, autoLimit, limit, dbDialect]);

    useEffect(() => {
        executeRef.current = handleExecute;
    }, [handleExecute]);

    const handleExecuteAll = useCallback(() => {
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
    }, [onExecute, onExecuteAll, autoLimit, limit, dbDialect]);

    const insertSnippet = (snippet) => {
        if (!editorRef.current) return;
        const model = editorRef.current.getModel();
        const currentVal = model.getValue();
        const newVal = currentVal ? currentVal + "\n\n" + snippet : snippet;
        editorRef.current.setValue(newVal);
        setValue(newVal);
        if (onChange) onChange(newVal);
    };

    const postgresSnippets = [
        {
            label: "List schemas",
            sql: "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;",
        },
        {
            label: "List tables (public)",
            sql: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
        },
        {
            label: "Describe table columns (replace table_name)",
            sql: "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'table_name' ORDER BY ordinal_position;",
        },
        {
            label: "List indexes (public)",
            sql: "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;",
        },
        {
            label: "Prisma migration status",
            sql: "SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY started_at DESC;",
        },
    ];

    const sqliteSnippets = [
        {
            label: "List tables",
            sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        },
        {
            label: "Describe table (replace table_name)",
            sql: "PRAGMA table_info('table_name');",
        },
        {
            label: "List indexes",
            sql: "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type='index';",
        },
        {
            label: "Prisma migration status",
            sql: "SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY started_at DESC;",
        },
    ];

    const handleExplainAnalyze = () => {
        if (!editorRef.current || !onExecute) return;
        const text = editorRef.current.getValue();
        if (!text.trim()) return;
        const explain = `EXPLAIN QUERY PLAN ${text.trim().replace(/;+\s*$/, "")};`;
        addToHistory(explain);
        onExecute(explain);
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

    const getSnippets = () => {
        if (dbDialect === "postgres") return postgresSnippets;
        if (dbDialect === "sqlite") return sqliteSnippets;
        return [];
    };

    const snippets = getSnippets();

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
                    {(dbDialect === "postgres" || dbDialect === "sqlite") && (
                        <button
                            onClick={handleExplainAnalyze}
                            disabled={isLoading}
                            title={dbDialect === "postgres" ? "EXPLAIN (ANALYZE, BUFFERS, VERBOSE)" : "EXPLAIN QUERY PLAN"}
                            style={{ background: "#673ab7", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: "0.9em" }}
                        >
                            Explain
                        </button>
                    )}
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

                    {snippets.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em", color: "#666" }}>
                            <label>Snippets:</label>
                            <select
                                onChange={(e) => {
                                    if (e.target.value === "") return;
                                    const idx = Number(e.target.value);
                                    if (!Number.isFinite(idx)) return;
                                    const snippet = snippets[idx];
                                    if (snippet?.sql) insertSnippet(snippet.sql);
                                    e.target.value = "";
                                }}
                                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", maxWidth: 180 }}
                            >
                                <option value="">Insert...</option>
                                {snippets.map((s, i) => (
                                    <option key={s.label} value={i}>{s.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9em", color: "#666" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="checkbox" checked={autoLimit} onChange={(e) => setAutoLimit(e.target.checked)} />
                            Auto LIMIT
                        </label>
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
