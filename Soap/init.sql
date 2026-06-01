CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  about VARCHAR(500),
  price FLOAT
);

INSERT INTO products (name, about, price) VALUES
  ('My first game', 'This is an awesome game', '60')

