import { Handler } from "@netlify/functions";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };
  const { email, password, firstName, lastName } = JSON.parse(event.body || "{}");
  if (!email || !password) return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  const client = await pool.connect();
  try {
    const exists = await client.query("SELECT id FROM users WHERE email=$1", [email]);
    if (exists.rowCount) return { statusCode: 409, body: JSON.stringify({ error: "User exists" }) };
    const hash = await bcrypt.hash(password, 10);
    const r = await client.query(
      "INSERT INTO users (email, password_hash, first_name, last_name) VALUES($1,$2,$3,$4) RETURNING id,email,first_name,last_name",
      [email, hash, firstName || null, lastName || null]
    );
    const user = r.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "7d" });
    const cookie = 	oken=${token};HttpOnly;Path=/;Max-Age=${7*24*60*60};SameSite=Lax${process.env.COOKIE_DOMAIN ? ;Domain=${process.env.COOKIE_DOMAIN} : ""};
    return { statusCode: 200, headers: { "Set-Cookie": cookie, "Content-Type": "application/json" }, body: JSON.stringify({ user }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  } finally {
    client.release();
  }
};
