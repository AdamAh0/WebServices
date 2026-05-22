const express = require("express");
const postgres = require("postgres");
const z = require("zod");

const crypto = require("crypto");

const app = express();
const port = 8000;
const sql = postgres({ db: "mydb", user: "user", password: "password", port: 5433 });

// Pour effectuer des requêtes HTTP
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

app.use(express.json());

// --- F2P GAMES RESOURCE ---
// GET /f2p-games : récupère la liste des jeux FreeToGame
app.get("/f2p-games", async (req, res) => {
  try {
    const response = await fetch("https://www.freetogame.com/api/games");
    if (!response.ok) {
      return res.status(502).send({ message: "Erreur lors de la récupération des jeux F2P" });
    }
    const games = await response.json();
    res.send(games);
  } catch (err) {
    res.status(500).send({ message: "Erreur serveur", error: err.message });
  }
});

// GET /f2p-games/:id : récupère un jeu FreeToGame par id
app.get("/f2p-games/:id", async (req, res) => {
  try {
    const response = await fetch(`https://www.freetogame.com/api/game?id=${req.params.id}`);
    if (!response.ok) {
      return res.status(502).send({ message: "Erreur lors de la récupération du jeu F2P" });
    }
    const game = await response.json();
    if (!game || game.status === 0) {
      return res.status(404).send({ message: "Jeu non trouvé" });
    }
    res.send(game);
  } catch (err) {
    res.status(500).send({ message: "Erreur serveur", error: err.message });
  }
});

// Schemas
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  about: z.string(),
  price: z.number().positive(),
});

// User schemas
const UserSchema = z.object({
  id: z.string(),
  username: z.string().min(3),
  email: z.string().email(),
  // password intentionally omitted from output
});

const CreateUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
});

const UpdateUserSchema = z.object({
  username: z.string().min(3).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const CreateProductSchema = ProductSchema.omit({ id: true });


// Helper : enrichit un produit avec ses reviews
async function enrichProduct(product) {
  const reviews = product.review_ids?.length
    ? await sql`SELECT * FROM reviews WHERE id = ANY(${product.review_ids})`
    : [];
  return { ...product, reviews };
}

// GET /products
app.get("/products", async (req, res) => {
  const { name, about, price } = req.query;
  try {
    const products = await sql`
      SELECT * FROM products
      WHERE TRUE
      ${name  ? sql`AND name  ILIKE ${'%' + name  + '%'}` : sql``}
      ${about ? sql`AND about ILIKE ${'%' + about + '%'}` : sql``}
      ${price ? sql`AND price::numeric <= ${Number(price)}` : sql``}
    `;
    const enriched = await Promise.all(products.map(enrichProduct));
    res.send(enriched);
  } catch (err) {
    res.status(500).send({ message: "Erreur lors de la recherche", error: err.message });
  }
});

// GET /products/:id
app.get("/products/:id", async (req, res) => {
  try {
    const products = await sql`SELECT * FROM products WHERE id = ${req.params.id}`;
    if (products.length === 0)
      return res.status(404).send({ message: "Not found" });
    res.send(await enrichProduct(products[0]));
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});


// --- USERS RESOURCE ---

// Helper to hash password
function hashPassword(password) {
  return crypto.createHash("sha512").update(password).digest("hex");
}

// Create user
app.post("/users", async (req, res) => {
  const result = await CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).send(result);
  }
  const { username, email, password } = result.data;
  try {
    const hashedPassword = hashPassword(password);
    const user = await sql`
      INSERT INTO users (username, email, password)
      VALUES (${username}, ${email}, ${hashedPassword})
      RETURNING id, username, email
    `;
    res.status(201).send(user[0]);
  } catch (err) {
    if (err.code === '23505') { // unique violation
      res.status(409).send({ message: "Username or email already exists" });
    } else {
      res.status(500).send({ message: "Internal server error" });
    }
  }
});

// PUT
app.put("/users/:id", async (req, res) => {
  const result = await CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).send(result);
  }
  const { username, email, password } = result.data;
  try {
    const hashedPassword = hashPassword(password);
    const user = await sql`
      UPDATE users SET username=${username}, email=${email}, password=${hashedPassword}
      WHERE id=${req.params.id}
      RETURNING id, username, email
    `;
    if (user.length > 0) {
      res.send(user[0]);
    } else {
      res.status(404).send({ message: "User not found" });
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).send({ message: "Username or email already exists" });
    } else {
      res.status(500).send({ message: "Internal server error" });
    }
  }
});

// PATCH 
app.patch("/users/:id", async (req, res) => {
  const result = await UpdateUserSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).send(result);
  }
  const fields = result.data;
  if (Object.keys(fields).length === 0) {
    return res.status(400).send({ message: "No fields to update" });
  }
  let setParts = [];
  let values = [];
  if (fields.username) {
    setParts.push(sql`username = ${fields.username}`);
  }
  if (fields.email) {
    setParts.push(sql`email = ${fields.email}`);
  }
  if (fields.password) {
    setParts.push(sql`password = ${hashPassword(fields.password)}`);
  }
  try {
    const user = await sql`
      UPDATE users SET ${sql(setParts)} WHERE id=${req.params.id} RETURNING id, username, email
    `;
    if (user.length > 0) {
      res.send(user[0]);
    } else {
      res.status(404).send({ message: "User not found" });
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).send({ message: "Username or email already exists" });
    } else {
      res.status(500).send({ message: "Internal server error" });
    }
  }
});


// --- ORDERS RESOURCE ---

const CreateOrderSchema = z.object({
  userId: z.number().int().positive(),
  productIds: z.array(z.number().int().positive()).min(1),
});

const UpdateOrderSchema = z.object({
  userId: z.number().int().positive().optional(),
  productIds: z.array(z.number().int().positive()).min(1).optional(),
  payment: z.boolean().optional(),
});

// Helper : enrichit une commande avec l'user et les produits complets
async function enrichOrder(order) {
  const [user] = await sql`
    SELECT id, username, email FROM users WHERE id = ${order.user_id}
  `;
  const products = await sql`
    SELECT * FROM products WHERE id = ANY(${order.product_ids})
  `;
  return { ...order, user: user ?? null, products };
}

// Helper : calcule le total TTC (prix * 1.2)
async function calcTotal(productIds) {
  const products = await sql`
    SELECT * FROM products WHERE id = ANY(${productIds})
  `;
  if (products.length !== productIds.length) return null; // produit introuvable
  const total = products.reduce((sum, p) => sum + Number(p.price), 0) * 1.2;
  return { products, total };
}

// POST /orders — créer une commande
app.post("/orders", async (req, res) => {
  const result = CreateOrderSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const { userId, productIds } = result.data;
  try {
    const user = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (user.length === 0)
      return res.status(404).send({ message: "User not found" });

    const calc = await calcTotal(productIds);
    if (!calc)
      return res.status(404).send({ message: "One or more products not found" });

    const order = await sql`
      INSERT INTO orders (user_id, product_ids, total)
      VALUES (${userId}, ${productIds}, ${calc.total})
      RETURNING *
    `;
    res.status(201).send(order[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /orders — liste toutes les commandes (user + produits complets)
app.get("/orders", async (req, res) => {
  try {
    const orders = await sql`SELECT * FROM orders`;
    const enriched = await Promise.all(orders.map(enrichOrder));
    res.send(enriched);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /orders/:id — une commande (user + produits complets)
app.get("/orders/:id", async (req, res) => {
  try {
    const orders = await sql`SELECT * FROM orders WHERE id = ${req.params.id}`;
    if (orders.length === 0)
      return res.status(404).send({ message: "Order not found" });
    res.send(await enrichOrder(orders[0]));
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PUT /orders/:id — remplace entièrement une commande
app.put("/orders/:id", async (req, res) => {
  const result = CreateOrderSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const { userId, productIds } = result.data;
  try {
    const user = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (user.length === 0)
      return res.status(404).send({ message: "User not found" });

    const calc = await calcTotal(productIds);
    if (!calc)
      return res.status(404).send({ message: "One or more products not found" });

    const order = await sql`
      UPDATE orders
      SET user_id = ${userId}, product_ids = ${productIds},
          total = ${calc.total}, updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (order.length === 0)
      return res.status(404).send({ message: "Order not found" });
    res.send(order[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PATCH /orders/:id — mise à jour partielle
app.patch("/orders/:id", async (req, res) => {
  const result = UpdateOrderSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const fields = result.data;
  if (Object.keys(fields).length === 0)
    return res.status(400).send({ message: "No fields to update" });

  try {
    const current = await sql`SELECT * FROM orders WHERE id = ${req.params.id}`;
    if (current.length === 0)
      return res.status(404).send({ message: "Order not found" });

    const prev = current[0];
    const userId     = fields.userId     ?? prev.user_id;
    const productIds = fields.productIds ?? prev.product_ids;
    const payment    = fields.payment    ?? prev.payment;

    // Recalcule le total seulement si les produits changent
    let total = Number(prev.total);
    if (fields.productIds) {
      const calc = await calcTotal(productIds);
      if (!calc)
        return res.status(404).send({ message: "One or more products not found" });
      total = calc.total;
    }

    const order = await sql`
      UPDATE orders
      SET user_id = ${userId}, product_ids = ${productIds},
          total = ${total}, payment = ${payment}, updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    res.send(order[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// DELETE /orders/:id
app.delete("/orders/:id", async (req, res) => {
  try {
    const order = await sql`
      DELETE FROM orders WHERE id = ${req.params.id} RETURNING *
    `;
    if (order.length === 0)
      return res.status(404).send({ message: "Order not found" });
    res.send(order[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// --- REVIEWS RESOURCE ---

const CreateReviewSchema = z.object({
  userId:    z.number().int().positive(),
  productId: z.number().int().positive(),
  score:     z.number().int().min(1).max(5),
  content:   z.string().min(1),
});

const UpdateReviewSchema = z.object({
  score:   z.number().int().min(1).max(5).optional(),
  content: z.string().min(1).optional(),
});

// Helper : recalcule et met à jour average_score + review_ids du produit
async function updateProductScore(productId) {
  const reviews = await sql`
    SELECT id, score FROM reviews WHERE product_id = ${productId}
  `;
  const reviewIds    = reviews.map(r => r.id);
  const averageScore = reviews.length
    ? reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length
    : 0;

  await sql`
    UPDATE products
    SET review_ids = ${reviewIds}, average_score = ${averageScore}
    WHERE id = ${productId}
  `;
}

// POST /reviews — créer un avis
app.post("/reviews", async (req, res) => {
  const result = CreateReviewSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const { userId, productId, score, content } = result.data;
  try {
    const user = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (user.length === 0)
      return res.status(404).send({ message: "User not found" });

    const product = await sql`SELECT id FROM products WHERE id = ${productId}`;
    if (product.length === 0)
      return res.status(404).send({ message: "Product not found" });

    const review = await sql`
      INSERT INTO reviews (user_id, product_id, score, content)
      VALUES (${userId}, ${productId}, ${score}, ${content})
      RETURNING *
    `;

    await updateProductScore(productId);

    res.status(201).send(review[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /reviews — toutes les reviews
app.get("/reviews", async (req, res) => {
  try {
    const reviews = await sql`SELECT * FROM reviews`;
    res.send(reviews);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// GET /reviews/:id — une review
app.get("/reviews/:id", async (req, res) => {
  try {
    const reviews = await sql`SELECT * FROM reviews WHERE id = ${req.params.id}`;
    if (reviews.length === 0)
      return res.status(404).send({ message: "Review not found" });
    res.send(reviews[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PUT /reviews/:id — remplace entièrement une review
app.put("/reviews/:id", async (req, res) => {
  const result = CreateReviewSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const { userId, productId, score, content } = result.data;
  try {
    const review = await sql`
      UPDATE reviews
      SET user_id = ${userId}, product_id = ${productId},
          score = ${score}, content = ${content}, updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (review.length === 0)
      return res.status(404).send({ message: "Review not found" });

    await updateProductScore(productId);

    res.send(review[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// PATCH /reviews/:id — mise à jour partielle
app.patch("/reviews/:id", async (req, res) => {
  const result = UpdateReviewSchema.safeParse(req.body);
  if (!result.success) return res.status(400).send(result);

  const fields = result.data;
  if (Object.keys(fields).length === 0)
    return res.status(400).send({ message: "No fields to update" });

  try {
    const current = await sql`SELECT * FROM reviews WHERE id = ${req.params.id}`;
    if (current.length === 0)
      return res.status(404).send({ message: "Review not found" });

    const score   = fields.score   ?? current[0].score;
    const content = fields.content ?? current[0].content;

    const review = await sql`
      UPDATE reviews
      SET score = ${score}, content = ${content}, updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;

    await updateProductScore(current[0].product_id);

    res.send(review[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// DELETE /reviews/:id
app.delete("/reviews/:id", async (req, res) => {
  try {
    const review = await sql`
      DELETE FROM reviews WHERE id = ${req.params.id} RETURNING *
    `;
    if (review.length === 0)
      return res.status(404).send({ message: "Review not found" });

    await updateProductScore(review[0].product_id);

    res.send(review[0]);
  } catch (err) {
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
