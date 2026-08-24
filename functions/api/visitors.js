export async function onRequestGet(context) {
  try {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1&select=visitor_count`,
      {
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Unable to get visitor count"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const data = await response.json();

    if (!data.length) {
      return new Response(
        JSON.stringify({
          visitors: 0
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const currentCount =
      Number(data[0].visitor_count) || 0;

    const newCount = currentCount + 1;

    const updateResponse = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1`,
      {
        method: "PATCH",
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          visitor_count: newCount
        })
      }
    );

    if (!updateResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Unable to update visitor count"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        visitors: newCount
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
    console.log("Visitor counter error:", error);

    return new Response(
      JSON.stringify({
        error: "Internal server error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
