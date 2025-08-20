import Mercury from "@postlight/mercury-parser";

const articleUrl =
  process.argv[2] ||
  "https://www.nzz.ch/international/ukraine-krieg-russland-raketen-auf-energiesektor-ld.1843194";

async function parseArticle(url) {
  try {
    console.log(`Fetching and parsing article from: ${url}`);
    const result = await Mercury.parse(url);

    console.log("\n--- PARSED ARTICLE DATA ---");
    console.log("Title:", result.title);
    console.log("Author:", result.author);
    console.log("Published:", result.date_published);
    console.log("Lead Image URL:", result.lead_image_url);

    const content = result.content || "";
    console.log("\n--- FULL ARTICLE CONTENT (HTML) ---");
    console.log(content);

    const plainText = content.replace(/<[^>]+>/g, "");
    console.log("\n--- FULL ARTICLE CONTENT (Plain Text) ---");
    console.log(plainText);
  } catch (error) {
    console.error("An error occurred during parsing:", error?.message || error);
    process.exitCode = 1;
  }
}

parseArticle(articleUrl);
