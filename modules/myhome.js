zeeschuimer.register_module(
  "MyHome",
  "myhome.ie",
  function (response, source_platform_url, source_url) {
    // Ignore service worker requests
    if (source_platform_url.includes("ngsw-worker.js")) {
      return [];
    }

    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["myhome.ie"].includes(domain)) {
      return [];
    }

    let data;
    try {
      data = JSON.parse(response);
    } catch (SyntaxError) {
      return [];
    }

    //TODO: Remove duplicate results

    return data["SearchResults"];
  }
);
