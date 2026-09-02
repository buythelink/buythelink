export async function onRequestGet(context) {
  try {
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          error: "Supabase environment variables are missing"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=current_owner,current_email,current_url,sale_count`,
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

    const data = JSON.parse(responseText);

    if (!Array.isArray(data) || data.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No owner found"
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
        name: owner.current_owner || "Nobody yet",
        email: owner.current_email || "",
        url: owner.current_url || "",
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
        error: "Server error"
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
