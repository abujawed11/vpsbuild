const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

// GET /api/me
router.get("/", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      createdAt: true,
      github: { select: { username: true, githubUserId: true, createdAt: true } }
    }
  });

  return res.json({ user });
});

module.exports = router;
