const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

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

const DATA_FILE = path.join(__dirname, "lists.json");

let lists = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    lists = JSON.parse(data);
  } catch (error) {
    console.error("Error reading data file:", error);
    lists = {};
  }
}

const saveToFile = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(lists, null, 2));
  } catch (error) {
    console.error("Error saving data to file:", error);
  }
};

// API Endpoints
app.post("/api/create-list", (req, res) => {
  const { name } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).send({ error: "List name is required" });
  }

  const id = uuidv4();
  lists[id] = { name, items: [] };
  saveToFile();

  res.status(201).send({ id });
});

app.get("/api/lists/:id", (req, res) => {
  const id = req.params.id;
  if (!lists[id]) {
    return res.status(404).send({ error: "List not found" });
  }

  res.json({ name: lists[id].name, items: lists[id].items });
});

app.post("/api/lists/:id", (req, res) => {
  const id = req.params.id;
  const { item } = req.body;

  if (!item || item.trim() === "") {
    return res.status(400).send({ error: "Item is required" });
  }

  if (!lists[id]) {
    return res.status(404).send({ error: "List not found" });
  }

  lists[id].items.push(item);
  saveToFile();

  io.to(id).emit("listUpdated", lists[id].items);
  res.status(201).send({ success: true });
});

app.delete("/api/lists/:id/item", (req, res) => {
  const { id } = req.params;
  const { item } = req.body;

  if (!item || item.trim() === "") {
    return res.status(400).send({ error: "Item is required" });
  }

  if (!lists[id]) {
    return res.status(404).send({ error: "List not found" });
  }

  const itemIndex = lists[id].items.indexOf(item);
  if (itemIndex === -1) {
    return res.status(404).send({ error: "Item not found" });
  }

  lists[id].items.splice(itemIndex, 1);
  saveToFile();

  io.to(id).emit("listUpdated", lists[id].items);
  res.status(200).send({ success: true });
});

// WebSocket for real-time updates
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("joinList", (listId) => {
    if (lists[listId]) {
      socket.join(listId);
      console.log(`User joined list: ${listId}`);
    } else {
      console.log(`Attempted to join non-existent list: ${listId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
