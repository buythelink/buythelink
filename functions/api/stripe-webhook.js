export async function onRequestPost(context) {
  console.log("WEBHOOK RECEIVED");

  try {
    const body = await context.request.text();

    console.log("BODY RECEIVED");

    return new Response(
      JSON.stringify({
        received: true
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    console.log("WEBHOOK ERROR", error);

    return new Response(
      JSON.stringify({
        error: String(error)
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
