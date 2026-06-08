zeeschuimer.register_module(
  "MyHome.ie (Detail)",
  "myhome.ie",
  function (response, source_platform_url, source_url) {
    if (!source_platform_url.includes("/brochure/")) {
      return [];
    }

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

    const property_id = data?.Brochure?.Property?.PropertyId;
    if (!property_id) {
      return [];
    }

    return [{ id: property_id, ...data.Brochure }];
  },
  null,
  "myhome.ie-detail"
);
