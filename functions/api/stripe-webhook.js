export async function onRequestPost(context) {
  try {
    const url =
      `${context.env.SUPABASE_URL}/rest/v1/site_state?select=*&id=eq.1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "apikey": context.env.SUPABASE_SECRET_KEY,
        "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
        "Accept-Profile": "public"
      }
    });

    const body = await response.text();

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
