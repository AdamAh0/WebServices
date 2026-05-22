const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const z = require("zod");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app); // important : on wrap express avec http
const io = new Server(server, {
  cors: { origin: "*" }
});
const port = 8000;
const client = new MongoClient("mongodb://localhost:27017");
let db;

app.use(express.json());
const path = require("path");
app.use(express.static(path.join(__dirname)));
// --- SCHEMAS ---
const ProductSchema = z.object({
  _id: z.string(),
  name: z.string(),
  about: z.string(),
  price: z.number().positive(),
  categoryIds: z.array(z.string()),
});
const CreateProductSchema = ProductSchema.omit({ _id: true });
const UpdateProductSchema = z.object({
  name: z.string().optional(),
  about: z.string().optional(),
  price: z.number().positive().optional(),
  categoryIds: z.array(z.string()).optional(),
});

const CreateCategorySchema = z.object({ name: z.string() });

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log("Client connecté :", socket.id);
  socket.on("disconnect", () => {
    console.log("Client déconnecté :", socket.id);
  });
});

// --- PRODUCTS ---

// POST /products
app.post("/products", async (req, res) => {
  const result = CreateProductSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  try {
    const { name, about, price, categoryIds } = result.data;
    const categoryObjectIds = categoryIds.map((id) => new ObjectId(id));

    const ack = await db.collection("products")
      .insertOne({ name, about, price, categoryIds: categoryObjectIds });

    const product = { _id: ack.insertedId, name, about, price, categoryIds: categoryObjectIds };

    io.emit("products", { event: "created", product }); // 🔔 notification temps réel

    res.status(201).send(product);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /products
app.get("/products", async (req, res) => {
  try {
    const products = await db.collection("products").aggregate([
      { $match: {} },
      { $lookup: { from: "categories", localField: "categoryIds", foreignField: "_id", as: "categories" } },
    ]).toArray();
    res.send(products);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /products/:id
app.get("/products/:id", async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const products = await db.collection("products").aggregate([
      { $match: { _id: id } },
      { $lookup: { from: "categories", localField: "categoryIds", foreignField: "_id", as: "categories" } },
    ]).toArray();

    if (products.length === 0) return res.status(404).send({ message: "Product not found" });
    res.send(products[0]);
  } catch (err) {
    if (err.message.includes("input must be a 24 character hex string"))
      return res.status(400).send({ message: "Invalid id format" });
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PUT /products/:id
app.put("/products/:id", async (req, res) => {
  const result = CreateProductSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  try {
    const id = new ObjectId(req.params.id);
    const { name, about, price, categoryIds } = result.data;
    const categoryObjectIds = categoryIds.map((id) => new ObjectId(id));

    const ack = await db.collection("products").findOneAndUpdate(
      { _id: id },
      { $set: { name, about, price, categoryIds: categoryObjectIds } },
      { returnDocument: "after" }
    );

    if (!ack) return res.status(404).send({ message: "Product not found" });

    io.emit("products", { event: "updated", product: ack }); // 🔔

    res.send(ack);
  } catch (err) {
    if (err.message.includes("input must be a 24 character hex string"))
      return res.status(400).send({ message: "Invalid id format" });
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PATCH /products/:id
app.patch("/products/:id", async (req, res) => {
  const result = UpdateProductSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const fields = result.data;
  if (Object.keys(fields).length === 0)
    return res.status(400).send({ message: "No fields to update" });

  try {
    const id = new ObjectId(req.params.id);
    if (fields.categoryIds)
      fields.categoryIds = fields.categoryIds.map((id) => new ObjectId(id));

    const ack = await db.collection("products").findOneAndUpdate(
      { _id: id },
      { $set: fields },
      { returnDocument: "after" }
    );

    if (!ack) return res.status(404).send({ message: "Product not found" });

    io.emit("products", { event: "updated", product: ack }); // 🔔

    res.send(ack);
  } catch (err) {
    if (err.message.includes("input must be a 24 character hex string"))
      return res.status(400).send({ message: "Invalid id format" });
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// DELETE /products/:id
app.delete("/products/:id", async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const ack = await db.collection("products").findOneAndDelete({ _id: id });

    if (!ack) return res.status(404).send({ message: "Product not found" });

    io.emit("products", { event: "deleted", productId: req.params.id }); // 🔔

    res.send(ack);
  } catch (err) {
    if (err.message.includes("input must be a 24 character hex string"))
      return res.status(400).send({ message: "Invalid id format" });
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// --- CATEGORIES ---
app.post("/categories", async (req, res) => {
  const result = CreateCategorySchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const { name } = result.data;
  const ack = await db.collection("categories").insertOne({ name });
  res.status(201).send({ _id: ack.insertedId, name });
});

// --- START SERVER ---
client.connect().then(() => {
  db = client.db("myDB");
  server.listen(port, () => { // important : server.listen et non app.listen
    console.log(`Listening on http://localhost:${port}`);
  });
});