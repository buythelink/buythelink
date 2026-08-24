export async function onRequestGet(context) {
  try {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1&select=current_price,sale_count`,
      {
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!response.ok) {
      return new Response("Unable to get price", {
        status: 500
      });
    }

    const data = await response.json();

    if (!data.length) {
      return new Response("Price not found", {
        status: 404
      });
    }

    return new Response(
      JSON.stringify({
        price: data[0].current_price,
        sale_count: data[0].sale_count
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.log(error);

    return new Response("Server error", {
      status: 500
    });
  }
}
