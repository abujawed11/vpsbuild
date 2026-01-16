const express = require("express");
const cors = require("cors");
require("dotenv").config();
const morgan = require("morgan");
const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const githubRoutes = require("./routes/github");
const projectRoutes = require("./routes/projects");
const groupRoutes = require("./routes/groups");
const deploymentRoutes = require("./routes/deployments");
const frameworkPresetsRoutes = require("./routes/framework-presets");
const databaseRoutes = require("./routes/databases");
const filesRoutes = require("./routes/files");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/github", githubRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/deployments", deploymentRoutes);
app.use("/api/framework-presets", frameworkPresetsRoutes);
app.use("/api/databases", databaseRoutes);
app.use("/api/files", filesRoutes);

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
