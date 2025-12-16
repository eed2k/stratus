import { Handler } from "@netlify/functions";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };
  const { email, password } = JSON.parse(event.body || "{}");
  if (!email || !password) return { statusCode: 400, body: JSON.stringify({ error: "Missing" }) };
  const client = await pool.connect();
  try {
    const r = await client.query("SELECT id, email, password_hash, first_name, last_name FROM users WHERE email=$1", [email]);
    const user = r.rows[0];
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Invalid credentials" }) };
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return { statusCode: 401, body: JSON.stringify({ error: "Invalid credentials" }) };
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "7d" });
    const cookie = 	oken=${token};HttpOnly;Path=/;Max-Age=${7*24*60*60};SameSite=Lax${process.env.COOKIE_DOMAIN ? ;Domain=${process.env.COOKIE_DOMAIN} : ""};
    delete user.password_hash;
    return { statusCode: 200, headers: { "Set-Cookie": cookie, "Content-Type": "application/json" }, body: JSON.stringify({ user }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  } finally {
    client.release();
  }
};
