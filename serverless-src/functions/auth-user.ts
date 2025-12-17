import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const clientContext = context.clientContext as any;
  
  if (!clientContext?.user) {
    return { 
      statusCode: 200, 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: null }) 
    };
  }

  const netlifyUser = clientContext.user;
  
  try {
    const client = await pool.connect();
    
    let result = await client.query(
      "SELECT id, email, first_name, last_name FROM users WHERE email = $1",
      [netlifyUser.email]
    );
    
    if (result.rows.length === 0) {
      await client.query(
        "INSERT INTO users (email, first_name, last_name) VALUES ($1, $2, $3)",
        [
          netlifyUser.email,
          netlifyUser.user_metadata?.full_name?.split(' ')[0] || null,
          netlifyUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || null
        ]
      );
      result = await client.query(
        "SELECT id, email, first_name, last_name FROM users WHERE email = $1",
        [netlifyUser.email]
      );
    }
    
    client.release();
    
    return { 
      statusCode: 200, 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: result.rows[0] || null }) 
    };
  } catch (error) {
    console.error("Error fetching user:", error);
    return { 
      statusCode: 200, 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: null }) 
    };
  }
};
