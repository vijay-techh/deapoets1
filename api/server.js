require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

const SECRET = process.env.JWT_SECRET || "deadpoets_secret";
const router = express.Router();

// ✅ SIGNUP
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users(name, email, password) VALUES ($1,$2,$3)",
      [name, email, hash]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") {
      res.json({ success: false, message: "Email already exists" });
    } else {
      res.json({ success: false, message: "Server error" });
    }
  }
});

// ✅ LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRes = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.json({ success: false, message: "Incorrect password" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      role: user.role,
      user_id: user.id
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Internal server error" });
  }
});

// ✅ Post poem
router.post("/poems", async (req, res) => {
  const { title, content, user_id } = req.body;

  try {
    await pool.query(
      "INSERT INTO poems(title, content, user_id) VALUES ($1,$2,$3)",
      [title, content, user_id]
    );

    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// ✅ Get poems
router.get("/poems", async (req, res) => {
  const data = await pool.query(`
    SELECT poems.*, users.name 
    FROM poems 
    JOIN users ON poems.user_id = users.id 
    ORDER BY poems.created_at DESC
  `);

  res.json(data.rows);
});

// ✅ Get users
router.get("/users", async (req, res) => {
  const data = await pool.query("SELECT id,name,email,role FROM users");
  res.json(data.rows);
});

// ✅ Report poem
router.post("/report", async (req, res) => {
  const { poem_id, reported_by, reason } = req.body;

  try {
    await pool.query(
      "INSERT INTO reports(poem_id, reported_by, reason) VALUES ($1,$2,$3)",
      [poem_id, reported_by, reason]
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// ✅ Delete poem
router.delete("/poems/:id", async (req, res) => {
  const poemId = req.params.id;

  try {
    await pool.query("DELETE FROM poems WHERE id = $1", [poemId]);
    await pool.query("DELETE FROM reports WHERE poem_id = $1", [poemId]);

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// ✅ Reports
router.get("/reports", async (req, res) => {
  const result = await pool.query(`
    SELECT 
      reports.id,
      reports.poem_id,
      reports.reason,
      users.name AS reporter,
      poems.title AS poem_title
    FROM reports
    JOIN users ON reports.reported_by = users.id
    JOIN poems ON reports.poem_id = poems.id
    ORDER BY reports.created_at DESC
  `);

  res.json(result.rows);
});

// ✅ Likes
router.post("/like", async (req, res) => {
  const { poem_id, user_id } = req.body;

  try {
    await pool.query(
      "INSERT INTO likes(poem_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [poem_id, user_id]
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// ✅ Likes counter
router.get("/likes", async (req, res) => {
  const result = await pool.query(`
    SELECT poem_id, COUNT(*) AS like_count
    FROM likes
    GROUP BY poem_id
  `);

  res.json(result.rows);
});

// ✅ Profile
router.get("/profile/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [userId]
    );

    const poemCount = await pool.query(
      "SELECT COUNT(*) FROM poems WHERE user_id = $1",
      [userId]
    );

    const likeCount = await pool.query(`
      SELECT COUNT(*) 
      FROM likes 
      JOIN poems ON likes.poem_id = poems.id
      WHERE poems.user_id = $1
    `, [userId]);

    res.json({
      user: user.rows[0],
      poems: poemCount.rows[0].count,
      likes: likeCount.rows[0].count
    });
  } catch {
    res.status(500).json({ error: "Profile load failed" });
  }
});

// ✅ User poems
router.get("/user-poems/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const poems = await pool.query(
      "SELECT id, title, content FROM poems WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    res.json(poems.rows);
  } catch {
    res.status(500).json({ error: "Poems load failed" });
  }
});

// ✅ Test route
router.get("/", (req, res) => {
  res.send("DeadPoet API Running ✅");
});

// ✅ Prefix with /api
app.use("/api", router);

// ✅ Run locally ONLY
if (process.env.NODE_ENV !== "production") {
  app.listen(5000, () => {
    console.log("Local API → http://localhost:5000");
  });
}

// ✅ Required for Vercel
module.exports = app;
