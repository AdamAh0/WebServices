const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const z = require("zod");

const app = express();
const port = 8001; // port différent pour ne pas confliter avec REST-MONGODB
const client = new MongoClient("mongodb://localhost:27017");
let db;

app.use(express.json());

// --- SCHEMAS ---

const ViewSchema = z.object({
  source:  z.string(),
  url:     z.string().url(),
  visitor: z.string(),
  meta:    z.record(z.any()).optional().default({}),
});

const ActionSchema = z.object({
  source:  z.string(),
  url:     z.string().url(),
  action:  z.string(),
  visitor: z.string(),
  meta:    z.record(z.any()).optional().default({}),
});

const GoalSchema = z.object({
  source:  z.string(),
  url:     z.string().url(),
  goal:    z.string(),
  visitor: z.string(),
  meta:    z.record(z.any()).optional().default({}),
});

// --- HELPER ---
// Factory qui génère les routes CRUD pour une collection
function createRoutes(collectionName, schema) {

  // POST /:collection
  app.post(`/${collectionName}`, async (req, res) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).send(result);

    try {
      const doc = { ...result.data, createdAt: new Date() };
      const ack = await db.collection(collectionName).insertOne(doc);
      res.status(201).send({ _id: ack.insertedId, ...doc });
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  });

  // GET /:collection
  app.get(`/${collectionName}`, async (req, res) => {
    try {
      const docs = await db.collection(collectionName)
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.send(docs);
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  });

  // GET /:collection/:id
  app.get(`/${collectionName}/:id`, async (req, res) => {
    try {
      const id  = new ObjectId(req.params.id);
      const doc = await db.collection(collectionName).findOne({ _id: id });
      if (!doc) return res.status(404).send({ message: "Not found" });
      res.send(doc);
    } catch (err) {
      if (err.message.includes("input must be a 24 character hex string"))
        return res.status(400).send({ message: "Invalid id format" });
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  });

  // DELETE /:collection/:id
  app.delete(`/${collectionName}/:id`, async (req, res) => {
    try {
      const id  = new ObjectId(req.params.id);
      const doc = await db.collection(collectionName).findOneAndDelete({ _id: id });
      if (!doc) return res.status(404).send({ message: "Not found" });
      res.send(doc);
    } catch (err) {
      if (err.message.includes("input must be a 24 character hex string"))
        return res.status(400).send({ message: "Invalid id format" });
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  });
}

// --- ENREGISTREMENT DES ROUTES ---
createRoutes("views",   ViewSchema);
createRoutes("actions", ActionSchema);
createRoutes("goals",   GoalSchema);

// GET /goals/:goalId/details — un goal + tous les views et actions du même visiteur
app.get("/goals/:goalId/details", async (req, res) => {
  try {
    const id = new ObjectId(req.params.goalId);

    const result = await db.collection("goals").aggregate([
      // 1. On cible le goal demandé
      { $match: { _id: id } },

      // 2. On récupère tous les views du même visiteur
      {
        $lookup: {
          from:     "views",
          let:      { visitor: "$visitor" },
          pipeline: [
            { $match: { $expr: { $eq: ["$visitor", "$$visitor"] } } },
            { $sort:  { createdAt: 1 } }
          ],
          as: "views",
        },
      },

      // 3. On récupère toutes les actions du même visiteur
      {
        $lookup: {
          from:     "actions",
          let:      { visitor: "$visitor" },
          pipeline: [
            { $match: { $expr: { $eq: ["$visitor", "$$visitor"] } } },
            { $sort:  { createdAt: 1 } }
          ],
          as: "actions",
        },
      },
    ]).toArray();

    if (result.length === 0)
      return res.status(404).send({ message: "Goal not found" });

    res.send(result[0]);
  } catch (err) {
    if (err.message.includes("input must be a 24 character hex string"))
      return res.status(400).send({ message: "Invalid id format" });
    res.status(500).send({ message: "Internal server error", error: err.message });
  }
});

// --- START SERVER ---
client.connect().then(() => {
  db = client.db("analyticsDB");
  app.listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
});