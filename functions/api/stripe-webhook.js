export async function onRequestPost(context) {
  try {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1&select=*`,
      {
        method: "GET",
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`
        }
      }
    );

    const body = await response.text();

    console.log("SUPABASE STATUS:", response.status);
    console.log("SUPABASE RESPONSE:", body);

    return new Response(
      JSON.stringify({
        supabase_status: response.status,
        supabase_response: body
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    console.log("SUPABASE TEST ERROR:", error);

    return new Response(
      JSON.stringify({
        error: String(error)
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
