CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  about VARCHAR(500),
  price FLOAT
);
ALTER TABLE products ALTER COLUMN price TYPE numeric USING price::numeric;

INSERT INTO products (name, about, price) VALUES
  ('Valorant', 'FPS', '60'),
  ('Minecraft', 'adventure', '50'),
  ('dead by daylight', 'horror', '40');



CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(128) NOT NULL
);

CREATE TABLE orders (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  product_ids INTEGER[],
  total     NUMERIC,
  payment   BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Nouvelle table reviews
CREATE TABLE reviews (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  product_id INTEGER REFERENCES products(id),
  score      INTEGER CHECK (score >= 1 AND score <= 5),
  content    TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ajout des colonnes à products
ALTER TABLE products ADD COLUMN review_ids    INTEGER[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN average_score NUMERIC   DEFAULT 0;