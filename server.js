require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://list-app-two.vercel.app",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
    next();
  } else {
    res.status(403).send({ error: "CORS error: Origin not allowed" });
  }
});

app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS error: Origin ${origin} not allowed`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

let db = mysql.createPool({
  host: process.env.TEST_DATABASE_HOST,
  user: process.env.TEST_DATABASE_USER,
  password: process.env.TEST_DATABASE_PASSWORD,
  database: process.env.TEST_DATABASE_DB,
});

if (process.env.ENVIRONMENT === "production") {
  db = mysql.createPool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DB,
  });
}

// API Endpoints
app.post("/api/create-list", async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).send({ error: "List name is required" });
  }

  const uuid = uuidv4();
  try {
    const [result] = await db.query(
      "INSERT INTO lists (uuid, name, created_at) VALUES (?, ?, NOW())",
      [uuid, name]
    );
    res.status(201).send({ id: result.insertId, uuid });
  } catch (error) {
    console.error("Error creating list:", error);
    res.status(500).send({ error: "Error creating list" });
  }
});

app.get("/api/lists/:uuid", async (req, res) => {
  const { uuid } = req.params;
  try {
    const [listRows] = await db.query("SELECT * FROM lists WHERE uuid = ?", [
      uuid,
    ]);
    if (listRows.length === 0) {
      return res.status(404).send({ error: "List not found" });
    }

    const [itemRows] = await db.query("SELECT * FROM items WHERE list_id = ?", [
      listRows[0].id,
    ]);

    res.json({
      list: {
        id: listRows[0].id,
        uuid: listRows[0].uuid,
        name: listRows[0].name,
        created_at: listRows[0].created_at,
      },
      items: itemRows.map((item) => ({
        id: item.id,
        item: item.item,
        checked: item.checked,
        quantity: item.quantity,
        created_at: item.created_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching list:", error);
    res.status(500).send({ error: "Error fetching list" });
  }
});

app.post("/api/lists/:uuid", async (req, res) => {
  const { uuid } = req.params;
  const { item, quantity } = req.body;

  if (!item || item.trim() === "") {
    return res.status(400).send({ error: "Item content is required" });
  }

  try {
    const [listRows] = await db.query("SELECT * FROM lists WHERE uuid = ?", [
      uuid,
    ]);
    if (listRows.length === 0) {
      return res.status(404).send({ error: "List not found" });
    }

    await db.query(
      "INSERT INTO items (list_id, item, quantity, checked, created_at) VALUES (?, ?, ?, false, NOW())",
      [listRows[0].id, item, quantity]
    );

    const [updatedItems] = await db.query(
      "SELECT id, item, quantity, checked, created_at FROM items WHERE list_id = ?",
      [listRows[0].id]
    );

    io.to(uuid).emit("listUpdated", updatedItems);
    res.status(201).send({ success: true });
  } catch (error) {
    console.error("Error adding item:", error);
    res.status(500).send({ error: "Error adding item" });
  }
});

app.delete("/api/lists/:uuid/items/:itemId", async (req, res) => {
  const { uuid, itemId } = req.params;

  try {
    const [listRows] = await db.query("SELECT id FROM lists WHERE uuid = ?", [
      uuid,
    ]);
    if (listRows.length === 0) {
      return res.status(404).send({ error: "List not found" });
    }

    const [deleteResult] = await db.query(
      "DELETE FROM items WHERE id = ? AND list_id = ?",
      [itemId, listRows[0].id]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).send({ error: "Item not found" });
    }

    const [updatedItems] = await db.query(
      "SELECT id, item, quantity, checked, created_at FROM items WHERE list_id = ?",
      [listRows[0].id]
    );

    io.to(uuid).emit("listUpdated", updatedItems);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).send({ error: "Error deleting item" });
  }
});

app.put("/api/lists/:uuid/items/:itemId", async (req, res) => {
  const { uuid, itemId } = req.params;
  const { checked } = req.body;

  try {
    const [listRows] = await db.query("SELECT id FROM lists WHERE uuid = ?", [
      uuid,
    ]);
    if (listRows.length === 0) {
      return res.status(404).send({ error: "List not found" });
    }

    const [updateResult] = await db.query(
      "UPDATE items SET checked = ? WHERE id = ? AND list_id = ?",
      [checked, itemId, listRows[0].id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).send({ error: "Item not found" });
    }

    const [updatedItems] = await db.query(
      "SELECT id, item, created_at, quantity, checked FROM items WHERE list_id = ?",
      [listRows[0].id]
    );

    io.to(uuid).emit("listUpdated", updatedItems);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).send({ error: "Error updating item" });
  }
});

app.put("/api/lists/:uuid/items/:itemId/quantity", async (req, res) => {
  const { uuid, itemId } = req.params;
  const { quantity } = req.body;

  if (quantity < 0) {
    return res.status(400).send({ error: "Quantity cannot be negative" });
  }

  try {
    const [listRows] = await db.query("SELECT id FROM lists WHERE uuid = ?", [
      uuid,
    ]);
    if (listRows.length === 0) {
      return res.status(404).send({ error: "List not found" });
    }

    const [updateResult] = await db.query(
      "UPDATE items SET quantity = ? WHERE id = ? AND list_id = ?",
      [quantity, itemId, listRows[0].id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).send({ error: "Item not found" });
    }

    const [updatedItems] = await db.query(
      "SELECT id, item, checked, quantity, created_at FROM items WHERE list_id = ?",
      [listRows[0].id]
    );

    io.to(uuid).emit("listUpdated", updatedItems);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Error updating item quantity:", error);
    res.status(500).send({ error: "Error updating item quantity" });
  }
});

// WebSocket for real-time updates
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("joinList", (uuid) => {
    socket.join(uuid);
    console.log(`User joined list: ${uuid}`);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

setInterval(() => {
  const url = `http://localhost:3000/api/heartbeat`;
  axios
    .get(url)
    .then(() => console.log("Self-ping successful"))
    .catch((err) => console.error("Self-ping failed:", err.message));
}, 2 * 60 * 1000);
app.get("/api/heartbeat", (req, res) => {
  res.send("Server is active");
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
