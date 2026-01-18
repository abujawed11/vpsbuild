import { useState, useEffect } from "react";
import { getToken } from "../lib/auth";
import { apiFetch } from "../lib/api";

// Reserved environment variable keys that are system-managed
const RESERVED_KEYS = ['PORT', 'NODE_ENV', 'HOST'];

// Runtime and Framework configurations for Backend
const BACKEND_RUNTIMES = {
    python: {
        label: "Python",
        icon: "🐍",
        frameworks: {
            fastapi: {
                label: "FastAPI",
                icon: "⚡",
                installCmd: "pip install -r requirements.txt",
                startCmd: (file) => `uvicorn ${file.replace('.py', '').replace(/\//g, '.')}:app --host 0.0.0.0 --port 8000`,
                defaultFile: "main.py",
                fileFilter: [".py"]
            },
            flask: {
                label: "Flask",
                icon: "🌶️",
                installCmd: "pip install -r requirements.txt",
                startCmd: (file) => `python ${file}`,
                defaultFile: "app.py",
                fileFilter: [".py"]
            },
            django: {
                label: "Django",
                icon: "🎸",
                installCmd: "pip install -r requirements.txt",
                startCmd: () => "python manage.py runserver 0.0.0.0:8000",
                defaultFile: "manage.py",
                fileFilter: [".py"]
            },
            plain: {
                label: "Plain Python",
                icon: "📄",
                installCmd: "pip install -r requirements.txt",
                startCmd: (file) => `python ${file}`,
                defaultFile: "main.py",
                fileFilter: [".py"]
            }
        }
    },
    nodejs: {
        label: "Node.js",
        icon: "🟢",
        frameworks: {
            express: {
                label: "Express",
                icon: "🚂",
                installCmd: "npm install",
                startCmd: (file) => `node ${file}`,
                defaultFile: "index.js",
                fileFilter: [".js", ".mjs", ".cjs"]
            },
            nestjs: {
                label: "NestJS",
                icon: "🐱",
                installCmd: "npm install",
                startCmd: () => "npm run start:prod",
                defaultFile: "dist/main.js",
                fileFilter: [".js", ".ts"]
            },
            fastify: {
                label: "Fastify",
                icon: "🚀",
                installCmd: "npm install",
                startCmd: (file) => `node ${file}`,
                defaultFile: "index.js",
                fileFilter: [".js", ".mjs"]
            },
            hono: {
                label: "Hono",
                icon: "🔥",
                installCmd: "npm install",
                startCmd: (file) => `node ${file}`,
                defaultFile: "index.js",
                fileFilter: [".js", ".ts"]
            },
            plain: {
                label: "Plain Node.js",
                icon: "📄",
                installCmd: "npm install",
                startCmd: (file) => `node ${file}`,
                defaultFile: "index.js",
                fileFilter: [".js", ".mjs", ".cjs"]
            }
        }
    },
    go: {
        label: "Go",
        icon: "🐹",
        frameworks: {
            gin: {
                label: "Gin",
                icon: "🍸",
                installCmd: "go mod download",
                startCmd: (file) => `go run ${file}`,
                defaultFile: "main.go",
                fileFilter: [".go"]
            },
            echo: {
                label: "Echo",
                icon: "📢",
                installCmd: "go mod download",
                startCmd: (file) => `go run ${file}`,
                defaultFile: "main.go",
                fileFilter: [".go"]
            },
            fiber: {
                label: "Fiber",
                icon: "⚡",
                installCmd: "go mod download",
                startCmd: (file) => `go run ${file}`,
                defaultFile: "main.go",
                fileFilter: [".go"]
            },
            plain: {
                label: "Plain Go",
                icon: "📄",
                installCmd: "go mod download",
                startCmd: (file) => `go run ${file}`,
                defaultFile: "main.go",
                fileFilter: [".go"]
            }
        }
    },
    bun: {
        label: "Bun",
        icon: "🥟",
        frameworks: {
            elysia: {
                label: "Elysia",
                icon: "🦊",
                installCmd: "bun install",
                startCmd: (file) => `bun run ${file}`,
                defaultFile: "src/index.ts",
                fileFilter: [".ts", ".js"]
            },
            hono: {
                label: "Hono",
                icon: "🔥",
                installCmd: "bun install",
                startCmd: (file) => `bun run ${file}`,
                defaultFile: "src/index.ts",
                fileFilter: [".ts", ".js"]
            },
            plain: {
                label: "Plain Bun",
                icon: "📄",
                installCmd: "bun install",
                startCmd: (file) => `bun run ${file}`,
                defaultFile: "index.ts",
                fileFilter: [".ts", ".js"]
            }
        }
    },
    deno: {
        label: "Deno",
        icon: "🦕",
        frameworks: {
            fresh: {
                label: "Fresh",
                icon: "🍋",
                installCmd: "",
                startCmd: () => "deno task start",
                defaultFile: "main.ts",
                fileFilter: [".ts", ".js"]
            },
            oak: {
                label: "Oak",
                icon: "🌳",
                installCmd: "",
                startCmd: (file) => `deno run --allow-net ${file}`,
                defaultFile: "main.ts",
                fileFilter: [".ts", ".js"]
            },
            plain: {
                label: "Plain Deno",
                icon: "📄",
                installCmd: "",
                startCmd: (file) => `deno run --allow-net ${file}`,
                defaultFile: "main.ts",
                fileFilter: [".ts", ".js"]
            }
        }
    },
    ruby: {
        label: "Ruby",
        icon: "💎",
        frameworks: {
            rails: {
                label: "Rails",
                icon: "🛤️",
                installCmd: "bundle install",
                startCmd: () => "rails server -b 0.0.0.0 -p 3000",
                defaultFile: "config.ru",
                fileFilter: [".rb"]
            },
            sinatra: {
                label: "Sinatra",
                icon: "🎤",
                installCmd: "bundle install",
                startCmd: (file) => `ruby ${file}`,
                defaultFile: "app.rb",
                fileFilter: [".rb"]
            },
            plain: {
                label: "Plain Ruby",
                icon: "📄",
                installCmd: "bundle install",
                startCmd: (file) => `ruby ${file}`,
                defaultFile: "main.rb",
                fileFilter: [".rb"]
            }
        }
    },
    php: {
        label: "PHP",
        icon: "🐘",
        frameworks: {
            laravel: {
                label: "Laravel",
                icon: "🔺",
                installCmd: "composer install",
                startCmd: () => "php artisan serve --host 0.0.0.0 --port 8000",
                defaultFile: "artisan",
                fileFilter: [".php"]
            },
            plain: {
                label: "Plain PHP",
                icon: "📄",
                installCmd: "composer install",
                startCmd: () => "php -S 0.0.0.0:8000",
                defaultFile: "index.php",
                fileFilter: [".php"]
            }
        }
    },
    rust: {
        label: "Rust",
        icon: "🦀",
        frameworks: {
            actix: {
                label: "Actix Web",
                icon: "🎭",
                installCmd: "cargo build --release",
                startCmd: () => "cargo run --release",
                defaultFile: "src/main.rs",
                fileFilter: [".rs"]
            },
            axum: {
                label: "Axum",
                icon: "🪓",
                installCmd: "cargo build --release",
                startCmd: () => "cargo run --release",
                defaultFile: "src/main.rs",
                fileFilter: [".rs"]
            },
            plain: {
                label: "Plain Rust",
                icon: "📄",
                installCmd: "cargo build --release",
                startCmd: () => "cargo run --release",
                defaultFile: "src/main.rs",
                fileFilter: [".rs"]
            }
        }
    }
};

// Frontend Framework configurations
const FRONTEND_FRAMEWORKS = {
    react_vite: {
        label: "React (Vite)",
        icon: "⚛️",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "dist"
    },
    react_cra: {
        label: "React (CRA)",
        icon: "⚛️",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "build"
    },
    nextjs: {
        label: "Next.js (Static)",
        icon: "▲",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "out"
    },
    vue: {
        label: "Vue",
        icon: "💚",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "dist"
    },
    nuxt: {
        label: "Nuxt (Static)",
        icon: "💚",
        installCmd: "npm install",
        buildCmd: "npm run generate",
        outputDir: ".output/public"
    },
    svelte: {
        label: "Svelte/SvelteKit",
        icon: "🔶",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "build"
    },
    angular: {
        label: "Angular",
        icon: "🅰️",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "dist"
    },
    astro: {
        label: "Astro",
        icon: "🚀",
        installCmd: "npm install",
        buildCmd: "npm run build",
        outputDir: "dist"
    },
    html: {
        label: "Plain HTML",
        icon: "📄",
        installCmd: "",
        buildCmd: "",
        outputDir: "."
    }
};

export default function DeploymentWizard({ onComplete, onCancel, groupId, role, groupSlug }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [envError, setEnvError] = useState("");

    const baseDomain = import.meta.env.VITE_BASE_DOMAIN || "localhost";
    const basePort = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : "";
    const baseUrl = `http://${baseDomain}${basePort}`;

    // Step 1: Choose Source Type
    const [sourceType, setSourceType] = useState(""); // "github" or "zip"

    // Step 2: Create Site
    // Pre-fill name with groupSlug + role to ensure uniqueness (e.g., "mypr Frontend")
    const [siteName, setSiteName] = useState(
        role ? `${groupSlug || ''} ${role === "FRONTEND" ? "Frontend" : "Backend"}`.trim() : ""
    );
    // When role is provided, we don't need a custom slug - it's derived from groupSlug + role
    const [siteSlug, setSiteSlug] = useState("");
    // When role is provided, site type is pre-determined (FRONTEND -> static, BACKEND -> server)
    const [siteType, setSiteType] = useState(role === "BACKEND" ? "server" : "static");

    // Step 3a: GitHub Source
    const [repos, setRepos] = useState([]);
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [branches, setBranches] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState("");

    // Step 3b: ZIP Upload Source
    const [uploadedFile, setUploadedFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Step 3: Select Root
    const [projectId, setProjectId] = useState(null);
    const [projectData, setProjectData] = useState(null);
    const [folderTree, setFolderTree] = useState(null);
    const [selectedRoot, setSelectedRoot] = useState("/");

    // Step 4: Build Settings
    const [buildSettings, setBuildSettings] = useState({
        packageManager: "npm",
        buildCommand: "",
        outputDir: "dist",
        spaRouting: true,
        // Server-specific settings
        startCommand: "",
        installCommand: ""
    });

    // Backend runtime/framework selection
    const [selectedRuntime, setSelectedRuntime] = useState("");
    const [selectedFramework, setSelectedFramework] = useState("");
    const [entryFile, setEntryFile] = useState("");
    const [projectFiles, setProjectFiles] = useState([]);
    const [showFilePicker, setShowFilePicker] = useState(false);
    const [useCustomCommand, setUseCustomCommand] = useState(false);

    // Frontend framework selection
    const [selectedFrontendFramework, setSelectedFrontendFramework] = useState("");

    // Step 5: Env Vars
    const [envVars, setEnvVars] = useState([]);
    const [newEnv, setNewEnv] = useState({ key: "", value: "" });
    const [envMode, setEnvMode] = useState("manual"); // "manual", "paste", "upload"
    const [pasteText, setPasteText] = useState("");
    const [editingEnvIndex, setEditingEnvIndex] = useState(null);
    const [editingEnvField, setEditingEnvField] = useState(null); // "key" or "value"

    // Step 6: Deploy
    const [deployment, setDeployment] = useState(null);
    const [logs, setLogs] = useState("");

    // Effects
    useEffect(() => {
        if (siteName && step === 2) {
            // When role is provided, slug is handled by backend (groupSlug-role)
            // Only set siteSlug for legacy standalone projects
            if (!role) {
                setSiteSlug(siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50));
            }
        }
    }, [siteName, step, role]);

    const fetchRepos = async () => {
        setLoading(true);
        try {
            const data = await apiFetch("/github/repos", { token: getToken() });
            setRepos(data.repos);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const fetchBranches = async (repo) => {
        setLoading(true);
        try {
            const data = await apiFetch(`/github/branches?repo=${repo.full_name}`, { token: getToken() });
            setBranches(data.branches);
            setSelectedBranch(repo.default_branch || data.branches[0]?.name);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const createProject = async () => {
        setLoading(true);
        try {
            // For role-based deployment, use POST /projects which handles role + groupId
            // For legacy, use POST /projects/import
            const endpoint = role ? "/projects" : "/projects/import";
            const body = role
                ? {
                    repoFullName: selectedRepo.full_name,
                    branch: selectedBranch,
                    name: siteName,
                    groupId,
                    role
                }
                : {
                    repoFullName: selectedRepo.full_name,
                    branch: selectedBranch,
                    name: siteName,
                    slug: siteSlug,
                    groupId
                };

            const res = await apiFetch(endpoint, {
                method: "POST",
                token: getToken(),
                body
            });
            setProjectId(res.project.id);
            setProjectData(res.project);

            // Clone and analyze
            await apiFetch("/projects/clone", { method: "POST", token: getToken(), body: { projectId: res.project.id } });
            const treeData = await apiFetch(`/projects/${res.project.id}/tree`, { token: getToken() });
            setFolderTree(treeData.tree);
            setStep(4);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const createProjectWithZip = async () => {
        if (!uploadedFile) return;

        setLoading(true);
        try {
            // Create project first
            const body = {
                name: siteName,
                groupId,
                repoFullName: "uploaded-zip",
                branch: "main"
            };
            // Add role if provided, otherwise add slug for legacy flow
            if (role) {
                body.role = role;
            } else {
                body.slug = siteSlug;
            }

            const res = await apiFetch("/projects", {
                method: "POST",
                token: getToken(),
                body
            });

            setProjectId(res.project.id);
            setProjectData(res.project);

            // Upload ZIP file
            const formData = new FormData();
            formData.append("file", uploadedFile);

            const xhr = new XMLHttpRequest();

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    setUploadProgress(percent);
                }
            };

            xhr.onload = async () => {
                if (xhr.status === 200) {
                    setUploadProgress(100);
                    // Get folder tree
                    const treeData = await apiFetch(`/projects/${res.project.id}/tree`, { token: getToken() });
                    setFolderTree(treeData.tree);
                    setStep(4);
                    setLoading(false);
                } else {
                    let message = `Upload failed (${xhr.status})`;
                    try {
                        const parsed = JSON.parse(xhr.responseText || "{}");
                        if (parsed?.error) message = parsed.error;
                    } catch {}
                    alert(message);
                    setLoading(false);
                }
            };

            xhr.onerror = () => {
                alert("Upload failed");
                setLoading(false);
            };

            xhr.open("POST", `/api/projects/${res.project.id}/upload-zip`);
            xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
            xhr.send(formData);

        } catch (e) {
            alert(e.message);
            setLoading(false);
        }
    };

    const detectSettings = async (path) => {
        setLoading(true);
        try {
            // Update project with rootDir first
            await apiFetch(`/projects/${projectId}`, {
                method: "PATCH",
                token: getToken(),
                body: { rootDir: path }
            });

            // Set deployType based on selection
            const deployType = siteType === "server" ? "BACKEND" : "FRONTEND";
            await apiFetch(`/projects/${projectId}/deploy-type`, {
                method: "POST",
                token: getToken(),
                body: { deployType }
            });

            const res = await apiFetch("/projects/analyze", {
                method: "POST",
                token: getToken(),
                body: { projectId }
            });

            if (siteType === "server") {
                // Server settings - use auto-detection with new UI
                setBuildSettings(prev => ({
                    ...prev,
                    packageManager: res.project.packageManager || "npm",
                    startCommand: res.project.startCommand || "",
                    installCommand: res.project.buildCommand || "",
                    buildCommand: res.project.buildCommand || ""
                }));

                // Auto-detect runtime and framework for the new UI
                autoDetectFromAnalysis(res.project);
            } else {
                // Static site settings - use auto-detection with new UI
                setBuildSettings(prev => ({
                    ...prev,
                    packageManager: res.project.packageManager || "npm",
                    buildCommand: res.project.buildCommand || "",
                    outputDir: res.project.outputDir || "dist",
                    installCommand: "npm install",
                    spaRouting: true
                }));

                // Auto-detect frontend framework
                autoDetectFromAnalysis(res.project);
            }
            setStep(5);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const saveSettings = async () => {
        setLoading(true);
        try {
            const updateData = siteType === "server"
                ? {
                    packageManager: buildSettings.packageManager,
                    startCommand: buildSettings.startCommand,
                    // For servers, installCommand maps to buildCommand in the API
                    buildCommand: buildSettings.installCommand || buildSettings.buildCommand
                }
                : {
                    packageManager: buildSettings.packageManager,
                    buildCommand: buildSettings.buildCommand,
                    outputDir: buildSettings.outputDir
                };

            await apiFetch(`/projects/${projectId}`, {
                method: "PATCH",
                token: getToken(),
                body: updateData
            });
            setStep(6);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const startDeploy = async () => {
        // Validate env vars for reserved keys before deploying
        const hasReservedKey = envVars.some(v =>
            RESERVED_KEYS.includes(v.key.trim().toUpperCase())
        );

        if (hasReservedKey) {
            const reservedFound = envVars.find(v => RESERVED_KEYS.includes(v.key.trim().toUpperCase()));
            setEnvError(`Cannot deploy: "${reservedFound.key}" is a reserved system variable. Please remove PORT, NODE_ENV, and HOST from your environment variables.`);
            return;
        }

        setEnvError("");
        setLoading(true);
        try {
            // Save environment variables first
            await apiFetch(`/projects/${projectId}/env-vars/bulk`, {
                method: "POST",
                token: getToken(),
                body: { envVars }
            });

            // Then start deployment
            const res = await apiFetch(`/deployments/${projectId}`, {
                method: "POST",
                token: getToken()
            });
            setDeployment({ id: res.deploymentId, status: "QUEUED" });
            setStep(7);
            pollLogs(res.deploymentId);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const pollLogs = (id) => {
        const interval = setInterval(async () => {
            try {
                const res = await apiFetch(`/deployments/status/${id}`, { token: getToken() });
                setLogs(res.logs);
                setDeployment(res);
                if (res.status === "DEPLOYED" || res.status === "FAILED") {
                    clearInterval(interval);
                }
            } catch (e) { clearInterval(interval); }
        }, 2000);
    };

    // Fetch files for entry file picker (recursive to get all files)
    const fetchProjectFiles = async (runtime) => {
        if (!projectId) return;
        try {
            const runtimeConfig = BACKEND_RUNTIMES[runtime];
            if (!runtimeConfig) return;

            // Get file extensions for the selected runtime
            const allExtensions = new Set();
            Object.values(runtimeConfig.frameworks).forEach(fw => {
                fw.fileFilter.forEach(ext => allExtensions.add(ext));
            });

            // Recursively fetch files from all directories
            const allFiles = [];
            const fetchDir = async (dirPath) => {
                const res = await apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`, { token: getToken() });
                if (res.items) {
                    for (const item of res.items) {
                        if (item.type === "folder" && !item.name.startsWith(".") && item.name !== "node_modules" && item.name !== "__pycache__" && item.name !== "venv" && item.name !== ".git") {
                            // Recurse into subdirectories (limit depth to avoid too many requests)
                            if (item.path.split("/").length <= 3) {
                                await fetchDir(item.path);
                            }
                        } else if (item.type === "file") {
                            // Check if file matches our extensions
                            if (Array.from(allExtensions).some(ext => item.name.endsWith(ext))) {
                                allFiles.push(item);
                            }
                        }
                    }
                }
            };

            await fetchDir(selectedRoot === "/" ? "" : selectedRoot);
            setProjectFiles(allFiles);
        } catch (e) {
            console.error("Failed to fetch files:", e);
            setProjectFiles([]);
        }
    };

    // Generate commands based on runtime, framework, and entry file
    const generateCommands = (runtime, framework, file) => {
        if (!runtime || !framework) return { installCmd: "", startCmd: "" };

        const runtimeConfig = BACKEND_RUNTIMES[runtime];
        const frameworkConfig = runtimeConfig?.frameworks[framework];

        if (!frameworkConfig) return { installCmd: "", startCmd: "" };

        const installCmd = frameworkConfig.installCmd || "";
        const startCmd = typeof frameworkConfig.startCmd === "function"
            ? frameworkConfig.startCmd(file || frameworkConfig.defaultFile)
            : frameworkConfig.startCmd;

        return { installCmd, startCmd };
    };

    // Handle runtime change
    const handleRuntimeChange = (runtime) => {
        setSelectedRuntime(runtime);
        setSelectedFramework("");
        setEntryFile("");
        setProjectFiles([]);
        setUseCustomCommand(false);

        // Fetch files for this runtime
        if (runtime) {
            fetchProjectFiles(runtime);
        }
    };

    // Handle framework change
    const handleFrameworkChange = (framework) => {
        setSelectedFramework(framework);

        if (selectedRuntime && framework) {
            const frameworkConfig = BACKEND_RUNTIMES[selectedRuntime]?.frameworks[framework];
            if (frameworkConfig) {
                setEntryFile(frameworkConfig.defaultFile);
                const { installCmd, startCmd } = generateCommands(selectedRuntime, framework, frameworkConfig.defaultFile);
                setBuildSettings(prev => ({
                    ...prev,
                    installCommand: installCmd,
                    startCommand: startCmd
                }));
            }
        }
    };

    // Handle entry file change
    const handleEntryFileChange = (file) => {
        setEntryFile(file);
        setShowFilePicker(false);

        if (selectedRuntime && selectedFramework) {
            const { installCmd, startCmd } = generateCommands(selectedRuntime, selectedFramework, file);
            setBuildSettings(prev => ({
                ...prev,
                installCommand: installCmd,
                startCommand: startCmd
            }));
        }
    };

    // Handle frontend framework change
    const handleFrontendFrameworkChange = (framework) => {
        setSelectedFrontendFramework(framework);
        const config = FRONTEND_FRAMEWORKS[framework];
        if (config) {
            setBuildSettings(prev => ({
                ...prev,
                buildCommand: config.buildCmd,
                outputDir: config.outputDir,
                installCommand: config.installCmd
            }));
        }
    };

    // Auto-detect runtime and framework from project analysis
    const autoDetectFromAnalysis = (analysisResult) => {
        const { runtime, framework } = analysisResult;

        // Map backend analyzer results to our config keys
        const runtimeMap = {
            "node": "nodejs",
            "python": "python",
            "go": "go",
            "bun": "bun",
            "deno": "deno",
            "ruby": "ruby",
            "php": "php",
            "rust": "rust"
        };

        const frameworkMap = {
            "express": "express",
            "fastify": "fastify",
            "nestjs": "nestjs",
            "hono": "hono",
            "fastapi": "fastapi",
            "flask": "flask",
            "django": "django",
            "gin": "gin",
            "echo": "echo",
            "fiber": "fiber",
            "elysia": "elysia",
            "rails": "rails",
            "sinatra": "sinatra",
            "laravel": "laravel",
            "actix": "actix",
            "axum": "axum"
        };

        const frontendFrameworkMap = {
            "react": "react_vite",
            "vue": "vue",
            "svelte": "svelte",
            "angular": "angular",
            "next": "nextjs",
            "nuxt": "nuxt",
            "astro": "astro"
        };

        if (siteType === "server") {
            const detectedRuntime = runtimeMap[runtime?.toLowerCase()] || "";
            const detectedFramework = frameworkMap[framework?.toLowerCase()] || "plain";

            if (detectedRuntime) {
                setSelectedRuntime(detectedRuntime);
                fetchProjectFiles(detectedRuntime);

                if (detectedFramework && BACKEND_RUNTIMES[detectedRuntime]?.frameworks[detectedFramework]) {
                    setSelectedFramework(detectedFramework);
                    const fwConfig = BACKEND_RUNTIMES[detectedRuntime].frameworks[detectedFramework];
                    setEntryFile(fwConfig.defaultFile);
                }
            }
        } else {
            // Frontend framework detection
            const detectedFrontend = frontendFrameworkMap[framework?.toLowerCase()] || "react_vite";
            setSelectedFrontendFramework(detectedFrontend);
        }
    };

    // Auto-scroll logs
    const logContainerRef = useState(null); // Ref pattern with state for callback? No, standard useRef.
    // Actually, let's just use an ID or a proper ref.
    // Since I can't easily change imports to add useRef without replacing the top, 
    // I'll use a callback ref or just document.getElementById (simplest for this replacement).
    
    useEffect(() => {
        const el = document.getElementById("log-container");
        if (el) el.scrollTop = el.scrollHeight;
    }, [logs]);

    const addEnvVar = () => {
        if (!newEnv.key) return;

        // Check for reserved keys (case-insensitive)
        if (RESERVED_KEYS.includes(newEnv.key.trim().toUpperCase())) {
            setEnvError(`"${newEnv.key}" is a reserved system variable (PORT, NODE_ENV, HOST) and cannot be set manually.`);
            return;
        }

        setEnvError("");
        setEnvVars([...envVars, newEnv]);
        setNewEnv({ key: "", value: "" });
    };

    const handleEnvFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            const newVars = [];
            const lines = content.split('\n');
            
            lines.forEach(line => {
                line = line.trim();
                if (!line || line.startsWith('#')) return;
                
                const splitIndex = line.indexOf('=');
                if (splitIndex === -1) return;
                
                const key = line.substring(0, splitIndex).trim();
                let value = line.substring(splitIndex + 1).trim();

                // Remove surrounding quotes
                if ((value.startsWith('"') && value.endsWith('"')) || 
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                if (key) {
                    newVars.push({ key, value });
                }
            });

            if (newVars.length > 0) {
                // Filter out reserved keys and existing keys
                const existingKeys = new Set(envVars.map(ev => ev.key));
                const reservedFiltered = newVars.filter(ev => !RESERVED_KEYS.includes(ev.key.trim().toUpperCase()));
                const uniqueNewVars = reservedFiltered.filter(ev => !existingKeys.has(ev.key));

                const reservedCount = newVars.length - reservedFiltered.length;

                setEnvVars([...envVars, ...uniqueNewVars]);

                let message = `Imported ${uniqueNewVars.length} variables.`;
                if (reservedCount > 0) {
                    message += ` (${reservedCount} reserved variables like PORT, NODE_ENV, HOST were skipped)`;
                }
                alert(message);
            }
        };
        reader.readAsText(file);
        e.target.value = null;
    };

    const handlePasteText = () => {
        if (!pasteText.trim()) return;

        const newVars = [];
        const lines = pasteText.split('\n');

        lines.forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;

            const splitIndex = line.indexOf('=');
            if (splitIndex === -1) return;

            const key = line.substring(0, splitIndex).trim();
            let value = line.substring(splitIndex + 1).trim();

            // Remove surrounding quotes
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (key) {
                newVars.push({ key, value });
            }
        });

        if (newVars.length > 0) {
            // Filter out reserved keys and existing keys
            const existingKeys = new Set(envVars.map(ev => ev.key));
            const reservedFiltered = newVars.filter(ev => !RESERVED_KEYS.includes(ev.key.trim().toUpperCase()));
            const uniqueNewVars = reservedFiltered.filter(ev => !existingKeys.has(ev.key));

            const reservedCount = newVars.length - reservedFiltered.length;
            const duplicateCount = reservedFiltered.length - uniqueNewVars.length;

            setEnvVars([...envVars, ...uniqueNewVars]);
            setPasteText("");

            let message = `Added ${uniqueNewVars.length} variables.`;
            if (duplicateCount > 0) {
                message += ` (${duplicateCount} duplicates skipped)`;
            }
            if (reservedCount > 0) {
                message += ` ${duplicateCount > 0 ? '&' : '('} ${reservedCount} reserved variables like PORT, NODE_ENV, HOST were skipped${duplicateCount === 0 ? ')' : ''}`;
            }
            alert(message);
        } else {
            alert("No valid environment variables found in pasted text.");
        }
    };

    const handleEnvEdit = (index, field, newValue) => {
        const updated = [...envVars];
        updated[index][field] = newValue;
        setEnvVars(updated);
        setEditingEnvIndex(null);
        setEditingEnvField(null);
    };

    // For role-based deployments, we skip step 2, so adjust step display
    // Mapping: actual step -> display step (for role-based)
    // 1->1, 3->2, 4->3, 5->4, 6->5, 7->6
    const getDisplayStep = (actualStep) => {
        if (!role) return actualStep;
        if (actualStep === 1) return 1;
        if (actualStep >= 3) return actualStep - 1;
        return actualStep;
    };
    const totalSteps = role ? 6 : 7;
    const displayStep = getDisplayStep(step);

    return (
        <div style={{ background: "white", padding: 30, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 30 }}>
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
                    <div key={s} style={{
                        height: 6, flex: 1,
                        background: displayStep >= s ? "#2196F3" : "#e0e0e0",
                        borderRadius: 3,
                        transition: "background 0.3s ease"
                    }} />
                ))}
            </div>

            {step === 1 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 1: Choose Source</h3>
                    <p style={stepDesc}>How do you want to deploy your site?</p>

                    <div style={{ display: "flex", gap: 15, marginBottom: 25 }}>
                        <button
                            onClick={() => {
                                setSourceType("github");
                                // Skip step 2 for role-based deployments (name is auto-generated)
                                if (role) {
                                    fetchRepos();
                                    setStep(3);
                                } else {
                                    setStep(2);
                                }
                            }}
                            style={{
                                flex: 1, padding: 25, borderRadius: 12, border: "2px solid #ddd",
                                background: "white", cursor: "pointer", textAlign: "center", transition: "all 0.2s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = "#2196F3"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#ddd"}
                        >
                            <div style={{ fontSize: "2em", marginBottom: 10 }}>🔗</div>
                            <strong style={{ display: "block", marginBottom: 5 }}>Deploy from GitHub</strong>
                            <div style={{ fontSize: "0.85em", color: "#666" }}>Connect your repository and auto-deploy</div>
                        </button>

                        <button
                            onClick={() => {
                                setSourceType("zip");
                                // Skip step 2 for role-based deployments (name is auto-generated)
                                setStep(role ? 3 : 2);
                            }}
                            style={{
                                flex: 1, padding: 25, borderRadius: 12, border: "2px solid #ddd",
                                background: "white", cursor: "pointer", textAlign: "center", transition: "all 0.2s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = "#2196F3"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#ddd"}
                        >
                            <div style={{ fontSize: "2em", marginBottom: 10 }}>📦</div>
                            <strong style={{ display: "block", marginBottom: 5 }}>Upload ZIP File</strong>
                            <div style={{ fontSize: "0.85em", color: "#666" }}>Upload your project directly (max 100MB)</div>
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 2: {role ? `Configure ${role === "FRONTEND" ? "Frontend" : "Backend"}` : "Name Your Site"}</h3>
                    <p style={stepDesc}>
                        {role
                            ? `Give your ${role.toLowerCase()} a name for identification.`
                            : "Give your project a name. We'll generate a unique URL for it."
                        }
                    </p>

                    {/* Only show project type selector when role is NOT provided (legacy flow) */}
                    {!role && (
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>Project Type</label>
                            <div style={{ display: "flex", gap: 10 }}>
                                 <button
                                    onClick={() => setSiteType("static")}
                                    style={{
                                        flex: 1, padding: 15, borderRadius: 8, border: siteType === "static" ? "2px solid #2196F3" : "1px solid #ddd",
                                        background: siteType === "static" ? "#e3f2fd" : "white", cursor: "pointer", textAlign: "center"
                                    }}
                                 >
                                    <strong>Static Website</strong>
                                    <div style={{ fontSize: "0.8em", color: "#666" }}>React, Vue, Static HTML</div>
                                 </button>
                                 <button
                                    onClick={() => setSiteType("server")}
                                    style={{
                                        flex: 1, padding: 15, borderRadius: 8, border: siteType === "server" ? "2px solid #2196F3" : "1px solid #ddd",
                                        background: siteType === "server" ? "#e3f2fd" : "white", cursor: "pointer", textAlign: "center"
                                    }}
                                 >
                                    <strong>Host Server</strong>
                                    <div style={{ fontSize: "0.8em", color: "#666" }}>Node.js, Python, Docker</div>
                                 </button>
                            </div>
                        </div>
                    )}

                    {/* Show pre-selected type info when role is provided */}
                    {role && (
                        <div style={{ marginBottom: 20, padding: 12, background: "#e3f2fd", borderRadius: 8, border: "1px solid #bbdefb" }}>
                            <span style={{ color: "#1565c0", fontWeight: 500 }}>
                                {role === "FRONTEND" ? "🌐 Frontend (Static Website)" : "⚙️ Backend (Server Application)"}
                            </span>
                        </div>
                    )}

                    <div style={{ marginBottom: 20 }}>
                        <label style={labelStyle}>
                            {role ? `${role === "FRONTEND" ? "Frontend" : "Backend"} Name` : "Site Name"}
                            {role && <span style={{ fontWeight: 400, color: "#888", marginLeft: 5 }}>(for identification)</span>}
                        </label>
                        <input
                            value={siteName}
                            onChange={e => setSiteName(e.target.value)}
                            placeholder={role ? `${role === "FRONTEND" ? "Frontend" : "Backend"}` : "My Awesome Site"}
                            style={inputStyle}
                            autoFocus
                        />
                        {role && (
                            <small style={{ color: "#666", fontSize: "0.85em", display: "block", marginTop: 5 }}>
                                This name is only used internally for identification. It won't affect your URL.
                            </small>
                        )}
                    </div>

                    {/* Only show URL/slug input when role is NOT provided (legacy flow) */}
                    {!role && (
                        <div style={{ marginBottom: 25 }}>
                            <label style={labelStyle}>Site URL</label>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f5f5f5", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd" }}>
                                <span style={{ color: "#888" }}>http://</span>
                                <input
                                    value={siteSlug}
                                    onChange={e => setSiteSlug(e.target.value)}
                                    style={{ ...inputStyle, border: "none", background: "transparent", padding: 0, fontWeight: 500 }}
                                />
                                <span style={{ color: "#888" }}>.{baseDomain}{basePort}</span>
                            </div>
                        </div>
                    )}

                    {/* Show project URL info when role is provided */}
                    {role && groupSlug && (
                        <div style={{ marginBottom: 25, padding: 12, background: "#f5f5f5", borderRadius: 8, border: "1px solid #ddd" }}>
                            <label style={{ ...labelStyle, marginBottom: 8 }}>Accessible At</label>
                            <div style={{ fontFamily: "monospace", fontSize: "0.95em" }}>
                                <a href={`http://${groupSlug}.${baseDomain}${basePort}${role === "BACKEND" ? "/api" : ""}`}
                                   target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none" }}>
                                    {groupSlug}.{baseDomain}{basePort}{role === "BACKEND" ? "/api/*" : "/"}
                                </a>
                            </div>
                            <div style={{ marginTop: 8, fontSize: "0.8em", color: "#666" }}>
                                {role === "FRONTEND"
                                    ? "Your frontend will be served at the root of your project URL."
                                    : "Your backend API will be accessible via the /api path prefix."
                                }
                            </div>
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(1)} style={secondaryBtn}>← Back</button>
                        <button
                            onClick={() => {
                                if (sourceType === "github") {
                                    fetchRepos();
                                }
                                setStep(3);
                            }}
                            disabled={!siteName || (!role && !siteSlug)}
                            style={primaryBtn}
                        >
                            Next: {sourceType === "github" ? "Choose Repository" : "Upload Files"} →
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && sourceType === "github" && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 2 : 3}: Choose Repository</h3>
                    <p style={stepDesc}>Select a GitHub repository to deploy.</p>
                    {loading ? <p>Loading repos...</p> : (
                        <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 20 }}>
                            {repos.map(r => (
                                <div key={r.id} onClick={() => { setSelectedRepo(r); fetchBranches(r); }} style={{ 
                                    padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
                                    background: selectedRepo?.id === r.id ? "#e3f2fd" : "white",
                                    display: "flex", justifyContent: "space-between", alignItems: "center"
                                }}>
                                    <span style={{ fontWeight: 500 }}>{r.full_name}</span>
                                    {r.private && <span style={{ fontSize: "0.7em", background: "#eee", padding: "2px 6px", borderRadius: 4 }}>PRIVATE</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {selectedRepo && (
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>Select Branch</label>
                            <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={inputStyle}>
                                {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(role ? 1 : 2)} style={secondaryBtn}>← Back</button>
                        <button onClick={createProject} disabled={!selectedBranch || loading} style={primaryBtn}>
                            {loading ? "Initializing..." : "Next: Select Root →"}
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && sourceType === "zip" && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 2 : 3}: Upload ZIP File</h3>
                    <p style={stepDesc}>Upload your project as a ZIP file (max 100MB)</p>

                    <div
                        style={{
                            border: "2px dashed #2196F3",
                            borderRadius: 12,
                            padding: 40,
                            textAlign: "center",
                            background: "#f5f9ff",
                            marginBottom: 20,
                            cursor: "pointer"
                        }}
                        onClick={() => document.getElementById("zipInput").click()}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = "#e3f2fd"; }}
                        onDragLeave={(e) => { e.currentTarget.style.background = "#f5f9ff"; }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.style.background = "#f5f9ff";
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith(".zip")) {
                                setUploadedFile(file);
                            } else {
                                alert("Please upload a ZIP file");
                            }
                        }}
                    >
                        <input
                            id="zipInput"
                            type="file"
                            accept=".zip"
                            style={{ display: "none" }}
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) setUploadedFile(file);
                            }}
                        />
                        {uploadedFile ? (
                            <div>
                                <div style={{ fontSize: "2em", marginBottom: 10 }}>✅</div>
                                <strong>{uploadedFile.name}</strong>
                                <div style={{ color: "#666", fontSize: "0.9em", marginTop: 5 }}>
                                    {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                                    style={{ marginTop: 10, padding: "5px 15px", cursor: "pointer" }}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: "3em", marginBottom: 10 }}>📦</div>
                                <strong>Click to browse or drag & drop</strong>
                                <div style={{ color: "#666", fontSize: "0.9em", marginTop: 5 }}>
                                    ZIP files only • Max 100MB
                                </div>
                            </div>
                        )}
                    </div>

                    {uploadProgress > 0 && uploadProgress < 100 && (
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ background: "#e0e0e0", borderRadius: 8, height: 8, overflow: "hidden" }}>
                                <div style={{ background: "#2196F3", height: "100%", width: `${uploadProgress}%`, transition: "width 0.3s" }} />
                            </div>
                            <div style={{ textAlign: "center", marginTop: 5, fontSize: "0.9em", color: "#666" }}>
                                Uploading... {uploadProgress}%
                            </div>
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(role ? 1 : 2)} style={secondaryBtn}>← Back</button>
                        <button onClick={createProjectWithZip} disabled={!uploadedFile || loading} style={primaryBtn}>
                            {loading ? "Uploading..." : "Next: Select Root →"}
                        </button>
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 3 : 4}: Select Root Folder</h3>
                    <p style={stepDesc}>Where does your {role === "BACKEND" ? "backend" : "frontend"} code live? (Usually root or a subfolder)</p>
                    <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, maxHeight: 300, overflowY: "auto", marginBottom: 20, background: "#fafafa" }}>
                        {folderTree && <SimpleFolderTree tree={folderTree} onSelect={setSelectedRoot} selected={selectedRoot} />}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#e3f2fd", padding: 10, borderRadius: 6, marginBottom: 20 }}>
                        <span style={{ fontSize: "0.9em", color: "#1565c0" }}>Selected: <b>{selectedRoot}</b></span>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(3)} style={secondaryBtn}>← Back</button>
                        <button onClick={() => detectSettings(selectedRoot)} disabled={loading} style={primaryBtn}>
                            {loading ? "Detecting..." : "Next: Build Settings →"}
                        </button>
                    </div>
                </div>
            )}

            {step === 5 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 4 : 5}: {siteType === "server" ? "Server Settings" : "Build Settings"}</h3>
                    <p style={stepDesc}>
                        {siteType === "server"
                            ? "Select your runtime and framework to auto-configure deployment."
                            : "Select your framework to auto-configure build settings."
                        }
                    </p>

                    {siteType === "server" ? (
                        /* ========== BACKEND SERVER SETTINGS ========== */
                        <div style={{ display: "grid", gap: 20, marginBottom: 25 }}>
                            {/* Runtime Selection */}
                            <div>
                                <label style={labelStyle}>Runtime</label>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {Object.entries(BACKEND_RUNTIMES).map(([key, runtime]) => (
                                        <button
                                            key={key}
                                            onClick={() => handleRuntimeChange(key)}
                                            style={{
                                                padding: "10px 16px",
                                                borderRadius: 8,
                                                border: selectedRuntime === key ? "2px solid #2196F3" : "1px solid #ddd",
                                                background: selectedRuntime === key ? "#e3f2fd" : "white",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                fontSize: "0.9em",
                                                fontWeight: selectedRuntime === key ? 600 : 400,
                                                transition: "all 0.2s"
                                            }}
                                        >
                                            <span>{runtime.icon}</span>
                                            <span>{runtime.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Framework Selection (shown after runtime is selected) */}
                            {selectedRuntime && (
                                <div>
                                    <label style={labelStyle}>Framework</label>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                        {Object.entries(BACKEND_RUNTIMES[selectedRuntime].frameworks).map(([key, fw]) => (
                                            <button
                                                key={key}
                                                onClick={() => handleFrameworkChange(key)}
                                                style={{
                                                    padding: "10px 16px",
                                                    borderRadius: 8,
                                                    border: selectedFramework === key ? "2px solid #2196F3" : "1px solid #ddd",
                                                    background: selectedFramework === key ? "#e3f2fd" : "white",
                                                    cursor: "pointer",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    fontSize: "0.9em",
                                                    fontWeight: selectedFramework === key ? 600 : 400,
                                                    transition: "all 0.2s"
                                                }}
                                            >
                                                <span>{fw.icon}</span>
                                                <span>{fw.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Entry File Selection (shown after framework is selected) */}
                            {selectedRuntime && selectedFramework && (
                                <div>
                                    <label style={labelStyle}>Entry File</label>
                                    <div style={{ display: "flex", gap: 10 }}>
                                        <input
                                            value={entryFile}
                                            onChange={e => handleEntryFileChange(e.target.value)}
                                            placeholder="e.g. main.py, index.js"
                                            style={{ ...inputStyle, flex: 1 }}
                                        />
                                        <button
                                            onClick={() => {
                                                fetchProjectFiles(selectedRuntime);
                                                setShowFilePicker(!showFilePicker);
                                            }}
                                            style={{
                                                padding: "10px 16px",
                                                borderRadius: 6,
                                                border: "1px solid #ddd",
                                                background: "#f5f5f5",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6
                                            }}
                                        >
                                            📂 Browse
                                        </button>
                                    </div>

                                    {/* File Picker Dropdown */}
                                    {showFilePicker && projectFiles.length > 0 && (
                                        <div style={{
                                            marginTop: 8,
                                            border: "1px solid #ddd",
                                            borderRadius: 8,
                                            maxHeight: 200,
                                            overflowY: "auto",
                                            background: "white"
                                        }}>
                                            {projectFiles.map((file, idx) => (
                                                <div
                                                    key={idx}
                                                    onClick={() => handleEntryFileChange(file.path || file.name)}
                                                    style={{
                                                        padding: "10px 12px",
                                                        cursor: "pointer",
                                                        borderBottom: "1px solid #f0f0f0",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        background: entryFile === (file.path || file.name) ? "#e3f2fd" : "white"
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
                                                    onMouseLeave={e => e.currentTarget.style.background = entryFile === (file.path || file.name) ? "#e3f2fd" : "white"}
                                                >
                                                    <span>📄</span>
                                                    <span style={{ fontFamily: "monospace", fontSize: "0.9em" }}>{file.path || file.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {showFilePicker && projectFiles.length === 0 && (
                                        <div style={{ marginTop: 8, padding: 12, background: "#fff3cd", borderRadius: 6, fontSize: "0.85em", color: "#856404" }}>
                                            No matching files found. Enter the path manually.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Generated Commands Preview */}
                            {selectedRuntime && selectedFramework && (
                                <div style={{
                                    background: "#f8f9fa",
                                    border: "1px solid #e9ecef",
                                    borderRadius: 8,
                                    padding: 16
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                        <span style={{ fontWeight: 600, color: "#495057" }}>💡 Generated Commands</span>
                                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em", cursor: "pointer" }}>
                                            <input
                                                type="checkbox"
                                                checked={useCustomCommand}
                                                onChange={e => setUseCustomCommand(e.target.checked)}
                                            />
                                            <span>Edit manually</span>
                                        </label>
                                    </div>

                                    <div style={{ display: "grid", gap: 12 }}>
                                        <div>
                                            <label style={{ fontSize: "0.8em", color: "#6c757d", display: "block", marginBottom: 4 }}>Install Command</label>
                                            <input
                                                value={buildSettings.installCommand || ""}
                                                onChange={e => setBuildSettings({...buildSettings, installCommand: e.target.value})}
                                                disabled={!useCustomCommand}
                                                style={{
                                                    ...inputStyle,
                                                    fontFamily: "monospace",
                                                    fontSize: "0.9em",
                                                    background: useCustomCommand ? "white" : "#e9ecef",
                                                    color: useCustomCommand ? "#212529" : "#6c757d"
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: "0.8em", color: "#6c757d", display: "block", marginBottom: 4 }}>Start Command</label>
                                            <input
                                                value={buildSettings.startCommand}
                                                onChange={e => setBuildSettings({...buildSettings, startCommand: e.target.value})}
                                                disabled={!useCustomCommand}
                                                style={{
                                                    ...inputStyle,
                                                    fontFamily: "monospace",
                                                    fontSize: "0.9em",
                                                    background: useCustomCommand ? "white" : "#e9ecef",
                                                    color: useCustomCommand ? "#212529" : "#6c757d"
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* ========== FRONTEND STATIC SETTINGS ========== */
                        <div style={{ display: "grid", gap: 20, marginBottom: 25 }}>
                            {/* Frontend Framework Selection */}
                            <div>
                                <label style={labelStyle}>Framework</label>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {Object.entries(FRONTEND_FRAMEWORKS).map(([key, fw]) => (
                                        <button
                                            key={key}
                                            onClick={() => handleFrontendFrameworkChange(key)}
                                            style={{
                                                padding: "10px 16px",
                                                borderRadius: 8,
                                                border: selectedFrontendFramework === key ? "2px solid #2196F3" : "1px solid #ddd",
                                                background: selectedFrontendFramework === key ? "#e3f2fd" : "white",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                fontSize: "0.9em",
                                                fontWeight: selectedFrontendFramework === key ? 600 : 400,
                                                transition: "all 0.2s"
                                            }}
                                        >
                                            <span>{fw.icon}</span>
                                            <span>{fw.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Generated Commands Preview */}
                            {selectedFrontendFramework && (
                                <div style={{
                                    background: "#f8f9fa",
                                    border: "1px solid #e9ecef",
                                    borderRadius: 8,
                                    padding: 16
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                        <span style={{ fontWeight: 600, color: "#495057" }}>💡 Generated Commands</span>
                                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em", cursor: "pointer" }}>
                                            <input
                                                type="checkbox"
                                                checked={useCustomCommand}
                                                onChange={e => setUseCustomCommand(e.target.checked)}
                                            />
                                            <span>Edit manually</span>
                                        </label>
                                    </div>

                                    <div style={{ display: "grid", gap: 12 }}>
                                        <div>
                                            <label style={{ fontSize: "0.8em", color: "#6c757d", display: "block", marginBottom: 4 }}>Install Command</label>
                                            <input
                                                value={buildSettings.installCommand || ""}
                                                onChange={e => setBuildSettings({...buildSettings, installCommand: e.target.value})}
                                                disabled={!useCustomCommand}
                                                style={{
                                                    ...inputStyle,
                                                    fontFamily: "monospace",
                                                    fontSize: "0.9em",
                                                    background: useCustomCommand ? "white" : "#e9ecef"
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: "0.8em", color: "#6c757d", display: "block", marginBottom: 4 }}>Build Command</label>
                                            <input
                                                value={buildSettings.buildCommand}
                                                onChange={e => setBuildSettings({...buildSettings, buildCommand: e.target.value})}
                                                disabled={!useCustomCommand}
                                                style={{
                                                    ...inputStyle,
                                                    fontFamily: "monospace",
                                                    fontSize: "0.9em",
                                                    background: useCustomCommand ? "white" : "#e9ecef"
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: "0.8em", color: "#6c757d", display: "block", marginBottom: 4 }}>Output Directory</label>
                                            <input
                                                value={buildSettings.outputDir}
                                                onChange={e => setBuildSettings({...buildSettings, outputDir: e.target.value})}
                                                disabled={!useCustomCommand}
                                                style={{
                                                    ...inputStyle,
                                                    fontFamily: "monospace",
                                                    fontSize: "0.9em",
                                                    background: useCustomCommand ? "white" : "#e9ecef"
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* SPA Routing Option */}
                            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                <input
                                    type="checkbox"
                                    checked={buildSettings.spaRouting}
                                    onChange={e => setBuildSettings({...buildSettings, spaRouting: e.target.checked})}
                                    style={{ width: 18, height: 18 }}
                                />
                                <span><b>SPA Routing</b> (Redirect 404s to index.html)</span>
                            </label>
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(4)} style={secondaryBtn}>← Back</button>
                        <button
                            onClick={saveSettings}
                            disabled={siteType === "server" ? (!selectedRuntime || !selectedFramework) : !selectedFrontendFramework}
                            style={{
                                ...primaryBtn,
                                opacity: (siteType === "server" ? (!selectedRuntime || !selectedFramework) : !selectedFrontendFramework) ? 0.5 : 1
                            }}
                        >
                            Next: Env Vars →
                        </button>
                    </div>
                </div>
            )}

            {step === 6 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 5 : 6}: Environment Variables</h3>
                    <p style={stepDesc}>
                        {siteType === "server"
                            ? "Add runtime environment variables. (Note: PORT, NODE_ENV, HOST are managed automatically)"
                            : "Add keys like VITE_API_BASE. (Build-time only)"
                        }
                    </p>

                    {/* Error Message */}
                    {envError && (
                        <div style={{ marginBottom: 20, padding: 15, background: "#ffebee", color: "#c62828", borderRadius: 8, border: "1px solid #ef9a9a" }}>
                            ⚠️ {envError}
                        </div>
                    )}

                    {/* Tab Switcher */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <button
                            onClick={() => setEnvMode("manual")}
                            style={{
                                flex: 1, padding: 12, borderRadius: 8, border: envMode === "manual" ? "2px solid #2196F3" : "1px solid #ddd",
                                background: envMode === "manual" ? "#e3f2fd" : "white", cursor: "pointer", fontWeight: 500
                            }}
                        >
                            Manual
                        </button>
                        <button
                            onClick={() => setEnvMode("paste")}
                            style={{
                                flex: 1, padding: 12, borderRadius: 8, border: envMode === "paste" ? "2px solid #2196F3" : "1px solid #ddd",
                                background: envMode === "paste" ? "#e3f2fd" : "white", cursor: "pointer", fontWeight: 500
                            }}
                        >
                            Paste Text
                        </button>
                        <button
                            onClick={() => setEnvMode("upload")}
                            style={{
                                flex: 1, padding: 12, borderRadius: 8, border: envMode === "upload" ? "2px solid #2196F3" : "1px solid #ddd",
                                background: envMode === "upload" ? "#e3f2fd" : "white", cursor: "pointer", fontWeight: 500
                            }}
                        >
                            Upload File
                        </button>
                    </div>

                    {/* Existing Variables List (with inline editing) */}
                    {envVars.length > 0 && (
                        <div style={{ marginBottom: 15, border: "1px solid #eee", borderRadius: 6, overflow: "hidden" }}>
                            {envVars.map((ev, i) => (
                                <div key={i} style={{ display: "flex", gap: 10, padding: 8, background: i % 2 ? "#fafafa" : "white", borderBottom: "1px solid #eee", alignItems: "center" }}>
                                    {editingEnvIndex === i && editingEnvField === "key" ? (
                                        <input
                                            autoFocus
                                            value={ev.key}
                                            onChange={e => {
                                                const updated = [...envVars];
                                                updated[i].key = e.target.value.toUpperCase();
                                                setEnvVars(updated);
                                            }}
                                            onBlur={() => {
                                                setEditingEnvIndex(null);
                                                setEditingEnvField(null);
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    setEditingEnvIndex(null);
                                                    setEditingEnvField(null);
                                                }
                                            }}
                                            style={{ flex: 1, fontFamily: "monospace", fontWeight: 600, padding: "4px 8px", border: "2px solid #2196F3", borderRadius: 4 }}
                                        />
                                    ) : (
                                        <div
                                            onClick={() => {
                                                setEditingEnvIndex(i);
                                                setEditingEnvField("key");
                                            }}
                                            style={{ flex: 1, fontFamily: "monospace", fontWeight: 600, cursor: "pointer", padding: "4px 8px", borderRadius: 4, transition: "background 0.2s" }}
                                            onMouseEnter={e => e.currentTarget.style.background = "#e3f2fd"}
                                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                        >
                                            {ev.key}
                                        </div>
                                    )}
                                    {editingEnvIndex === i && editingEnvField === "value" ? (
                                        <input
                                            autoFocus
                                            value={ev.value}
                                            onChange={e => {
                                                const updated = [...envVars];
                                                updated[i].value = e.target.value;
                                                setEnvVars(updated);
                                            }}
                                            onBlur={() => {
                                                setEditingEnvIndex(null);
                                                setEditingEnvField(null);
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    setEditingEnvIndex(null);
                                                    setEditingEnvField(null);
                                                }
                                            }}
                                            style={{ flex: 1, fontFamily: "monospace", color: "#666", padding: "4px 8px", border: "2px solid #2196F3", borderRadius: 4 }}
                                        />
                                    ) : (
                                        <div
                                            onClick={() => {
                                                setEditingEnvIndex(i);
                                                setEditingEnvField("value");
                                            }}
                                            style={{ flex: 1, fontFamily: "monospace", color: "#666", cursor: "pointer", padding: "4px 8px", borderRadius: 4, transition: "background 0.2s" }}
                                            onMouseEnter={e => e.currentTarget.style.background = "#e3f2fd"}
                                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                        >
                                            {ev.value}
                                        </div>
                                    )}
                                    <button onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "crimson", cursor: "pointer", fontSize: "1.2em" }}>✕</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Manual Mode */}
                    {envMode === "manual" && (
                        <div style={{ marginBottom: 25 }}>
                            <div style={{ display: "flex", gap: 10 }}>
                                <input
                                    placeholder="KEY (e.g. API_URL)"
                                    value={newEnv.key}
                                    onChange={e => setNewEnv({...newEnv, key: e.target.value.toUpperCase()})}
                                    style={{ ...inputStyle, flex: 1 }}
                                />
                                <input
                                    placeholder="Value"
                                    value={newEnv.value}
                                    onChange={e => setNewEnv({...newEnv, value: e.target.value})}
                                    style={{ ...inputStyle, flex: 1 }}
                                />
                                <button
                                    onClick={addEnvVar}
                                    style={{ background: "#333", color: "white", padding: "0 15px", borderRadius: 4, border: "none", cursor: "pointer" }}
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Paste Text Mode */}
                    {envMode === "paste" && (
                        <div style={{ marginBottom: 25 }}>
                            <textarea
                                placeholder="Paste your environment variables here:&#10;API_KEY=abc123&#10;DATABASE_URL=postgres://...&#10;PORT=4000"
                                value={pasteText}
                                onChange={e => setPasteText(e.target.value)}
                                style={{
                                    ...inputStyle,
                                    minHeight: 150,
                                    fontFamily: "monospace",
                                    fontSize: "0.9em",
                                    resize: "vertical"
                                }}
                            />
                            <button
                                onClick={handlePasteText}
                                style={{
                                    marginTop: 10,
                                    background: "#333",
                                    color: "white",
                                    padding: "10px 20px",
                                    borderRadius: 4,
                                    border: "none",
                                    cursor: "pointer",
                                    fontWeight: 500
                                }}
                            >
                                Parse & Add
                            </button>
                        </div>
                    )}

                    {/* Upload File Mode */}
                    {envMode === "upload" && (
                        <div style={{ marginBottom: 25 }}>
                            <input
                                type="file"
                                id="env-upload"
                                accept=".env,text/plain"
                                style={{ display: "none" }}
                                onChange={handleEnvFileUpload}
                            />
                            <button
                                onClick={() => document.getElementById('env-upload').click()}
                                style={{
                                    padding: "12px 20px",
                                    fontSize: "1em",
                                    background: "#f5f5f5",
                                    border: "1px solid #ddd",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                    fontWeight: 500,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8
                                }}
                            >
                                📂 Choose .env File
                            </button>
                            <p style={{ fontSize: "0.85em", color: "#666", marginTop: 10 }}>
                                Upload a .env file to import all variables at once.
                            </p>
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(5)} style={secondaryBtn}>← Back</button>
                        <button onClick={startDeploy} style={{ ...primaryBtn, background: "#00C853" }}>Deploy Now 🚀</button>
                    </div>
                </div>
            )}

            {step === 7 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step {role ? 6 : 7}: Building & Deploying...</h3>
                    <div id="log-container" style={{ 
                        background: "#1e1e1e", color: "#a9b7c6", padding: 20, borderRadius: 8, 
                        height: 350, overflowY: "auto", fontFamily: "Consolas, Monaco, monospace", fontSize: "0.85em",
                        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)" 
                    }}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            {logs || "Initializing build environment..."}
                        </pre>
                        {/* Anchor for auto-scroll */}
                        <div style={{ height: 1 }} />
                    </div>
                    
                    {deployment?.status === "DEPLOYED" && (() => {
                        // For role-based deployment, use groupSlug (the project URL)
                        // For legacy, use siteSlug (the individual site's subdomain)
                        const urlSlug = role ? groupSlug : (projectData?.slug || siteSlug);
                        const urlPath = role === "BACKEND" ? "/api" : "";
                        const siteUrl = `http://${urlSlug}.${baseDomain}${basePort}${urlPath}`;
                        const siteLabel = `${urlSlug}.${baseDomain}${basePort}${urlPath || "/"}`;

                        return (
                            <div style={{ marginTop: 25, textAlign: "center", padding: 20, background: "#e8f5e9", borderRadius: 8, border: "1px solid #c8e6c9" }}>
                                <h2 style={{ color: "#2e7d32", marginTop: 0 }}>Deployment Complete! 🎉</h2>
                                <p>Your {role ? role.toLowerCase() : "site"} is verified and live.</p>
                                <a href={siteUrl} target="_blank" rel="noreferrer" style={{
                                    display: "inline-block", marginTop: 10, padding: "10px 20px",
                                    background: "#2e7d32", color: "white", textDecoration: "none", borderRadius: 6, fontWeight: "bold"
                                }}>
                                    Visit {siteLabel}
                                </a>
                                <div style={{ marginTop: 15 }}>
                                    <button onClick={onComplete} style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer", color: "#2e7d32" }}>Back to Project</button>
                                </div>
                            </div>
                        );
                    })()}
                    {deployment?.status === "FAILED" && (
                        <div style={{ marginTop: 20, textAlign: "center", color: "crimson" }}>
                            <h3>Deployment Failed ❌</h3>
                            <button onClick={() => setStep(4)} style={secondaryBtn}>Review Settings</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SimpleFolderTree({ tree, onSelect, selected, depth = 0 }) {
    const [isExpanded, setIsExpanded] = useState(depth === 0); // Root starts expanded
    const hasChildren = tree.children && tree.children.length > 0;

    return (
        <div style={{ paddingLeft: depth === 0 ? 0 : 20 }}>
            <div
                style={{
                    padding: "6px 8px", cursor: "pointer",
                    background: selected === tree.path ? "#e3f2fd" : "transparent",
                    color: selected === tree.path ? "#1565c0" : "inherit",
                    borderRadius: 4, display: "flex", alignItems: "center", gap: 6
                }}
            >
                {hasChildren && (
                    <span
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                        style={{ userSelect: "none", width: 16, display: "inline-block", fontWeight: "bold" }}
                    >
                        {isExpanded ? "▼" : "▶"}
                    </span>
                )}
                {!hasChildren && <span style={{ width: 16, display: "inline-block" }}></span>}
                <span onClick={() => onSelect(tree.path)}>
                    {tree.name === "(Project Root)" || tree.name === "(root)" ? "📂 Project Root" : "📁 " + tree.name}
                </span>
            </div>
            {isExpanded && hasChildren && tree.children.map(child => (
                <SimpleFolderTree key={child.path} tree={child} onSelect={onSelect} selected={selected} depth={depth + 1} />
            ))}
        </div>
    );
}

// Styles
const stepTitle = { marginTop: 0, marginBottom: 5, fontSize: "1.5em", color: "#333" };
const stepDesc = { margin: "0 0 20px 0", color: "#666", fontSize: "0.95em" };
const labelStyle = { display: "block", marginBottom: 6, fontWeight: 500, fontSize: "0.9em", color: "#444" };
const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: "1em" };
const primaryBtn = { background: "#2196F3", color: "white", padding: "10px 20px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "1em", fontWeight: 500, flex: 1 };
const secondaryBtn = { background: "#f5f5f5", color: "#333", padding: "10px 20px", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", fontSize: "1em", fontWeight: 500 };
