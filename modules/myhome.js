zeeschuimer.register_module(
  "MyHome",
  "myhome.ie",
  function (response, source_platform_url, source_url) {
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

    return data["SearchResults"];
  }
);
