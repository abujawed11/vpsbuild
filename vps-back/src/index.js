const express = require("express");
const cors = require("cors");
require("dotenv").config();
const morgan = require("morgan");
const githubRoutes = require("./routes/github");

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");

const app = express();

app.use(morgan("dev"));

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",").map(s => s.trim()) || "http://localhost:5173",
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/github", githubRoutes);

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
