const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, "lists.json");

// Load existing data from the JSON file, or initialize an empty object if the file doesn't exist
let lists = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    lists = JSON.parse(data);
  } catch (error) {
    console.error("Error reading data file:", error);
  }
}

// Helper function to save the lists object to the JSON file
const saveToFile = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(lists, null, 2));
  } catch (error) {
    console.error("Error saving data to file:", error);
  }
};

// Create a new list
app.post("/api/create-list", (req, res) => {
  const { name } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).send({ error: "List name is required" });
  }

  const id = uuidv4(); // Generate a unique ID
  lists[id] = { name, items: [] }; // Initialize the list with a name and empty items

  saveToFile(); // Save the updated lists to the file

  res.status(201).send({ id }); // Return the generated ID to the frontend
});

// Get list details by ID
app.get("/api/lists/:id", (req, res) => {
  const id = req.params.id;
  if (!lists[id]) {
    return res.status(404).send({ error: "List not found" });
  }

  res.json({ name: lists[id].name, items: lists[id].items });
});

// Add an item to the list
app.post("/api/lists/:id", (req, res) => {
  const id = req.params.id;
  const { item } = req.body;

  if (!item || item.trim() === "") {
    return res.status(400).send({ error: "Item is required" });
  }

  if (!lists[id]) {
    return res.status(404).send({ error: "List not found" });
  }

  lists[id].items.push(item); // Add the new item to the list
  saveToFile(); // Save the updated list to the file

  // Notify connected clients about the update
  io.to(id).emit("listUpdated", lists[id].items);

  res.status(201).send({ success: true });
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
