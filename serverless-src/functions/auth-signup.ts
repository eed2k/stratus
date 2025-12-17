import { Handler } from "@netlify/functions";

export const handler: Handler = async () => {
  return { 
    statusCode: 200, 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: "Signup is handled by Netlify Identity widget on the client side" 
    }) 
  };
};
