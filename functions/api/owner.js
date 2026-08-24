export async function onRequestGet(context) {
  try {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1&select=current_owner`,
      {
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!response.ok) {
      console.log(
        "Owner lookup failed:",
        response.status,
        await response.text()
      );

      return new Response(
        JSON.stringify({
          error: "Unable to get current owner"
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
          owner: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        owner: data[0].current_owner
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
    console.log("Owner error:", error);

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
