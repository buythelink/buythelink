export async function onRequestGet(context) {
  try {
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=*`,
      {
        method: "GET",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Accept": "application/json"
        }
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.log(
        "Supabase owner lookup failed:",
        response.status,
        responseText
      );

      return new Response(
        JSON.stringify({
          error: "Supabase error",
          status: response.status,
          details: responseText
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const data = JSON.parse(responseText);

    if (!Array.isArray(data) || data.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No site_state row found"
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const owner = data[0];

    return new Response(
      JSON.stringify({
        name: owner.owner_name || "Nobody yet",
        email: owner.owner_email || "",
        url: owner.destination_url || "",
        sale_count: Number(owner.sale_count || 0)
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
        error: "Server error",
        details: error.message
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
