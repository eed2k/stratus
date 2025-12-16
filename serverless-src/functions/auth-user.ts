import { Handler } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getTokenFromEvent(event: any) {
  const auth = event.headers?.authorization;
  if (auth?.startsWith("Bearer ")) return auth.split(" ")[1];
  const cookie = event.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return m ? m[1] : null;
}

export const handler: Handler = async (event) => {
  const token = getTokenFromEvent(event);
  if (!token) return { statusCode: 200, body: JSON.stringify({ user: null }) };
  try {
    const payload: any = jwt.verify(token, process.env.JWT_SECRET as string);
    const client = await pool.connect();
    const r = await client.query("SELECT id,email,first_name,last_name FROM users WHERE id=$1", [payload.userId]);
    client.release();
    return { statusCode: 200, body: JSON.stringify({ user: r.rows[0] || null }) };
  } catch {
    return { statusCode: 200, body: JSON.stringify({ user: null }) };
  }
};
