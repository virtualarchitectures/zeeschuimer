zeeschuimer.register_module(
  "Daft",
  "daft.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["daft.ie"].includes(domain)) {
      return [];
    }

    let data;
    try {
      data = JSON.parse(response);
    } catch (SyntaxError) {
      return [];
    }

    // Extract just the listing data from each item
    return data["listings"].map((item) => item.listing);
  }
);
